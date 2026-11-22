import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// A deferred reply the mail service rejects goes back to Drafts as a reply
// draft: in_reply_to names the original by its id, as saved drafts do.

const { sendMail } = await loadTs("workers/lib/send.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");

const MAILBOX = "a@example.com";
const rejected = () => Object.assign(new Error("suppressed"), { code: "E_RECIPIENT_SUPPRESSED" });

test("a rejected deferred reply reopens as a reply draft that sends", async () => {
	const d1 = await openD1();
	await d1.addMailboxes(MAILBOX);
	const BUCKET = { put: async () => {}, get: async () => null, delete: async () => {} };
	const box = new D1Mailbox(d1.sql, BUCKET, MAILBOX);
	await box.createEmail("inbox", {
		id: "orig-1", subject: "Q", sender: "bob@example.org", recipient: MAILBOX, date: new Date().toISOString(),
		body: "hi", message_id: "abc@example.org", thread_id: "orig-1",
	}, []);
	const reply = { to: "bob@example.org", from: MAILBOX, subject: "Re: Q", text: "answer" };

	let delivery;
	const env = { BUCKET, EMAIL: { send: async () => { throw rejected(); } } };
	const result = await sendMail(env, MAILBOX, box, reply, { kind: "reply", originalId: "orig-1" }, { defer: (p) => { delivery = p; } });
	assert.equal(result.ok, true);
	await delivery;

	const draft = await box.getEmail(result.id);
	assert.equal(draft.folder_id, "draft");
	assert.equal(draft.in_reply_to, "orig-1");

	// Sending it again as the composer and send_draft do: a reply to draft.in_reply_to.
	const sent = [];
	const again = await sendMail({ ...env, EMAIL: { send: async (m) => { sent.push(m); return { messageId: "p" }; } } },
		MAILBOX, box, reply, { kind: "reply", originalId: draft.in_reply_to });
	assert.equal(again.ok, true);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].headers["In-Reply-To"], "<abc@example.org>");
});

test("a rejected deferred new message goes back to Drafts without in_reply_to", async () => {
	const d1 = await openD1();
	await d1.addMailboxes(MAILBOX);
	const BUCKET = { put: async () => {}, get: async () => null, delete: async () => {} };
	const box = new D1Mailbox(d1.sql, BUCKET, MAILBOX);
	let delivery;
	const env = { BUCKET, EMAIL: { send: async () => { throw rejected(); } } };
	const result = await sendMail(env, MAILBOX, box, { to: "bob@example.org", from: MAILBOX, subject: "Hi", text: "x" }, { kind: "new" }, { defer: (p) => { delivery = p; } });
	await delivery;
	const draft = await box.getEmail(result.id);
	assert.equal(draft.folder_id, "draft");
	assert.equal(draft.in_reply_to, null);
});
