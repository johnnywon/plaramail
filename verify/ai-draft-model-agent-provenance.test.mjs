// WON-594: a draft's notes keep the model that wrote it, through save and reopen.
// Lives in verify/, not tests/, so `npm test` stays green until the work lands.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "../tests/helpers/d1.mjs";
import { loadTs } from "../tests/helpers/sqlite.mjs";

const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const MAILBOX = "a@example.com";

test("draft notes store and return the generating model", async () => {
	const d1 = await openD1();
	await d1.addMailboxes(MAILBOX);
	const box = new D1Mailbox(d1.sql, { delete: async () => {}, put: async () => {} }, MAILBOX);
	await box.createEmail("draft", {
		id: "draft-1", subject: "Re: Meeting", sender: MAILBOX, recipient: "bob@example.org", date: "2026-10-01T10:05:00.000Z",
		body: "<p>Thursday works.</p>", thread_id: "orig",
	}, []);
	await box.setDraftNotes("draft-1", { origin: "auto-draft", agent: "Meetings", model: "@cf/test/model-a", instructions: [] });
	const notes = (await box.getEmail("draft-1")).draft_notes;
	assert.equal(notes?.model, "@cf/test/model-a");
	assert.equal(notes?.agent, "Meetings");
});
