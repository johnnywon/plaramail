import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// MCP mail tools refuse what they would otherwise do to the wrong message.

const tools = await loadTs("workers/lib/tools.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const bucket = { get: async () => null, put: async () => {}, delete: async () => {} };

async function setup() {
	const d1 = await openD1();
	await d1.addMailboxes("a@example.com");
	const env = { DB: d1.DB, BUCKET: bucket, AI: {} };
	const box = new D1Mailbox(d1.sql, bucket, "a@example.com");
	const add = (folder, id) => box.createEmail(folder, {
		id, subject: "Invoice", sender: "alice@example.org", recipient: "a@example.com",
		date: "2026-10-18T12:00:00.000Z", body: "<p>Hi</p>",
	}, []);
	return { env, box, add };
}

test("update_draft refuses an email that is not a draft and leaves it in place", async () => {
	const { env, box, add } = await setup();
	await add("trash", "e1");
	const r = await tools.toolUpdateDraft(env, "a@example.com", { draftId: "e1", subject: "x" });
	assert.deepEqual(r, { error: "Cannot update: email is not a draft" });
	const e1 = await box.getEmail("e1");
	assert.equal(e1?.folder_id, "trash");
	assert.equal(e1?.subject, "Invoice");
});

test("update_draft still replaces a draft", async () => {
	const { env, box, add } = await setup();
	await add("draft", "d1");
	const r = await tools.toolUpdateDraft(env, "a@example.com", { draftId: "d1", subject: "New" });
	assert.equal(r.status, "draft_updated");
	assert.equal(await box.getEmail("d1"), null);
	assert.equal((await box.getEmail(r.newDraftId))?.subject, "New");
});

test("move_email refuses draft and sent", async () => {
	const { env, box, add } = await setup();
	await add("inbox", "e1");
	for (const folder of ["draft", "sent"]) {
		const r = await tools.toolMoveEmail(env, "a@example.com", "e1", folder);
		assert.ok("error" in r, folder);
	}
	assert.equal((await box.getEmail("e1"))?.folder_id, "inbox");
});

test("move_email moves to inbox, archive, spam and trash", async () => {
	const { env, box, add } = await setup();
	await add("inbox", "e1");
	for (const folder of ["archive", "spam", "trash", "inbox"]) {
		const r = await tools.toolMoveEmail(env, "a@example.com", "e1", folder);
		assert.deepEqual(r, { status: "moved", emailId: "e1", folder });
		assert.equal((await box.getEmail("e1"))?.folder_id, folder);
	}
});

test("move_email points custom folders at labels", async () => {
	const { env, add } = await setup();
	await add("inbox", "e1");
	const r = await tools.toolMoveEmail(env, "a@example.com", "e1", "receipts");
	assert.deepEqual(r, { error: "Custom folders are labels now. Use label_conversation." });
});

test("mark_email_read reports a missing email", async () => {
	const { env, add } = await setup();
	assert.deepEqual(await tools.toolMarkEmailRead(env, "a@example.com", "nope", true), { error: "Email not found", emailId: "nope" });
	await add("inbox", "e1");
	assert.deepEqual(await tools.toolMarkEmailRead(env, "a@example.com", "e1", true), { status: "updated", emailId: "e1", read: true });
});
