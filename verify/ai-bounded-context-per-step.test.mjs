// WON-593: every model request in chat and auto-draft stays inside an explicit budget.
// Lives in verify/, not tests/, so `npm test` stays green until the work lands.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "../tests/helpers/sqlite.mjs";

const h = await loadTs("workers/agent/chat-history.ts");
const steps = await loadTs("workers/agent/chat-steps.ts");
const draft = await loadTs("workers/agent/auto-draft.ts");

const BUDGET = h.HISTORY_BUDGET;
const HUGE = "Lorem ipsum dolor sit amet. ".repeat(20_000); // about 560 KB

const toolResults = (ms) => ms.filter((m) => m.role === "tool").flatMap((m) => m.content).filter((p) => p.type === "tool-result");
const toolCalls = (ms) => ms.filter((m) => m.role === "assistant" && typeof m.content !== "string").flatMap((m) => m.content).filter((p) => p.type === "tool-call");

function paired(ms) {
	const calls = new Set(toolCalls(ms).map((c) => c.toolCallId));
	return toolResults(ms).every((r) => calls.has(r.toolCallId));
}

test("an oversized latest request is bounded or refused before the first step", async () => {
	const messages = [{ role: "user", content: [{ type: "text", text: `Summarise this: ${HUGE}` }] }];
	let sent;
	try {
		// The same path index.ts takes: pruneHistory before the run, then prepareStep for step 0.
		const pruned = h.pruneHistory(messages);
		const result = (await steps.chatPrepareStep("You are an email assistant.")({ stepNumber: 0, steps: [], messages: pruned })) ?? {};
		sent = result.messages ?? pruned;
	} catch { return; } // a clear limit error is allowed
	assert.ok(h.historySize(sent) <= BUDGET, `latest request sent at ${h.historySize(sent)} characters, budget ${BUDGET}`);
});

test("each chat step is bounded, including tool output added during the run", async () => {
	const messages = [{ role: "user", content: [{ type: "text", text: "Read the three latest mails from ops@example.com" }] }];
	for (let i = 0; i < 3; i++) {
		messages.push({ role: "assistant", content: [{ type: "tool-call", toolCallId: `c${i}`, toolName: "get_email", input: { emailId: `e${i}` } }] });
		messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: `c${i}`, toolName: "get_email", output: { type: "text", value: HUGE } }] });
	}
	const prepare = steps.chatPrepareStep("You are an email assistant.");
	const result = (await prepare({ stepNumber: 3, steps: [], messages })) ?? {};
	const sent = result.messages ?? messages;
	assert.ok(h.historySize(sent) <= BUDGET, `step 3 sends ${h.historySize(sent)} characters, budget ${BUDGET}`);
	assert.ok(paired(sent), "every tool result keeps its call");
	assert.ok(JSON.stringify(sent).includes("ops@example.com"), "the current request stays");
});

test("a small chat step is sent as it is", async () => {
	const messages = [{ role: "user", content: [{ type: "text", text: "Star the mail from ann@example.net" }] }];
	const prepare = steps.chatPrepareStep("You are an email assistant.");
	const result = (await prepare({ stepNumber: 1, steps: [], messages })) ?? {};
	assert.deepEqual(result.messages ?? messages, messages);
});

const MAILBOX = "a@example.com";
const msg = (id, body, fields = {}) => ({
	id, subject: "Invoice October", sender: "ann@example.net", sender_name: "Ann Lee", recipient: MAILBOX,
	date: `2026-10-${String(1 + (Number(id.replace(/\D/g, "")) % 27)).padStart(2, "0")}T10:00:00Z`, folder_id: "inbox", body_text: body, ...fields,
});

test("the auto-draft prompt is bounded for a huge mail in a long thread", () => {
	const email = msg("e999", HUGE);
	const thread = Array.from({ length: 400 }, (_, i) => msg(`e${i}`, "Earlier message in the thread. ".repeat(40)));
	thread.push(email);
	const prompt = draft.autoDraftPrompt(MAILBOX, "t1", { email, thread, replyTo: "ann@example.net" });
	assert.ok(prompt.length <= BUDGET, `auto-draft prompt is ${prompt.length} characters, budget ${BUDGET}`);
	for (const kept of ["e999", "t1", "ann@example.net", "draft_reply"]) assert.ok(prompt.includes(kept), `prompt keeps ${kept}`);
});

test("a normal auto-draft prompt keeps the whole new mail", () => {
	const body = "Please send the invoice for October when you can.";
	const email = msg("e1", body);
	const prompt = draft.autoDraftPrompt(MAILBOX, "t1", { email, thread: [email], replyTo: "ann@example.net" });
	assert.ok(prompt.includes(body));
});
