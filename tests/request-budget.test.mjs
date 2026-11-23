import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-593: every chat and drafting request stays inside a size budget, including an
// oversized latest request and tool output added during a run. Synthetic mail only.

const b = await loadTs("workers/agent/request-budget.ts");
const h = await loadTs("workers/agent/chat-history.ts");
const { chatPrepareStep } = await loadTs("workers/agent/chat-steps.ts");
const draft = await loadTs("workers/agent/auto-draft.ts");

const words = (n, seed = "lorem") => `${seed} ipsum dolor sit amet. `.repeat(Math.ceil(n / 28)).slice(0, n);
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const call = (id, input = { emailId: id }) => ({ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: "get_email", input }] });
const result = (id, value) => ({ role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: "get_email", output: { type: "json", value } }] });
const size = (messages) => h.historySize(messages);
const pairs = (messages) => ({
	calls: messages.filter((m) => m.role === "assistant").flatMap((m) => m.content).filter((p) => p.type === "tool-call").map((p) => p.toolCallId),
	results: messages.filter((m) => m.role === "tool").flatMap((m) => m.content).filter((p) => p.type === "tool-result").map((p) => p.toolCallId),
});
const textOf = (m) => (typeof m.content === "string" ? m.content : m.content.filter((p) => p.type === "text").map((p) => p.text).join(""));

test("regression: pruneHistory alone leaves an oversized latest request over its budget", (t) => {
	const ask = `Please reply to this thread. ${words(300_000)} Send the reply to finance@example.com only.`;
	const messages = [user(ask)];
	const pruned = h.pruneHistory(messages);
	assert.ok(size(pruned) > h.HISTORY_BUDGET, "the one request stays whole");
	const bounded = b.boundRequest(pruned, b.CHAT_REQUEST_BUDGET, 10_000);
	t.diagnostic(`oversized request: ${size(pruned)} characters before, ${size(bounded)} after`);
	assert.ok(size(bounded) <= b.CHAT_REQUEST_BUDGET - 10_000);
	const text = textOf(bounded[0]);
	assert.ok(text.startsWith("Please reply to this thread."), "its start stays");
	assert.ok(text.endsWith("Send the reply to finance@example.com only."), "its end, with the recipient, stays");
	assert.match(text, /characters left out of the middle to keep this request under its size limit/);
});

test("tool output added during one request is stubbed oldest first, and every call keeps its result", (t) => {
	const messages = [user("Summarise the last ten emails from ops@example.com")];
	for (let i = 0; i < 10; i++) messages.push(call(`c${i}`), result(`c${i}`, { id: `e${i}`, body: words(30_000, `mail${i}`) }));
	const bounded = b.boundRequest(messages, b.CHAT_REQUEST_BUDGET, 8_000);
	t.diagnostic(`ten 30K results: ${size(messages)} characters before, ${size(bounded)} after`);
	assert.ok(size(messages) > b.CHAT_REQUEST_BUDGET);
	assert.ok(size(bounded) <= b.CHAT_REQUEST_BUDGET - 8_000);
	const { calls, results } = pairs(bounded);
	assert.deepEqual(results, calls);
	assert.equal(calls.length, 10);
	const outputs = bounded.filter((m) => m.role === "tool").map((m) => m.content[0].output);
	assert.deepEqual(outputs[0], { type: "text", value: b.RESULT_STUB }, "the oldest goes first");
	for (const output of outputs.slice(-b.KEEP_RESULTS)) assert.equal(output.type, "json", "the latest results stay whole");
	assert.equal(textOf(bounded[0]), "Summarise the last ten emails from ops@example.com", "the request itself is untouched");
});

test("one result bigger than the whole budget is cut to its start, with a note", () => {
	const messages = [user("Read e1"), call("c1"), result("c1", { id: "e1", body: words(400_000) })];
	const bounded = b.boundRequest(messages, b.CHAT_REQUEST_BUDGET);
	assert.ok(size(bounded) <= b.CHAT_REQUEST_BUDGET);
	const output = bounded[2].content[0].output;
	assert.equal(output.type, "text");
	assert.match(output.value, /^\{"id":"e1","body":"lorem/);
	assert.match(output.value, /characters left out of the end to keep this request under its size limit\]$/);
});

test("earlier requests go before anything in the current one is cut", () => {
	const old = [user("Old request"), call("o1"), result("o1", { body: words(170_000) }), { role: "assistant", content: [{ type: "text", text: "Done." }] }];
	const now = [user("New request"), call("n1"), result("n1", { body: words(5_000) })];
	const bounded = b.boundRequest([...old, ...now], b.CHAT_REQUEST_BUDGET);
	assert.deepEqual(bounded, now);
});

test("a request inside the budget goes as it is, and prepareStep then changes nothing", () => {
	const messages = [user("Hi"), call("c1"), result("c1", { body: "short" })];
	assert.equal(b.boundRequest(messages, b.CHAT_REQUEST_BUDGET), messages);
	assert.deepEqual(chatPrepareStep("PROMPT", 20)({ stepNumber: 1, messages }), {});
});

test("every step of a long chat run is held to the budget, the system prompt and tools counted", (t) => {
	const fixed = b.fixedSize("S".repeat(20_000), { get_email: { description: "Get an email", inputSchema: { type: "object" } } });
	assert.ok(fixed > 20_000);
	const prepare = chatPrepareStep("S".repeat(20_000), 20, { fixed });
	const messages = [user("Go through my inbox")];
	const sizes = [];
	for (let step = 0; step < 19; step++) {
		messages.push(call(`c${step}`), result(`c${step}`, { body: words(25_000, `s${step}`) }));
		const sent = prepare({ stepNumber: step, messages }).messages ?? messages;
		sizes.push(size(sent));
		assert.ok(size(sent) + fixed <= b.CHAT_REQUEST_BUDGET, `step ${step} sends ${size(sent) + fixed}`);
		const { calls, results } = pairs(sent);
		assert.deepEqual(results, calls);
	}
	t.diagnostic(`19 steps of 25K results: unbounded last step ${size(messages) + fixed}, bounded ${sizes.at(-1) + fixed}`);
	const last = prepare({ stepNumber: 19, messages });
	assert.deepEqual(last.activeTools, [], "the last step still has no tools");
	assert.ok(last.messages, "and is still bounded");
});

test("clipText keeps the start, or the start and the end, and says how much went", () => {
	assert.equal(b.clipText("short", 10), "short");
	assert.equal(b.clipText("abcdefghij", 4), `abcd\n${b.cutNote(6, "end")}`);
	const both = b.clipText("A".repeat(50) + "B".repeat(50), 40, "both");
	assert.ok(both.startsWith("A".repeat(30)) && both.endsWith("B".repeat(10)));
	assert.match(both, /\[60 characters left out of the middle/);
});

// Drafting

const MAILBOX = "a@example.com";
const message = (i, length) => ({
	id: `e${i}`, date: new Date(Date.UTC(2026, 9, 1, i)).toISOString(), folder_id: "inbox", sender: "ann@example.net", sender_name: "Ann",
	recipient: MAILBOX, subject: "Long thread", body_text: words(length, `m${i}`),
});

test("the drafting prompt quotes a bounded part of a long email and a long thread", (t) => {
	const thread = Array.from({ length: 40 }, (_, i) => message(i, 3_000));
	const email = { ...message(40, 60_000) };
	thread.push(email);
	const prompt = draft.autoDraftPrompt(MAILBOX, "t1", { email, thread, replyTo: "ann@example.net" });
	const unbounded = email.body_text.length + thread.reduce((n, m) => n + 600, 0);
	t.diagnostic(`drafting prompt: about ${unbounded} characters unbounded, ${prompt.length} bounded`);
	assert.ok(prompt.length <= draft.PROMPT_BODY_MAX + draft.PROMPT_HISTORY_MAX + 2_000, `prompt is ${prompt.length}`);
	assert.match(prompt, /characters left out of the end/);
	assert.match(prompt, /earlier messages left out; get_thread has them/);
	assert.ok(prompt.includes("[2026-10-02T15:00:00.000Z]"), "the newest earlier message is quoted");
	assert.ok(!prompt.includes("[2026-10-01T00:00:00.000Z]"), "the oldest is left out");
});

test("a short thread is quoted whole, as before", () => {
	const thread = [message(0, 200), message(1, 300)];
	const prompt = draft.autoDraftPrompt(MAILBOX, "t1", { email: thread[1], thread, replyTo: "ann@example.net" });
	assert.ok(prompt.includes(thread[1].body_text));
	assert.ok(prompt.includes(thread[0].body_text));
	assert.doesNotMatch(prompt, /left out/);
});

test("get_thread and get_email return bounded text once per run", async () => {
	const thread = Array.from({ length: 30 }, (_, i) => message(i, 10_000));
	const target = { mailboxId: MAILBOX, emailId: "e29", threadId: "t1", to: "ann@example.net" };
	const { get_thread, get_email } = draft.createAutoDraftTools({}, target, { thread }, async () => ({}));
	const first = await get_thread.execute({});
	assert.equal(first.message_count, 30);
	assert.ok(JSON.stringify(first).length <= draft.THREAD_MAX + 500, `get_thread returned ${JSON.stringify(first).length}`);
	assert.equal(first.messages.at(-1).id, "e29", "the newest are kept");
	assert.match(first.messages.at(-1).body_text, /characters left out of the end/);
	assert.match(first.left_out, /earlier messages left out/);
	assert.match((await get_thread.execute({})).note, /already have this thread/);

	const big = { ...message(99, 50_000) };
	const one = draft.createAutoDraftTools({}, target, { thread: [big] }, async () => ({})).get_email;
	const email = await one.execute({ emailId: "e99" });
	assert.ok(email.body_text.length <= draft.EMAIL_BODY_MAX + 100);
	assert.equal(email.sender, "ann@example.net");
	assert.match((await one.execute({ emailId: "e99" })).note, /already have this email/);
});
