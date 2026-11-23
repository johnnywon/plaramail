import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const ai = await loadTs("workers/lib/ai.ts");
const BODY = "<p>Please send the invoice for October when you can.</p>";

function binding(reply) {
	const calls = [];
	return { calls, run: async (model, input) => { calls.push(model); if (reply instanceof Error) throw reply; return reply; } };
}

test("the injection scanner reads the model's YES or NO", async () => {
	const yes = binding({ response: "YES" });
	assert.equal(await ai.isPromptInjection(yes, BODY), true);
	assert.deepEqual(yes.calls, [ai.INJECTION_MODEL]);
	assert.equal(await ai.isPromptInjection(binding({ response: " no." }), BODY), false);
});

test("the injection scanner fails closed without a verdict", async () => {
	assert.equal(await ai.isPromptInjection(binding({ response: "" }), BODY), true);
	assert.equal(await ai.isPromptInjection(binding({}), BODY), true);
	assert.equal(await ai.isPromptInjection(binding({ response: "Maybe" }), BODY), true);
	assert.equal(await ai.isPromptInjection(binding({ response: "UNKNOWN" }), BODY), true);
	assert.equal(await ai.isPromptInjection(binding(new Error("5007: No such model")), BODY), true);
});

test("the injection scanner skips empty and very short mail", async () => {
	const b = binding({ response: "YES" });
	assert.equal(await ai.isPromptInjection(b, ""), false);
	assert.equal(await ai.isPromptInjection(b, "<p>hi</p>"), false);
	assert.equal(b.calls.length, 0);
});
