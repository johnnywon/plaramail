import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// #29: the chat panel stopped after 5 steps mid-task without saying so.

const { CHAT_STEP_LIMIT, chatPrepareStep, stepLimitNote, stepLimitLine, withStepLimitLine } = await loadTs("workers/agent/chat-steps.ts");

async function collect(chunks) {
	const stream = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } });
	const out = [];
	for await (const chunk of withStepLimitLine(stream)) out.push(chunk);
	return out;
}

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
	// Workers AI drops toolChoice, so the tools themselves are left out.
	assert.deepEqual(last.activeTools, []);
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
	assert.match(chat, /withStepLimitLine\(result\.toUIMessageStream\(/);
});

test("a run that ends on tool calls gets a stopped line before it finishes", async () => {
	const out = await collect([
		{ type: "start" },
		{ type: "tool-input-available", toolCallId: "c5", toolName: "search_all_mail", input: {} },
		{ type: "finish-step" },
		{ type: "finish", finishReason: "tool-calls" },
	]);
	assert.deepEqual(out.slice(-4).map((c) => c.type), ["text-start", "text-delta", "text-end", "finish"]);
	assert.equal(out.at(-3).delta, `Stopped after ${CHAT_STEP_LIMIT} steps. Ask me to continue.`);
	assert.equal(stepLimitLine(), out.at(-3).delta);
	assert.equal(out.at(-4).id, out.at(-2).id);
});

test("on Workers AI the last step goes out without tools, and a run cut off there says so", async () => {
	const { streamText, stepCountIs, tool } = await import("ai");
	const { z } = await import("zod");
	const { languageModel } = await loadTs("workers/lib/agent-model.ts");
	const calls = [];
	const ai = {
		run: async (_model, inputs) => {
			calls.push(inputs);
			// A model that keeps calling tools, even on the last step if it could.
			return { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: `c${calls.length}`, type: "function", function: { name: "search", arguments: "{}" } }] }, finish_reason: "tool_calls" }] };
		},
	};
	const limit = 3;
	const result = streamText({
		model: languageModel({ AI: ai }, { provider: "workers-ai", id: "@cf/zai-org/glm-5.3-flash" }),
		system: "PROMPT",
		prompt: "Search six things.",
		tools: { search: tool({ inputSchema: z.object({}), execute: async () => ({ count: 1 }) }) },
		stopWhen: stepCountIs(limit),
		prepareStep: chatPrepareStep("PROMPT", limit),
	});
	const out = [];
	for await (const chunk of withStepLimitLine(result.toUIMessageStream(), limit)) out.push(chunk);
	assert.equal(calls.length, limit);
	assert.ok(calls[0].tools?.length);
	assert.equal(calls[limit - 1].tools, undefined);
	assert.ok(out.some((c) => c.type === "text-delta" && c.delta === stepLimitLine(limit)));
});

test("a run that finishes normally is passed through untouched", async () => {
	const chunks = [
		{ type: "start" },
		{ type: "text-start", id: "t" },
		{ type: "text-delta", id: "t", delta: "Done." },
		{ type: "text-end", id: "t" },
		{ type: "finish", finishReason: "stop" },
	];
	assert.deepEqual(await collect(chunks), chunks);
});
