import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { loadTs } from "./helpers/sqlite.mjs";

// #61: chat replies carried the model's reasoning as answer text.

const m = await loadTs("workers/lib/agent-model.ts");

const GLM = "@cf/zai-org/glm-5.3-flash";
const KIMI = "@cf/moonshotai/kimi-k2.6";

/** A Workers AI binding that answers with the given replies in turn and records each call's inputs. */
function fakeAi(replies) {
	const calls = [];
	return {
		calls,
		run: async (model, inputs) => {
			calls.push({ model, inputs });
			const r = replies[Math.min(calls.length - 1, replies.length - 1)];
			return {
				choices: [{
					message: { role: "assistant", content: r.content ?? "", reasoning_content: r.reasoning, tool_calls: r.toolCalls },
					finish_reason: r.toolCalls ? "tool_calls" : "stop",
				}],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			};
		},
	};
}

async function run(ai, id, options) {
	const model = m.languageModel({ AI: ai }, { provider: "workers-ai", id }, undefined, options);
	const result = streamText({
		model,
		prompt: "Star the C6 invoice.",
		tools: { search: tool({ inputSchema: z.object({ q: z.string() }), execute: async () => ({ count: 2 }) }) },
		stopWhen: stepCountIs(3),
	});
	const parts = [];
	for await (const chunk of result.toUIMessageStream()) parts.push(chunk);
	return { result, parts, text: await result.text, reasoning: await result.reasoningText };
}

test("reasoning_content comes through as reasoning, not reply text, and isn't sent back as reply text", async () => {
	const ai = fakeAi([
		{ reasoning: "Let me re-read the tools list again.", toolCalls: [{ id: "c1", type: "function", function: { name: "search", arguments: "{\"q\":\"C6\"}" } }] },
		{ reasoning: "The user is asking for the same thing again.", content: "Found 2 conversations." },
	]);
	const { text, reasoning, parts } = await run(ai, GLM, { chat: true });
	assert.equal(text, "Found 2 conversations.");
	assert.match(reasoning, /same thing again/);
	const shown = parts.filter((p) => p.type === "text-delta").map((p) => p.delta).join("");
	assert.doesNotMatch(shown, /re-read|same thing/);
	// The second step's request: the assistant turn carries the tool call but not the reasoning.
	const second = ai.calls[1].inputs.messages;
	const assistant = second.find((x) => x.role === "assistant");
	assert.ok(assistant.tool_calls?.length);
	assert.doesNotMatch(JSON.stringify(second), /re-read the tools/);
});

test("reasoning inside <think> tags is split from the reply", async () => {
	const ai = fakeAi([{ content: "<think>I cannot star emails. I should be honest.</think>There is no star tool." }]);
	const { text, reasoning } = await run(ai, GLM, {});
	assert.equal(text.trim(), "There is no star tool.");
	assert.match(reasoning, /should be honest/);
});

test("chat lowers reasoning on models that leak it; drafts turn it off or down", async () => {
	assert.equal(m.reasoningEffort(GLM, { chat: true }), "low");
	assert.equal(m.reasoningEffort(GLM, { reasoning: false }), "low");
	assert.equal(m.reasoningEffort(KIMI, { reasoning: false }), "none");
	assert.equal(m.reasoningEffort(KIMI, { chat: true }), undefined);
	assert.equal(m.reasoningEffort("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { reasoning: false }), undefined);
	// GLM takes "none" as its highest level, so it must never get it.
	assert.notEqual(m.LOWEST_REASONING[GLM], "none");

	const ai = fakeAi([{ content: "Done." }]);
	await run(ai, GLM, { chat: true });
	assert.equal(ai.calls[0].inputs.reasoning_effort, "low");
	const plain = fakeAi([{ content: "Done." }]);
	await run(plain, KIMI, { chat: true });
	assert.equal(plain.calls[0].inputs.reasoning_effort, undefined);
});

test("the chat agent asks for chat reasoning and doesn't stream reasoning to the panel", () => {
	const src = readFileSync(new URL("../workers/agent/index.ts", import.meta.url), "utf8");
	const chat = src.slice(src.indexOf("async onChatMessage"), src.indexOf("async onRequest"));
	assert.match(chat, /agentModel\(env, \{ chat: true \}\)/);
	assert.match(chat, /sendReasoning: false/);
	// The panel renders text parts only.
	const panel = readFileSync(new URL("../app/components/postal/Agent.tsx", import.meta.url), "utf8");
	assert.doesNotMatch(panel, /type === "reasoning"/);
});
