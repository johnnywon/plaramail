import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Redraft with a one-off instruction (WON-226).

const { redraft, redraftPrompt, htmlToLines } = await loadTs("workers/lib/redraft.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const { app } = await loadTs("workers/index.ts");
const { splitQuotedBlock } = await loadTs("workers/lib/ai.ts");

const MAILBOX = "a@example.com";
const QUOTE = `<br><blockquote style="border: 1px solid #ddd">On Monday, bob@example.org wrote:<br><br>Can we meet Thursday?</blockquote>`;

async function setup({ verdict = "NO" } = {}) {
	const d1 = await openD1();
	await d1.addMailboxes(MAILBOX);
	const box = new D1Mailbox(d1.sql, { delete: async () => {}, put: async () => {} }, MAILBOX);
	await box.createEmail("inbox", {
		id: "orig", subject: "Meeting", sender: "bob@example.org", recipient: MAILBOX, date: "2026-10-01T10:00:00.000Z",
		body: "<p>Can we meet Thursday? I have a few questions about the contract.</p>", thread_id: "orig", message_id: "orig@example.org",
	}, []);
	await box.createEmail("draft", {
		id: "draft-1", subject: "Re: Meeting", sender: MAILBOX, recipient: "bob@example.org", date: "2026-10-01T10:05:00.000Z",
		body: `<div style="white-space:pre-wrap">Hi Bob,\nThursday works. I can do 10am or 2pm, whichever suits you better.</div>${QUOTE}`,
		in_reply_to: "orig", thread_id: "orig",
	}, []);
	await box.setDraftNotes("draft-1", { origin: "auto-draft", agent: "Meetings", instructions: [] });
	const prompts = [];
	const deps = {
		ai: { run: async () => ({ response: verdict }) },
		bucket: { delete: async () => {} },
		system: "You are an email assistant.",
		write: async (system, prompt) => { prompts.push({ system, prompt }); return "Hi Bob,\nThursday at 10am works."; },
		verify: async (text) => text,
	};
	return { d1, box, deps, prompts };
}

test("redraft replaces the draft, keeps the quote and records the instruction", async () => {
	const { box, deps, prompts } = await setup();
	const result = await redraft(box, MAILBOX, "draft-1", "shorter", deps);
	assert.equal(result.ok, true);
	assert.equal(await box.getEmail("draft-1"), null);
	const next = await box.getEmail(result.draft.id);
	assert.equal(next.folder_id, "draft");
	assert.equal(next.subject, "Re: Meeting");
	assert.equal(next.recipient, "bob@example.org");
	assert.equal(next.in_reply_to, "orig");
	assert.match(next.body, /Thursday at 10am works/);
	assert.ok(next.body.endsWith(QUOTE));
	assert.deepEqual(next.draft_notes, { origin: "auto-draft", agent: "Meetings", instructions: ["shorter"] });

	const { prompt, system } = prompts[0];
	assert.equal(system, "You are an email assistant.");
	assert.match(prompt, /Instruction: shorter/);
	assert.match(prompt, /I can do 10am or 2pm/);
	assert.doesNotMatch(prompt.split("The email this draft answers")[0], /Can we meet Thursday/);
	assert.match(prompt, /From: bob@example.org/);

	const again = await redraft(box, MAILBOX, result.draft.id, "decline politely", deps);
	assert.deepEqual(again.notes.instructions, ["shorter", "decline politely"]);
});

test("redraft keeps the quote of a draft the composer saved (#30)", async () => {
	const { box, deps, prompts } = await setup();
	// The composer saves paragraphs and leaves an empty one after the quote.
	const quote = `<p></p><blockquote style="border: 1px solid #ddd"><p>On Monday, bob@example.org wrote:</p><p></p><p>Can we meet Thursday?</p></blockquote><p></p>`;
	await box.createEmail("draft", {
		id: "saved", subject: "Re: Meeting", sender: MAILBOX, recipient: "bob@example.org", date: "2026-10-01T10:06:00.000Z",
		body: `<p>Hi Bob,</p><p>Thursday works. I can do 10am or 2pm.</p>${quote}`, in_reply_to: "orig", thread_id: "orig",
	}, []);
	await box.setDraftNotes("saved", { origin: "auto-draft", agent: "Meetings", instructions: [] });
	const result = await redraft(box, MAILBOX, "saved", "shorter", deps);
	assert.equal(result.ok, true);
	assert.ok(result.draft.body.endsWith(quote));
	assert.doesNotMatch(prompts[0].prompt.split("The email this draft answers")[0], /Can we meet Thursday/);
});

test("splitQuotedBlock takes the composer's attribution line with the quote", () => {
	const quote = `<p><br></p><div>On Oct 1, bob@example.org wrote:</div><blockquote>Can we meet?</blockquote>`;
	assert.deepEqual(splitQuotedBlock(`<p>Yes.</p>${quote}`), { reply: "<p>Yes.</p>", quoted: quote });
	assert.deepEqual(splitQuotedBlock(`<p>Yes.</p>${quote}<p></p> \n<p><br></p>`), { reply: "<p>Yes.</p>", quoted: `${quote}<p></p> \n<p><br></p>` });
	assert.deepEqual(splitQuotedBlock("<p>No quote</p><p></p>"), { reply: "<p>No quote</p><p></p>", quoted: "" });
});

test("a thread read carries the notes of its agent drafts", async () => {
	const { box } = await setup();
	const thread = await box.getThreadEmails("orig");
	assert.deepEqual(thread.map((e) => [e.id, e.draft_notes?.origin ?? null]), [["orig", null], ["draft-1", "auto-draft"]]);
});

test("only agent drafts are redrafted", async () => {
	const { box, deps } = await setup();
	await box.createEmail("draft", { id: "mine", subject: "Hi", sender: MAILBOX, recipient: "c@example.org", date: new Date().toISOString(), body: "<p>Mine</p>", thread_id: "mine" }, []);
	assert.deepEqual(await redraft(box, MAILBOX, "mine", "shorter", deps), { ok: false, status: 400, error: "Only drafts an agent wrote can be redrafted" });
	assert.equal((await redraft(box, MAILBOX, "orig", "shorter", deps)).status, 404);
	assert.equal((await redraft(box, MAILBOX, "missing", "shorter", deps)).status, 404);
});

test("an empty or overlong instruction is refused", async () => {
	const { box, deps, prompts } = await setup();
	assert.equal((await redraft(box, MAILBOX, "draft-1", "   ", deps)).status, 400);
	assert.equal((await redraft(box, MAILBOX, "draft-1", "x".repeat(501), deps)).status, 400);
	assert.equal(prompts.length, 0);
});

test("a failed injection scan of the original stops the redraft", async () => {
	const { box, deps, prompts } = await setup({ verdict: "YES" });
	const result = await redraft(box, MAILBOX, "draft-1", "shorter", deps);
	assert.equal(result.status, 422);
	assert.match(result.error, /prompt injection/);
	assert.equal(prompts.length, 0);
	assert.ok(await box.getEmail("draft-1"));
});

test("a model failure or an empty answer leaves the draft alone", async () => {
	const { box, deps } = await setup();
	const failing = { ...deps, write: async () => { throw new Error("timeout"); } };
	assert.equal((await redraft(box, MAILBOX, "draft-1", "shorter", failing)).status, 502);
	const empty = { ...deps, verify: async () => "" };
	assert.equal((await redraft(box, MAILBOX, "draft-1", "shorter", empty)).status, 502);
	assert.ok(await box.getEmail("draft-1"));
});

test("redraftPrompt and htmlToLines", () => {
	assert.equal(htmlToLines("<div>Hi Bob,<br>See you &amp; Ann</div><p>Thanks</p>"), "Hi Bob,\nSee you & Ann\nThanks");
	const prompt = redraftPrompt({ draft: "Hello", instruction: "warmer" });
	assert.match(prompt, /Instruction: warmer/);
	assert.doesNotMatch(prompt, /The email this draft answers/);
});

test("saving an edited agent draft keeps its notes", async () => {
	const { d1, box } = await setup();
	const env = { DB: d1.DB, BUCKET: { delete: async () => {}, put: async () => {} }, EMAIL_ADDRESSES: [MAILBOX] };
	const response = await app.request(`/api/v1/mailboxes/${MAILBOX}/drafts`, {
		method: "POST",
		headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
		body: JSON.stringify({ to: "bob@example.org", subject: "Re: Meeting", body: "<p>Edited</p>", in_reply_to: "orig", draft_id: "draft-1" }),
	}, env);
	assert.equal(response.status, 201);
	const { id } = await response.json();
	assert.deepEqual((await box.getEmail(id)).draft_notes, { origin: "auto-draft", agent: "Meetings", instructions: [] });
	assert.equal(d1.exec(`SELECT COUNT(*) AS n FROM draft_notes`)[0].n, 1);
});
