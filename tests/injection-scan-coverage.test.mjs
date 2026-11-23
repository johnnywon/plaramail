import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const ai = await loadTs("workers/lib/ai.ts");
const { prepareAutoDraft, autoDraftPrompt } = await loadTs("workers/agent/auto-draft.ts");

const MARK = "PLANTED-INSTRUCTION";

/** A scanner that answers YES when the text holds MARK, and records what it was shown. */
function scanner({ fail = false, reply } = {}) {
	const seen = [];
	return {
		seen,
		run: async (_model, input) => {
			const text = input.messages[1].content;
			seen.push(text);
			if (fail) throw new Error("5007: model unavailable");
			if (reply !== undefined) return { response: reply };
			return { response: text.includes(MARK) ? "YES" : "NO" };
		},
	};
}

const MAILBOX = "a@example.com";
const email = (id, fields = {}) => ({
	id, subject: "Invoice October", sender: "ann@example.net", recipient: MAILBOX, date: "2026-10-10T10:00:00Z", folder_id: "inbox",
	body: "<p>Please send the invoice for October when you can.</p>", raw_headers: JSON.stringify([{ key: "from", value: "Ann Lee <ann@example.net>" }]),
	thread_id: "t1", ...fields,
});

function store(emails, { fail = false } = {}) {
	return {
		getEmail: async (id) => { if (fail) throw new Error("D1 unavailable"); return emails.find((e) => e.id === id) ?? null; },
		getThreadEmails: async (threadId) => { if (fail) throw new Error("D1 unavailable"); return emails.filter((e) => e.thread_id === threadId); },
	};
}

const TARGET = { emailId: "e2", threadId: "t1" };
const earlier = email("e1", { date: "2026-10-09T10:00:00Z" });

test("a clean email and thread pass, and the prompt holds only scanned text", async () => {
	const s = scanner();
	const result = await prepareAutoDraft(s, store([earlier, email("e2")]), TARGET);
	assert.equal(result.ok, true);
	assert.deepEqual(result.context.thread.map((m) => m.id), ["e1", "e2"]);
	assert.equal(result.context.replyTo, "ann@example.net");
	const scanned = s.seen.join("\n");
	for (const m of result.context.thread) {
		for (const field of [m.sender, m.sender_name, m.recipient, m.subject, m.body_text]) assert.ok(scanned.includes(field), `${field} was scanned`);
	}
	const prompt = autoDraftPrompt(MAILBOX, "t1", result.context);
	assert.match(prompt, /From: Ann Lee <ann@example.net>/);
});

test("an instruction in the subject alone skips the draft", async () => {
	const result = await prepareAutoDraft(scanner(), store([email("e2", { subject: `Invoice ${MARK}` })]), TARGET);
	assert.deepEqual(result, { ok: false, reason: "prompt injection detected" });
});

test("an instruction in the sender's display name skips the draft", async () => {
	const raw_headers = JSON.stringify([{ key: "from", value: `"${MARK}" <ann@example.net>` }]);
	const result = await prepareAutoDraft(scanner(), store([email("e2", { raw_headers })]), TARGET);
	assert.equal(result.ok, false);
	assert.match(result.reason, /prompt injection/);
});

test("an instruction deep in an earlier message's body skips the draft", async () => {
	const long = `<p>${"Notes from the meeting. ".repeat(60)}${MARK}</p>`;
	assert.ok(long.indexOf(MARK) > 1000, "past the old 500 character cut");
	const result = await prepareAutoDraft(scanner(), store([email("e1", { body: long, date: "2026-10-09T10:00:00Z" }), email("e2")]), TARGET);
	assert.equal(result.ok, false);
	assert.match(result.reason, /prompt injection/);
});

test("a long thread is scanned in overlapping chunks, every one of them", async () => {
	const body = `<p>${"x".repeat(ai.SCAN_CHUNK_CHARS * 2)}${MARK}</p>`;
	const s = scanner();
	const result = await prepareAutoDraft(s, store([email("e2", { body })]), TARGET);
	assert.equal(result.ok, false);
	assert.match(result.reason, /in part 3 of 3/);
	assert.equal(s.seen.length, 3);
	assert.ok(s.seen.every((chunk) => chunk.length <= ai.SCAN_CHUNK_CHARS));

	const chunks = ai.scanChunks("a".repeat(ai.SCAN_CHUNK_CHARS - 10) + MARK + "b".repeat(ai.SCAN_CHUNK_CHARS));
	assert.ok(chunks.some((c) => c.includes(MARK)), "a string across a boundary is seen whole");
});

test("text too long to scan skips the draft without calling the model", async () => {
	const s = scanner();
	const result = await ai.scanForInjection(s, "y".repeat(ai.SCAN_CHUNK_CHARS * (ai.MAX_SCAN_CHUNKS + 1)));
	assert.equal(result.ok, false);
	assert.match(result.reason, /too long to scan/);
	assert.equal(s.seen.length, 0);
});

test("a failed or unclear scan skips the draft", async () => {
	const failed = await prepareAutoDraft(scanner({ fail: true }), store([email("e2")]), TARGET);
	assert.deepEqual(failed, { ok: false, reason: "injection scan failed" });
	const unclear = await prepareAutoDraft(scanner({ reply: "" }), store([email("e2")]), TARGET);
	assert.deepEqual(unclear, { ok: false, reason: "injection scan gave no clear answer" });
});

test("a failed read skips the draft instead of drafting blind", async () => {
	const s = scanner();
	const failed = await prepareAutoDraft(s, store([email("e2")], { fail: true }), TARGET);
	assert.equal(failed.ok, false);
	assert.match(failed.reason, /could not read the email or its thread: D1 unavailable/);
	assert.deepEqual(await prepareAutoDraft(s, store([]), TARGET), { ok: false, reason: "email not found" });
	assert.equal(s.seen.length, 0);
});
