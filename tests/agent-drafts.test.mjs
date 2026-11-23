import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// "Open draft" under an agent reply (#42): only for drafts the turn didn't go on to send.

const { openableDrafts } = await loadTs("app/components/postal/agent-drafts.ts");

const draft = (draftId, mailboxId = "A@example.com") => ({ name: "draft_reply", input: { mailboxId }, output: { status: "draft_saved", draftId } });
const send = (draftId, output = { status: "sent", sentId: "s1" }) => ({ name: "send_draft", input: { mailboxId: "a@example.com", draftId }, output });

test("a draft the turn made can be opened", () => {
	assert.deepEqual(openableDrafts([draft("d1")]), [{ mailboxId: "a@example.com", draftId: "d1" }]);
});

test("a draft the turn then sent has no Open draft (#42)", () => {
	assert.deepEqual(openableDrafts([draft("d1"), send("d1")]), []);
	assert.deepEqual(openableDrafts([draft("d1"), draft("d2"), send("d1")]), [{ mailboxId: "a@example.com", draftId: "d2" }]);
});

test("a send that failed keeps Open draft", () => {
	assert.deepEqual(openableDrafts([draft("d1"), send("d1", { error: "Daily limit reached" })]).length, 1);
});
