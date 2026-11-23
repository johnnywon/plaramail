import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const ai = await loadTs("workers/lib/ai.ts");

const checker = (response) => ({ run: async () => ({ response }) });

const REPLY = "Hi Jess,\n\nFriday at noon works for me. See you at the usual place.\n\nAlex";

test("the checker's verdict never replaces the draft", async () => {
	assert.equal(await ai.verifyDraft(checker("No system artifacts found. Return email exactly as is."), REPLY), REPLY);
	assert.equal(await ai.verifyDraft(checker("The email contains no system artifacts."), REPLY), REPLY);
});

test("a note the checker adds in front of the reply is dropped with it", async () => {
	const reply = "Could you send your order number? It starts with ORD-. If you don't have it handy, the email address on your account works too.";
	assert.equal(await ai.verifyDraft(checker(`No changes needed. ${reply}`), reply), reply);
	assert.equal(await ai.verifyDraft(checker(`Here is the cleaned version:\n\n${reply}`), reply), reply);
});

test("a line the checker removes stays removed", async () => {
	const body = "Thanks for writing in. We don't take guest posts.\n\nDraft saved.";
	assert.equal(await ai.verifyDraft(checker("Thanks for writing in. We don't take guest posts."), body), "Thanks for writing in. We don't take guest posts.");
});

test("an HTML draft keeps its quoted thread when the checker only comments", async () => {
	const html = "<p>Friday at noon works for me. See you at the usual place.</p><br><blockquote><p>Lunch Friday?</p></blockquote>";
	assert.equal(await ai.verifyDraft(checker("No changes needed."), html), html);
	assert.equal(await ai.verifyDraft(checker("No changes needed. Friday at noon works for me. See you at the usual place."), html), html);
});

test("a reworded draft is not the checker's to keep", async () => {
	assert.equal(await ai.verifyDraft(checker("Hi Jess, Friday at noon is good. See you there. Alex"), REPLY), REPLY);
});
