import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const { customPrompt, promptAddress } = await loadTs("shared/agent.ts");
const KNOWN = ["a@example.com", "b@example.org"];

test("an address's own agent runs with that address's prompt", () => {
	assert.equal(promptAddress("B@example.org", { open: { mailboxId: "a@example.com", emailId: "e1" } }, KNOWN), "b@example.org");
});

test("the shared chat agent uses the prompt of the open mail's address", () => {
	assert.equal(promptAddress(null, { open: { mailboxId: "A@example.com", emailId: "e1" } }, KNOWN), "a@example.com");
});

test("with nothing open, or an unknown address open, the shared agent uses the default", () => {
	assert.equal(promptAddress(null, undefined, KNOWN), null);
	assert.equal(promptAddress(null, { open: null }, KNOWN), null);
	assert.equal(promptAddress(null, { open: { mailboxId: "x@example.net", emailId: "e1" } }, KNOWN), null);
});

test("a blank or missing prompt means the default", () => {
	assert.equal(customPrompt({ agentSystemPrompt: "Be brief." }), "Be brief.");
	assert.equal(customPrompt({ agentSystemPrompt: "  " }), null);
	assert.equal(customPrompt({}), null);
	assert.equal(customPrompt(null), null);
});

test("settings save each address's prompt, not one prompt for every address", () => {
	const modal = readFileSync(new URL("../app/components/postal/Modals.tsx", import.meta.url), "utf8");
	assert.match(modal, /agentSystemPrompt: \(prompts\[a\] \?\? ""\)\.trim\(\) \|\| undefined/);
	assert.doesNotMatch(modal, /agentSystemPrompt: prompt\.trim\(\)/);
});
