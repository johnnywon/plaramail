import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// The approval queue (WON-532): agent sends and bulk changes wait for one-click approval.

const q = await loadTs("workers/lib/approvals.ts");
const shared = await loadTs("shared/approvals.ts");
const agents = await loadTs("workers/lib/agents.ts");
const activity = await loadTs("workers/lib/activity.ts");

const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-20T12:00:00Z");

const send = (fields = {}) => ({
	kind: "send", actor: "mcp", sourceId: "client-1", sourceName: "Claude Code", tool: "send_email",
	mailboxId: "hello@example.com", summary: "to dana@example.org · Friday", payload: { to: ["dana@example.org"], subject: "Friday" },
	dedupeKey: "mcp:client-1:key:abcdefgh", ...fields,
});

test("a bulk change is more than 25 messages", () => {
	assert.equal(shared.BULK_OVER, 25);
	assert.equal(shared.isBulk(25), false);
	assert.equal(shared.isBulk(26), true);
});

test("hold defaults: on for an agent's first 7 days in Send, off otherwise and for MCP clients", async () => {
	const day = 86_400_000;
	assert.equal(shared.agentHoldDefault({ mode: "send", sendSince: new Date(T0 - 6 * day).toISOString() }, T0), true);
	assert.equal(shared.agentHoldDefault({ mode: "send", sendSince: new Date(T0 - 7 * day).toISOString() }, T0), false);
	assert.equal(shared.agentHoldDefault({ mode: "draft", sendSince: null }, T0), false);
	assert.equal(shared.agentHoldDefault({ mode: "send", sendSince: null }, T0), false);

	const { sql } = await openD1();
	assert.equal(await q.holdsMcp(sql, "client-1"), false);
	await q.setHold(sql, "mcp", "client-1", true);
	assert.equal(await q.holdsMcp(sql, "client-1"), true);
	assert.equal(await q.holdsMcp(sql, "client-2"), false);

	const agent = { id: "a1", mode: "send", sendSince: new Date(T0 - day).toISOString() };
	assert.equal(await q.holdsAgent(sql, agent, T0), true);
	await q.setHold(sql, "agent", "a1", false);
	assert.equal(await q.holdsAgent(sql, agent, T0), false, "a switch someone set wins over the default");
	assert.deepEqual(await q.listHolds(sql), { agent: { a1: false }, mcp: { "client-1": true } });
});

test("an agent records when it moved into Send", async () => {
	const { sql } = await openD1();
	const a = (await agents.createAgent(sql, { name: "Intake", job: "Ask for missing details" })).agent;
	assert.equal(a.sendSince, null);
	await sql.run(`UPDATE agents SET mode = 'send', send_since = ? WHERE id = ?`, new Date(T0).toISOString(), a.id);
	assert.equal((await agents.getAgent(sql, a.id)).sendSince, new Date(T0).toISOString());
	// Back to Draft clears it, so a later move to Send starts the 7 days again.
	await agents.updateAgent(sql, a.id, { mode: "draft" });
	assert.equal((await agents.getAgent(sql, a.id)).sendSince, null);
});

test("enqueue keeps one waiting item per retried call, and it waits 24 hours", async () => {
	const { sql } = await openD1();
	const first = await q.enqueue(sql, send(), T0);
	assert.equal(first.existing, false);
	assert.equal(first.item.state, "waiting");
	assert.equal(first.item.expiresAt, new Date(T0 + 24 * HOUR).toISOString());
	const again = await q.enqueue(sql, send(), T0 + 1000);
	assert.equal(again.existing, true);
	assert.equal(again.item.id, first.item.id);
	const { waiting } = await q.listQueue(sql, T0 + 2000);
	assert.equal(waiting.length, 1);
	assert.equal(waiting[0].summary, "to dana@example.org · Friday");
	assert.equal("payload" in waiting[0], false, "the list leaves out the call's arguments");
});

test("approve runs the call once, at approval", async () => {
	const { sql } = await openD1();
	const { item } = await q.enqueue(sql, send(), T0);
	const runs = [];
	const run = async (it, payload) => (runs.push([it.id, payload]), { status: "sent", sentId: "m-1" });
	const result = await q.decide(sql, item.id, "approve", run, T0 + HOUR);
	assert.equal(result.item.state, "approved");
	assert.equal(result.item.result, "sent");
	assert.deepEqual(runs, [[item.id, { to: ["dana@example.org"], subject: "Friday" }]]);
	// A second click does nothing.
	const twice = await q.decide(sql, item.id, "approve", run, T0 + HOUR);
	assert.equal(twice.status, 409);
	assert.equal(runs.length, 1);
	// The key is free again: a later call with it queues anew.
	assert.equal((await q.enqueue(sql, send(), T0 + 2 * HOUR)).existing, false);
});

test("a call that fails on approval is marked failed with its error", async () => {
	const { sql } = await openD1();
	const { item } = await q.enqueue(sql, send(), T0);
	const result = await q.decide(sql, item.id, "approve", async () => ({ error: "Daily agent send limit reached", code: "send_limit" }), T0 + HOUR);
	assert.equal(result.item.state, "failed");
	assert.equal(result.item.result, "Daily agent send limit reached");
	const thrown = (await q.enqueue(sql, send({ dedupeKey: "other" }), T0)).item;
	const crashed = await q.decide(sql, thrown.id, "approve", async () => { throw new Error("D1 went away"); }, T0 + HOUR);
	assert.equal(crashed.item.state, "failed");
	assert.equal(crashed.item.result, "D1 went away");
});

test("drop never runs the call and logs it", async () => {
	const { sql } = await openD1();
	const { item } = await q.enqueue(sql, send(), T0);
	let ran = false;
	const result = await q.decide(sql, item.id, "drop", async () => { ran = true; return {}; }, T0 + HOUR);
	assert.equal(ran, false);
	assert.equal(result.item.state, "dropped");
	assert.equal(result.item.result, "Dropped");
	const [entry] = (await activity.listActivity(sql)).entries;
	assert.equal(entry.tool, "drop_queued");
	assert.equal(entry.actor, "person");
	assert.equal(entry.client, "Claude Code");
	assert.match(entry.summary, /to dana@example.org · Friday/);
	assert.equal((await q.decide(sql, "nope", "drop", async () => ({}), T0)).status, 404);
});

test("after 24 hours an item expires: it is dropped, logged, and can't be approved", async () => {
	const { sql } = await openD1();
	const { item } = await q.enqueue(sql, send(), T0);
	const bulk = (await q.enqueue(sql, send({ kind: "bulk", tool: "label_matching", dedupeKey: null, summary: "add Receipts", messages: 40 }), T0 + HOUR)).item;
	assert.equal(await q.expireQueue(sql, T0 + 24 * HOUR - 1), 0);
	assert.equal(await q.expireQueue(sql, T0 + 24 * HOUR), 1);
	let ran = false;
	const late = await q.decide(sql, item.id, "approve", async () => { ran = true; return {}; }, T0 + 24 * HOUR + 1);
	assert.equal(late.status, 409);
	assert.equal(ran, false);
	const { waiting, recent } = await q.listQueue(sql, T0 + 24 * HOUR + 1);
	assert.deepEqual(waiting.map((i) => i.id), [bulk.id]);
	assert.equal(recent[0].state, "dropped");
	assert.equal(recent[0].result, "Expired after 24 hours");
	const [entry] = (await activity.listActivity(sql)).entries;
	assert.equal(entry.tool, "drop_queued");
	assert.equal(entry.actor, "mcp");
	assert.match(entry.summary, /Expired after 24 hours/);
	// listQueue expires what is due on its own, without the cron.
	const { waiting: later } = await q.listQueue(sql, T0 + 26 * HOUR);
	assert.equal(later.length, 0);
});

test("messagesIn counts the messages in the conversations a bulk change covers", async () => {
	const d1 = await openD1();
	await d1.addMailboxes("hello@example.com");
	const now = new Date(T0).toISOString();
	let n = 0;
	for (const [thread, count] of [["t1", 20], ["t2", 10]]) {
		for (let i = 0; i < count; i++) {
			n++;
			await d1.sql.run(
				`INSERT INTO messages (mailbox_id, email_id, folder_id, thread_id, conversation_id, date) VALUES ('hello@example.com', ?, 'inbox', ?, ?, ?)`,
				`e${n}`, thread, thread, now,
			);
		}
	}
	const K1 = "hello@example.com\u001ft1", K2 = "hello@example.com\u001ft2";
	assert.equal(await q.messagesIn(d1.sql, [K1]), 20);
	assert.equal(await q.messagesIn(d1.sql, [K1, K2]), 30);
	assert.equal(await q.messagesIn(d1.sql, []), 0);
});
