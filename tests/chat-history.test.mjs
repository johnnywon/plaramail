import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { convertToModelMessages } from "ai";
import { loadTs } from "./helpers/sqlite.mjs";

// #65: the chat agent sent its whole history, old tool output included, on every step.

const h = await loadTs("workers/agent/chat-history.ts");

const EMAIL = "Lorem ipsum dolor sit amet. ".repeat(400); // about 11 KB, like a full email body

/** A stored chat like the panel keeps: each request reads an email and answers. */
function chat(turns) {
	const messages = [];
	for (let i = 0; i < turns; i++) {
		messages.push({ id: `u${i}`, role: "user", parts: [{ type: "text", text: `Request ${i}: read the latest mail from ops@example.com` }] });
		messages.push({
			id: `a${i}`,
			role: "assistant",
			parts: [
				{ type: "step-start" },
				{ type: "reasoning", text: `Thinking about request ${i}. `.repeat(20), state: "done" },
				{ type: "tool-get_email", toolCallId: `call${i}`, state: "output-available", input: { emailId: `e${i}` }, output: { id: `e${i}`, body: EMAIL } },
				{ type: "step-start" },
				{ type: "text", text: `Answer ${i}.` },
			],
		});
	}
	return messages;
}

const toolResults = (messages) => messages.filter((m) => m.role === "tool").flatMap((m) => m.content).filter((p) => p.type === "tool-result");
const toolCalls = (messages) => messages.filter((m) => m.role === "assistant" && typeof m.content !== "string").flatMap((m) => m.content).filter((p) => p.type === "tool-call");

test("a long history reaches the model cut down to the last requests plus stubs", async () => {
	const full = await convertToModelMessages(chat(30));
	const pruned = h.pruneHistory(full);
	assert.ok(h.historySize(full) > 300_000, `full history is ${h.historySize(full)}`);
	// Two requests with full output, 28 stubs, short text: well under 40 KB.
	assert.ok(h.historySize(pruned) < 40_000, `pruned history is ${h.historySize(pruned)}`);
	assert.ok(h.historySize(pruned) <= h.HISTORY_BUDGET);

	// Every call keeps its result, so the model still sees what it did.
	const calls = toolCalls(pruned).map((p) => p.toolCallId);
	const results = toolResults(pruned).map((p) => p.toolCallId);
	assert.deepEqual(results, calls);
	assert.equal(calls.length, 30);

	// The last two requests are whole; older output is a stub.
	const whole = toolResults(pruned).filter((p) => JSON.stringify(p.output).includes("Lorem ipsum"));
	assert.deepEqual(whole.map((p) => p.toolCallId), ["call28", "call29"]);
	assert.equal(toolResults(pruned)[0].output.value, h.TOOL_OUTPUT_STUB);
	// Every request and answer is still there.
	assert.equal(pruned.filter((m) => m.role === "user").length, 30);
	assert.match(JSON.stringify(pruned), /Answer 0\./);
});

test("reasoning from earlier replies is not sent", async () => {
	const pruned = h.pruneHistory(await convertToModelMessages(chat(3)));
	assert.doesNotMatch(JSON.stringify(pruned), /Thinking about request/);
});

test("short tool output stays as it is", () => {
	const messages = [
		{ role: "user", content: "label it" },
		{ role: "assistant", content: [{ type: "tool-call", toolCallId: "c", toolName: "create_label", input: { name: "Receipts" } }] },
		{ role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName: "create_label", output: { type: "json", value: { id: "l1", name: "Receipts" } } }] },
		{ role: "user", content: "a" },
		{ role: "user", content: "b" },
	];
	assert.deepEqual(h.pruneHistory(messages), messages);
});

test("over budget, the oldest requests are dropped whole and the last one stays", async () => {
	const full = await convertToModelMessages(chat(10));
	const pruned = h.pruneHistory(full, { budget: 15_000 });
	assert.ok(h.historySize(pruned) <= 15_000 || pruned.filter((m) => m.role === "user").length === 1);
	assert.equal(pruned[0].role, "user");
	assert.match(JSON.stringify(pruned.at(-1)), /Answer 9\./);
	assert.deepEqual(toolResults(pruned).map((p) => p.toolCallId), toolCalls(pruned).map((p) => p.toolCallId));
	// A single huge request is never dropped.
	const one = h.pruneHistory(await convertToModelMessages(chat(1)), { budget: 10 });
	assert.equal(one[0].role, "user");
	assert.match(JSON.stringify(toolResults(one)), /Lorem ipsum/);
});

test("the chat agent prunes its history before the run", () => {
	const src = readFileSync(new URL("../workers/agent/index.ts", import.meta.url), "utf8");
	const chatSrc = src.slice(src.indexOf("async onChatMessage"), src.indexOf("async onRequest"));
	assert.match(chatSrc, /messages: pruneHistory\(await convertToModelMessages\(this\.messages\)\)/);
});
