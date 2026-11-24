import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// The approval queue from an MCP client (WON-532): held sends and bulk changes,
// and what Approve and Drop do with them.

const run = await loadTs("workers/lib/approval-run.ts");
const q = await loadTs("workers/lib/approvals.ts");
const { toolLabelMatching } = await loadTs("workers/lib/tools.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const activity = await loadTs("workers/lib/activity.ts");

const MAILBOX = "a@example.com";
const CALLER = { clientId: "client-1", clientName: "Claude Code" };

async function harness() {
	const d1 = await openD1();
	await d1.addMailboxes(MAILBOX);
	const delivered = [];
	const bucket = { get: async () => null, put: async () => {}, delete: async () => {} };
	const env = {
		DB: d1.DB,
		BUCKET: bucket,
		EMAIL: { send: async (message) => { delivered.push(message); return { messageId: `p${delivered.length}` }; } },
	};
	const box = new D1Mailbox(d1.sql, bucket, MAILBOX);
	const budget = () => Number(d1.exec(`SELECT COUNT(*) AS n FROM send_budget`)[0].n);
	return { d1, sql: d1.sql, env, box, delivered, budget };
}

const sendArgs = { mailboxId: MAILBOX, to: ["bob@example.org"], subject: "Friday", text: "See you then.", idempotencyKey: "friday-0001" };

test("with Hold off a send goes ahead: holdMcpSend returns null", async () => {
	const h = await harness();
	assert.equal(await run.holdMcpSend(h.env, h.sql, CALLER, "send_email", sendArgs), null);
});

test("a held send is queued, not sent, and takes no place in the daily limit until approved", async () => {
	const h = await harness();
	await q.setHold(h.sql, "mcp", CALLER.clientId, true);
	const held = await run.holdMcpSend(h.env, h.sql, CALLER, "send_email", sendArgs);
	assert.equal(held.status, "queued");
	assert.ok(held.approvalId);
	assert.equal(h.delivered.length, 0);
	assert.equal(h.budget(), 0);
	// A retry with the same key finds the same item.
	assert.equal((await run.holdMcpSend(h.env, h.sql, CALLER, "send_email", sendArgs)).approvalId, held.approvalId);
	// Another client with Hold off is not affected.
	assert.equal(await run.holdMcpSend(h.env, h.sql, { clientId: "client-2", clientName: "Cursor" }, "send_email", sendArgs), null);

	const { waiting } = await q.listQueue(h.sql);
	assert.equal(waiting.length, 1);
	assert.equal(waiting[0].summary, "to bob@example.org · Friday");
	assert.equal(waiting[0].kind, "send");

	const approved = await q.decide(h.sql, held.approvalId, "approve", run.runQueued(h.env));
	assert.equal(approved.item.state, "approved");
	assert.equal(approved.item.result, "sent");
	assert.equal(h.delivered.length, 1);
	assert.equal(h.budget(), 1, "the send counts when it is approved");
	const tools = (await activity.listActivity(h.sql)).entries.map((e) => [e.tool, e.actor, e.client, e.action]);
	assert.deepEqual(tools[0], ["send_email", "mcp", "Claude Code", "send"]);
});

test("a held send that would be refused is refused now, not queued", async () => {
	const h = await harness();
	await q.setHold(h.sql, "mcp", CALLER.clientId, true);
	assert.equal((await run.holdMcpSend(h.env, h.sql, CALLER, "send_email", { ...sendArgs, idempotencyKey: "x" })).code, "invalid_input");
	assert.equal((await run.holdMcpSend(h.env, h.sql, CALLER, "send_draft", { mailboxId: MAILBOX, draftId: "nope" })).code, "not_found");
	assert.equal((await q.listQueue(h.sql)).waiting.length, 0);
});

test("a held draft send, dropped, never goes out and the draft stays", async () => {
	const h = await harness();
	await q.setHold(h.sql, "mcp", CALLER.clientId, true);
	await h.box.createEmail("draft", { id: "d1", subject: "Plans", sender: MAILBOX, recipient: "bob@example.org", date: "2026-11-20T12:00:00.000Z", body: "<p>Hi</p>" }, []);
	const held = await run.holdMcpSend(h.env, h.sql, CALLER, "send_draft", { mailboxId: MAILBOX, draftId: "d1" });
	assert.equal(held.status, "queued");
	const dropped = await q.decide(h.sql, held.approvalId, "drop", run.runQueued(h.env));
	assert.equal(dropped.item.state, "dropped");
	assert.equal(h.delivered.length, 0);
	assert.ok(await h.box.getEmail("d1"), "the draft is kept");
});

test("an approved send still meets the daily limit and fails when it is reached", async () => {
	const h = await harness();
	await q.setHold(h.sql, "mcp", CALLER.clientId, true);
	const held = await run.holdMcpSend(h.env, h.sql, CALLER, "send_email", sendArgs);
	const earlier = new Date(Date.now() - 3_600_000).toISOString();
	for (let i = 0; i < 20; i++) h.d1.exec(`INSERT INTO send_budget (mailbox_id, actor, recipients, at) VALUES (?, 'mcp', 1, ?)`, MAILBOX, earlier);
	const result = await q.decide(h.sql, held.approvalId, "approve", run.runQueued(h.env));
	assert.equal(result.item.state, "failed");
	assert.match(result.item.result, /limit/i);
	assert.equal(h.delivered.length, 0);
});

test("label_matching over more than 25 messages is held; 25 or fewer goes ahead", async () => {
	const h = await harness();
	await q.setHold(h.sql, "mcp", CALLER.clientId, true);
	await h.sql.run(`INSERT INTO labels (id, name, color) VALUES ('receipts', 'Receipts', 'blue')`);
	const add = async (sender, n) => {
		for (let i = 0; i < n; i++) {
			await h.box.createEmail("inbox", {
				id: `${sender}-${i}`, subject: `Receipt ${i}`, sender: `${sender}@example.org`, recipient: MAILBOX,
				date: new Date(Date.now() - (i + 1) * 60_000).toISOString(), body: "Thanks", thread_id: `${sender}-${i}`,
			}, []);
		}
	};
	await add("shop", 30);
	await add("cafe", 5);
	const labelled = (sender) => Number(h.d1.exec(
		`SELECT COUNT(*) AS n FROM message_labels l JOIN messages m ON m.id = l.message WHERE m.sender_addr = ?`, `${sender}@example.org`,
	)[0].n);

	const args = { from: ["shop@example.org"], add: ["Receipts"] };
	const held = await toolLabelMatching(h.env, { from: args.from }, { add: args.add }, run.mcpBulkHold(h.sql, CALLER, "label_matching", args));
	assert.equal(held.status, "queued");
	assert.equal(held.messages, 30);
	assert.equal(labelled("shop"), 0, "nothing changed yet");

	const small = await toolLabelMatching(h.env, { from: ["cafe@example.org"] }, { add: ["Receipts"] }, run.mcpBulkHold(h.sql, CALLER, "label_matching", {}));
	assert.equal(small.status, "updated");
	assert.equal(labelled("cafe"), 5);

	const [item] = (await q.listQueue(h.sql)).waiting;
	assert.equal(item.kind, "bulk");
	assert.equal(item.messages, 30);
	assert.equal(item.summary, "add Receipts · 30 messages in 30 conversations");
	const approved = await q.decide(h.sql, item.id, "approve", run.runQueued(h.env));
	assert.equal(approved.item.state, "approved");
	assert.equal(labelled("shop"), 30);
});
