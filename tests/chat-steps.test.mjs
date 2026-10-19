import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// #29: the chat panel stopped after 5 steps mid-task without saying so.

const { CHAT_STEP_LIMIT, chatPrepareStep, stepLimitNote } = await loadTs("workers/agent/chat-steps.ts");

test("the chat run has room for a multi-item task", () => {
	assert.ok(CHAT_STEP_LIMIT >= 15);
});

test("steps before the last keep their tools and prompt", () => {
	const prepare = chatPrepareStep("PROMPT", 4);
	for (const stepNumber of [0, 1, 2]) assert.deepEqual(prepare({ stepNumber }), {});
});

test("the last step has no tools and says the run stopped", () => {
	const last = chatPrepareStep("PROMPT", 4)({ stepNumber: 3 });
	assert.equal(last.toolChoice, "none");
	assert.ok(last.system.startsWith("PROMPT\n\n"));
	assert.match(last.system, /Stopped after 3 steps\./);
	assert.match(last.system, /ask you to continue/);
	assert.match(stepLimitNote(), new RegExp(`${CHAT_STEP_LIMIT - 1} of ${CHAT_STEP_LIMIT} steps`));
});

test("the chat agent uses the step budget", () => {
	const src = readFileSync(new URL("../workers/agent/index.ts", import.meta.url), "utf8");
	const chat = src.slice(src.indexOf("async onChatMessage"), src.indexOf("async onRequest"));
	assert.match(chat, /stopWhen: stepCountIs\(CHAT_STEP_LIMIT\)/);
	assert.match(chat, /prepareStep: chatPrepareStep\(systemPrompt\)/);
});
