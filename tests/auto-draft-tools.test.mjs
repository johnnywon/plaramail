import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const { AUTO_DRAFT_TOOLS, autoDraftRecipient, createAutoDraftTools } = await loadTs("workers/agent/auto-draft.ts");

const MAILBOX = "a@example.com";
const TARGET = { mailboxId: MAILBOX, emailId: "e2", threadId: "t1", to: "ann@example.net" };
const message = (id) => ({ id, date: "2026-10-01T00:00:00Z", folder_id: "inbox", sender: "ann@example.net", sender_name: "Ann", recipient: MAILBOX, subject: "Hi", body_text: `body ${id}` });
const CONTEXT = { thread: [message("e1"), message("e2")] };

function fakeDraftReply() {
	const calls = [];
	const fn = async (_env, mailboxId, params) => (calls.push([mailboxId, params]), { status: "draft_saved", draftId: "d1" });
	return Object.assign(fn, { calls });
}

test("auto-draft gets only get_email, get_thread and draft_reply", () => {
	const tools = createAutoDraftTools({}, TARGET, CONTEXT, fakeDraftReply());
	assert.deepEqual(Object.keys(tools).sort(), ["draft_reply", "get_email", "get_thread"]);
	assert.deepEqual([...AUTO_DRAFT_TOOLS].sort(), Object.keys(tools).sort());
	for (const name of ["draft_email", "send_draft", "delete_label", "rename_label", "set_shortcut", "reset_shortcuts", "move_email", "discard_draft", "label_conversation", "star_conversation", "search_emails", "search_all_mail"]) {
		assert.equal(tools[name], undefined, `${name} must not reach auto-draft`);
	}
});

test("draft_reply takes no recipient or email id from the model", async () => {
	const draftReply = fakeDraftReply();
	const { draft_reply } = createAutoDraftTools({}, TARGET, CONTEXT, draftReply);
	assert.deepEqual(Object.keys(draft_reply.inputSchema.shape).sort(), ["body", "subject"]);
	// Extra fields the model sends are dropped.
	const input = draft_reply.inputSchema.parse({ to: "other@example.org", originalEmailId: "e9", subject: "Re: Hi", body: "Thanks" });
	await draft_reply.execute(input);
	const [[mailboxId, params]] = draftReply.calls;
	assert.equal(mailboxId, MAILBOX);
	assert.equal(params.to, "ann@example.net");
	assert.equal(params.originalEmailId, "e2");
	assert.equal(params.subject, "Re: Hi");
});

test("get_thread returns the new email's thread and get_email stays inside it", async () => {
	const { get_email, get_thread } = createAutoDraftTools({}, TARGET, CONTEXT, fakeDraftReply());
	assert.deepEqual(Object.keys(get_thread.inputSchema.shape), []);
	const thread = await get_thread.execute({ threadId: "t9" });
	assert.equal(thread.thread_id, "t1");
	assert.deepEqual(thread.messages.map((m) => m.id), ["e1", "e2"]);
	assert.equal((await get_email.execute({ emailId: "e1" })).body_text, "body e1");
	assert.match((await get_email.execute({ emailId: "e7" })).error, /not found/);
});

test("the reply goes to Reply-To, else the sender", () => {
	assert.equal(autoDraftRecipient({ sender: "ann@example.net", raw_headers: null }), "ann@example.net");
	assert.equal(autoDraftRecipient({ sender: "Ann@Example.net", raw_headers: JSON.stringify([{ key: "from", value: "Ann <ann@example.net>" }]) }), "ann@example.net");
	assert.equal(
		autoDraftRecipient({ sender: "ann@example.net", raw_headers: JSON.stringify([{ key: "reply-to", value: "Support <Help@example.org>, team@example.org" }]) }),
		"help@example.org, team@example.org",
	);
	assert.equal(autoDraftRecipient({ sender: "", raw_headers: null }), "");
});

test("the highest agent in the list whose job fits takes the message", async () => {
	const draftReply = fakeDraftReply();
	const picked = [];
	const agents = [{ name: "Penny", job: "Decline pitches." }, { name: "Otis", job: "Ask for details." }];
	const { draft_reply } = createAutoDraftTools({}, TARGET, CONTEXT, draftReply, { agents, onDraft: (_id, agent) => picked.push(agent) });
	// The model drafted for Otis but says Penny fits too: nothing is saved, and it's told to write for Penny.
	const refused = await draft_reply.execute({ subject: "Re: Hi", body: "Which order?", agent: "Otis", fits: ["otis", "Penny"] });
	assert.match(refused.error, /Penny is higher in the list/);
	assert.equal(draftReply.calls.length, 0);
	await draft_reply.execute({ subject: "Re: Hi", body: "No thanks.", agent: "penny", fits: ["Penny", "Otis"] });
	await draft_reply.execute({ subject: "Re: Hi", body: "Which order?", agent: "Otis", fits: ["Otis"] });
	assert.deepEqual(picked, ["Penny", "Otis"]);
});
