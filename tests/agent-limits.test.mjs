import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Send limits (WON-207): agents and MCP have their own daily and recipient caps, and the check is atomic.

const { sendMail } = await loadTs("workers/lib/send.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const { countRecipients, recipientLimitError } = await loadTs("workers/lib/send-budget.ts");
const { SEND_LIMITS, DEFAULT_AGENT_LIMITS, cleanAgentLimits, parseAgentLimit } = await loadTs("shared/send-limits.ts");
const { readAgentLimits, writeAgentLimits } = await loadTs("workers/lib/agent-limits.ts");

/** An R2 stand-in holding saved agent limits. */
function bucket(limits) {
	const store = new Map(limits ? [["config/agent-limits.json", JSON.stringify(limits)]] : []);
	return {
		store,
		get: async (key) => (store.has(key) ? { json: async () => JSON.parse(store.get(key)) } : null),
		put: async (key, value) => { store.set(key, value); },
	};
}

const MAILBOX = "a@example.com";

async function harness({ failDelivery = 0, limits } = {}) {
	const d1 = await openD1();
	const box = new D1Mailbox(d1.sql, {}, MAILBOX);
	const delivered = [];
	const env = {
		EMAIL: {
			send: async (message) => {
				if (failDelivery > 0) { failDelivery--; throw Object.assign(new Error("delivery down"), { code: "E_RECIPIENT_SUPPRESSED" }); }
				delivered.push(message);
				return { messageId: `p${delivered.length}` };
			},
		},
		BUCKET: bucket(limits),
	};
	const stub = { getEmail: async () => null, markThreadRead: async () => {}, createEmail: async () => {} };
	for (const name of ["takeSendBudget", "refundSendBudget", "claimSendKey", "startSendKey", "recordSendProvider", "finishSendKey", "failSendKey"]) {
		stub[name] = box[name].bind(box);
	}
	const send = (actor, fields = {}) =>
		sendMail(env, MAILBOX, stub, { to: "bob@example.org", from: MAILBOX, subject: "Hi", text: "Hello", ...fields }, { kind: "new" }, { actor });
	const budgetRows = () => d1.exec(`SELECT actor FROM send_budget`).map((r) => r.actor);
	return { d1, box, send, delivered, budgetRows };
}

test("agents and MCP share a daily cap; people keep sending", async () => {
	const h = await harness();
	// Spread over the day, so the hourly limit stays out of it.
	const earlier = new Date(Date.now() - 3 * 3_600_000).toISOString();
	for (let i = 0; i < DEFAULT_AGENT_LIMITS.agentDay - 1; i++) {
		h.d1.exec(`INSERT INTO send_budget (mailbox_id, actor, recipients, at) VALUES (?, ?, 1, ?)`, MAILBOX, i % 2 ? "agent" : "mcp", earlier);
	}
	assert.equal((await h.send("mcp")).ok, true);
	const refused = await h.send("agent");
	assert.equal(refused.status, 429);
	assert.match(refused.error, /agents and MCP/);
	assert.equal((await h.send("mcp")).status, 429);
	assert.equal((await h.send("person")).ok, true);
});

test("the hourly limit covers everyone", async () => {
	const h = await harness();
	for (let i = 0; i < SEND_LIMITS.hour; i++) assert.equal((await h.send("person")).ok, true);
	const refused = await h.send("person");
	assert.equal(refused.status, 429);
	assert.match(refused.error, /per hour/);
	assert.match((await h.send("agent")).error, /per hour/);
});

test("the daily limit counts the last 24 hours only", async () => {
	const h = await harness();
	const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
	const recent = new Date(Date.now() - 2 * 3_600_000).toISOString();
	for (let i = 0; i < SEND_LIMITS.day + 9; i++) {
		h.d1.exec(`INSERT INTO send_budget (mailbox_id, actor, recipients, at) VALUES (?, 'person', 1, ?)`, MAILBOX, i < 10 ? old : recent);
	}
	assert.equal((await h.send("person")).ok, true);
	assert.match((await h.send("person")).error, /per day/);
});

test("the check and the count are one statement, so a burst can't overshoot", async () => {
	const h = await harness();
	const results = await Promise.all(Array.from({ length: DEFAULT_AGENT_LIMITS.agentDay + 5 }, () => h.box.takeSendBudget("agent", 1)));
	assert.equal(results.filter((r) => r.ok).length, DEFAULT_AGENT_LIMITS.agentDay);
	assert.equal(h.budgetRows().length, DEFAULT_AGENT_LIMITS.agentDay);
});

test("recipients per message are capped lower for agents", async () => {
	const h = await harness();
	const many = (n) => Array.from({ length: n }, (_, i) => `r${i}@example.org`);
	const agent = await h.send("agent", { to: many(DEFAULT_AGENT_LIMITS.agentRecipients - 1), cc: ["c@example.org", "d@example.org"] });
	assert.equal(agent.status, 400);
	assert.match(agent.error, /agents and MCP/);
	assert.equal((await h.send("person", { to: many(DEFAULT_AGENT_LIMITS.agentRecipients + 1) })).ok, true);
	assert.equal((await h.send("person", { to: many(SEND_LIMITS.recipients + 1) })).status, 400);
	assert.equal(h.delivered.length, 1);
	assert.equal(countRecipients("a@example.org, b@example.org", ["c@example.org"], undefined), 3);
	assert.equal(recipientLimitError("mcp", DEFAULT_AGENT_LIMITS.agentRecipients), null);
});

test("a send that never delivered gives its slot back", async () => {
	const h = await harness({ failDelivery: 1 });
	await assert.rejects(h.send("agent"), /delivery down/);
	assert.deepEqual(h.budgetRows(), []);
	assert.equal((await h.send("agent")).ok, true);
	assert.deepEqual(h.budgetRows(), ["agent"]);
});

test("limits saved in the console replace the defaults", async () => {
	const h = await harness({ limits: { agentDay: 2, agentRecipients: 3, autoDraftPerSender: 1 } });
	assert.equal((await h.send("agent")).ok, true);
	assert.equal((await h.send("mcp")).ok, true);
	assert.match((await h.send("agent")).error, /max 2 emails per day/);
	assert.equal((await h.send("person", { to: ["a@example.org", "b@example.org", "c@example.org", "d@example.org"] })).ok, true);
	const wide = await harness({ limits: { agentDay: 20, agentRecipients: 3, autoDraftPerSender: 1 } });
	assert.match((await wide.send("agent", { to: ["a@example.org", "b@example.org", "c@example.org", "d@example.org"] })).error, /max 3 per message/);
});

test("an agent day limit of 0 stops agent sending and says where to change it", async () => {
	const h = await harness({ limits: { ...DEFAULT_AGENT_LIMITS, agentDay: 0 } });
	assert.match((await h.send("mcp")).error, /Console > Limits/);
	assert.equal((await h.send("person")).ok, true);
});

test("saved limits are checked: out of range or not whole keeps what was there", async () => {
	assert.deepEqual(cleanAgentLimits({ agentDay: 500, agentRecipients: 0, autoDraftPerSender: 2.5 }), DEFAULT_AGENT_LIMITS);
	assert.deepEqual(cleanAgentLimits({ agentDay: 100, agentRecipients: 50, autoDraftPerSender: 0 }), { agentDay: 100, agentRecipients: 50, autoDraftPerSender: 0 });
	const env = { BUCKET: bucket() };
	assert.deepEqual(await readAgentLimits(env), DEFAULT_AGENT_LIMITS);
	await writeAgentLimits(env, { agentDay: 40 });
	assert.deepEqual(await writeAgentLimits(env, { agentRecipients: 99, autoDraftPerSender: 5 }), { agentDay: 40, agentRecipients: 10, autoDraftPerSender: 5 });
	assert.deepEqual(await readAgentLimits({ BUCKET: { get: async () => { throw new Error("R2 down"); } } }), DEFAULT_AGENT_LIMITS);
});

test("a limit typed in Console > Limits must be a whole number in range; empty is not 0", async () => {
	assert.equal(parseAgentLimit("agentDay", "40"), 40);
	assert.equal(parseAgentLimit("agentDay", " 0 "), 0);
	for (const text of ["", " ", "-", "e", "1e1", "2.5", "-1", "101", "0x10"]) {
		assert.equal(parseAgentLimit("agentDay", text), null, JSON.stringify(text));
	}
	assert.equal(parseAgentLimit("agentRecipients", "0"), null);
});

test("saving a limit doesn't overwrite the others when the saved file can't be read", async () => {
	const store = new Map([["config/agent-limits.json", JSON.stringify({ agentDay: 40, agentRecipients: 5, autoDraftPerSender: 1 })]]);
	const env = { BUCKET: { get: async () => { throw new Error("R2 down"); }, put: async (k, v) => { store.set(k, v); } } };
	await assert.rejects(writeAgentLimits(env, { agentDay: 30 }), /R2 down/);
	assert.deepEqual(JSON.parse(store.get("config/agent-limits.json")), { agentDay: 40, agentRecipients: 5, autoDraftPerSender: 1 });
});

test("GET and PUT /api/v1/agent-limits", async () => {
	const { app } = await loadTs("workers/index.ts");
	const env = { BUCKET: bucket() };
	assert.deepEqual(await (await app.request("/api/v1/agent-limits", {}, env)).json(), DEFAULT_AGENT_LIMITS);
	const put = await app.request("/api/v1/agent-limits", {
		method: "PUT", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ agentDay: 50 }),
	}, env);
	assert.deepEqual(await put.json(), { ...DEFAULT_AGENT_LIMITS, agentDay: 50 });
});

test("the console overview counts each address's sends, runs and failures for the last day", async () => {
	const { agentOverview } = await loadTs("workers/lib/agent-overview.ts");
	const { logActivity } = await loadTs("workers/lib/activity.ts");
	const d1 = await openD1();
	const at = (ms) => new Date(Date.now() - ms).toISOString();
	for (const [actor, ago] of [["person", 60_000], ["agent", 120_000], ["mcp", 2 * 3_600_000], ["agent", 30 * 3_600_000]]) {
		d1.exec(`INSERT INTO send_budget (mailbox_id, actor, recipients, at) VALUES (?, ?, 1, ?)`, MAILBOX, actor, at(ago));
	}
	d1.exec(`INSERT INTO auto_draft_runs (email_id, mailbox_id, thread_id, sender, state, created_at, updated_at) VALUES ('e1', ?, 't', 's', 'drafted', ?, ?), ('e2', ?, 't2', 's', 'failed', ?, ?)`,
		MAILBOX, at(1000), at(1000), MAILBOX, at(1000), at(1000));
	await logActivity(d1.sql, { actor: "mcp", tool: "send_draft", mailboxId: MAILBOX, ok: false, summary: "Agent send limit reached" });
	await logActivity(d1.sql, { actor: "chat", tool: "get_email", mailboxId: MAILBOX, ok: true });
	const overview = await agentOverview(d1.sql, [MAILBOX, "b@example.org"], DEFAULT_AGENT_LIMITS);
	assert.deepEqual(overview.addresses, [
		{ mailboxId: MAILBOX, hour: 2, day: 3, agentDay: 2 },
		{ mailboxId: "b@example.org", hour: 0, day: 0, agentDay: 0 },
	]);
	assert.deepEqual(overview.runs, { drafted: 1, failed: 1 });
	assert.equal(overview.actions, 2);
	assert.equal(overview.failed, 1);
	assert.deepEqual(overview.failures.map((f) => f.tool), ["send_draft"]);
});

test("the console overview counts every failure in the last day, not the newest five (WON-241)", async () => {
	const { agentOverview } = await loadTs("workers/lib/agent-overview.ts");
	const { logActivity } = await loadTs("workers/lib/activity.ts");
	const d1 = await openD1();
	const now = Date.now();
	for (let i = 0; i < 12; i++) await logActivity(d1.sql, { actor: "mcp", tool: "send_draft", mailboxId: MAILBOX, ok: false }, now - 3_600_000 + i);
	for (let i = 0; i < 60; i++) await logActivity(d1.sql, { actor: "chat", tool: "get_email", mailboxId: MAILBOX, ok: true }, now - 1000 + i);
	await logActivity(d1.sql, { actor: "mcp", tool: "send_draft", mailboxId: MAILBOX, ok: false }, now - 30 * 3_600_000);
	const overview = await agentOverview(d1.sql, [MAILBOX], DEFAULT_AGENT_LIMITS, now);
	assert.equal(overview.failed, 12);
	assert.equal(overview.failures.length, 5);
	assert.ok(overview.failures.every((f) => !f.ok));
});
