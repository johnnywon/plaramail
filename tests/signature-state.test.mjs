import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// Console > Signatures: what a signature's Add by default switch does as you write (#50).

const { withSignatureText } = await loadTs("app/components/postal/signature-state.ts");

const none = { html: "", enabled: false };

test("writing a first signature leaves Add by default off, as the guide says (#50)", () => {
	assert.deepEqual(withSignatureText(none, "<p>Ann</p>"), { html: "<p>Ann</p>", enabled: false });
});

test("editing keeps the switch where you put it, and emptying turns it off", () => {
	assert.equal(withSignatureText({ html: "<p>Ann</p>", enabled: true }, "<p>Ann Lee</p>").enabled, true);
	assert.equal(withSignatureText({ html: "<p>Ann</p>", enabled: false }, "<p>Ann Lee</p>").enabled, false);
	assert.equal(withSignatureText({ html: "<p>Ann</p>", enabled: true }, "<p>&nbsp;</p>").enabled, false);
});
