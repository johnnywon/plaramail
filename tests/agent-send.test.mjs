import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Send mode (WON-534): an agent in Send replies only to the sender, within its
// limits, and holds replies for approval while its switch is on.

const send = await loadTs("workers/lib/agent-send.ts");
const agentMod = await loadTs("shared/agent.ts");
const agents = await loadTs("workers/lib/agents.ts");
const q = await loadTs("workers/lib/approvals.ts");

const T0 = Date.parse("2026-11-20T12:00:00Z");
const DAY = 86_400_000;
const BOX = "hello@example.com";
const SENDER = "dana@example.org";

async function setup({ sendSince = T0 - 10 * DAY, hold = null, draft = {} } = {}) {
	const { sql } = await openD1();
	const agent = (await agents.createAgent(sql, { name: "Decline pitches", job: "Decline guest post pitches" })).agent;
	await sql.run(`UPDATE agents SET mode = 'send', send_since = ? WHERE id = ?`, new Date(sendSince).toISOString(), agent.id);
	if (hold !== null) await q.setHold(sql, "agent", agent.id, hold);
	const sent = [];
	const deps = {
		sql, enabled: true, now: T0,
		getDraft: async (_m, id) => (id === "gone" ? null : { recipient: SENDER, cc: "", bcc: "", subject: "Re: Guest post", ...draft }),
		sendDraft: async (m, id) => (sent.push([m, id]), { status: "sent", sentId: `s-${id}` }),
	};
	// The stored mode reads as Draft while Send is closed; tests act as the open release.
	return { sql, deps, sent, agent: { ...agent, mode: "send", sendSince: new Date(sendSince).toISOString() } };
}

const target = { mailboxId: BOX, emailId: "e1", sender: SENDER };

test("Send opens with the release that reaches SEND_VERSION, and not before", () => {
	assert.equal(agentMod.SEND_VERSION, "0.10");
	assert.equal(agentMod.sendOpen("0.9.8"), false);
	assert.equal(agentMod.sendOpen("0.9.99"), false);
	assert.equal(agentMod.sendOpen("0.10.0"), true);
	assert.equal(agentMod.sendOpen("0.11.2"), true);
	assert.equal(agentMod.sendOpen("1.0.0"), true);
});

test("this release keeps Send closed: the API refuses it and a stored Send works as Draft", async () => {
	const pkg = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync("package.json", "utf8")));
	assert.equal(agents.SEND_ENABLED, agentMod.sendOpen(pkg.version));
	if (agents.SEND_ENABLED) return;
	assert.equal(agents.AgentBody.partial().safeParse({ mode: "send" }).success, false);
	const { sql, agent } = await setup();
	assert.equal((await agents.getAgent(sql, agent.id)).mode, "draft");
	const { deps, sent } = await setup();
	const out = await send.sendAsAgent({ ...deps, enabled: false }, agent, "d1", target);
	assert.equal(out.status, "drafted");
	assert.equal(sent.length, 0);
});

test("past its first 7 days, an agent in Send sends the reply", async () => {
	const { deps, sent, agent } = await setup();
	const out = await send.sendAsAgent(deps, agent, "d1", target);
	assert.deepEqual(out, { status: "sent", draftId: null, agentId: agent.id });
	assert.deepEqual(sent, [[BOX, "d1"]]);
});

test("a reply goes only to the sender: another recipient, Cc or Bcc keeps it a draft", async () => {
	assert.equal(send.notOnlyToSender({ recipient: `Dana <${SENDER}>` }, SENDER), null);
	assert.equal(send.notOnlyToSender({ recipient: "DANA@example.org" }, SENDER), null);
	for (const draft of [{ recipient: "leo@example.net" }, { recipient: `${SENDER}, leo@example.net` }, { cc: "leo@example.net" }, { bcc: "leo@example.net" }, { recipient: "" }]) {
		const { deps, sent, agent } = await setup({ draft });
		const out = await send.sendAsAgent(deps, agent, "d1", target);
		assert.equal(out.status, "drafted", JSON.stringify(draft));
		assert.match(out.reason, /only to the sender/);
		assert.equal(sent.length, 0);
	}
});

test("the daily limit and two a day to one sender keep replies as drafts", async () => {
	const { sql, deps, sent, agent } = await setup();
	const run = (id, sender, state = "sent") => sql.run(
		`INSERT INTO auto_draft_runs (email_id, mailbox_id, thread_id, sender, state, attempts, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
		id, BOX, id, sender, state, agent.id, new Date(T0 - 3_600_000).toISOString(), new Date(T0 - 3_600_000).toISOString(),
	);
	await run("p1", SENDER);
	await run("p2", SENDER);
	const toSender = await send.sendAsAgent(deps, agent, "d1", target);
	assert.match(toSender.reason, /replied to this sender 2 times today/);
	const full = await send.sendAsAgent(deps, { ...agent, dailyLimit: 2 }, "d1", { ...target, sender: "leo@example.net" });
	assert.match(full.reason, /daily limit of 2 reached/);
	assert.equal(sent.length, 0);
});

test("in its first 7 days in Send a reply is held for approval, once", async () => {
	const { sql, deps, sent, agent } = await setup({ sendSince: T0 - DAY });
	const out = await send.sendAsAgent(deps, agent, "d1", target);
	assert.equal(out.status, "drafted");
	assert.equal(out.draftId, "d1");
	assert.match(out.reason, /held for approval/);
	assert.equal(sent.length, 0);
	await send.sendAsAgent(deps, agent, "d1", target);
	const { waiting } = await q.listQueue(sql, T0);
	assert.equal(waiting.length, 1, "a retried run finds the waiting item");
	assert.equal(waiting[0].actor, "agent");
	assert.equal(waiting[0].sourceName, "Decline pitches");
	assert.equal(waiting[0].tool, "send_draft");
	assert.equal(waiting[0].summary, `to ${SENDER} · Re: Guest post`);
});

test("a switch turned off sends at once; one turned on holds after the 7 days", async () => {
	const early = await setup({ sendSince: T0 - DAY, hold: false });
	assert.equal((await send.sendAsAgent(early.deps, early.agent, "d1", target)).status, "sent");
	const late = await setup({ hold: true });
	assert.match((await send.sendAsAgent(late.deps, late.agent, "d1", target)).reason, /held for approval/);
});

test("approving a held reply sends it, marks its run sent, and counts it from then", async () => {
	const { sql, deps, sent, agent } = await setup({ sendSince: T0 - DAY });
	await sql.run(
		`INSERT INTO auto_draft_runs (email_id, mailbox_id, thread_id, sender, state, attempts, agent_id, draft_id, created_at, updated_at) VALUES ('e1', ?, 't1', ?, 'drafted', 1, ?, 'd1', ?, ?)`,
		BOX, SENDER, agent.id, new Date(T0).toISOString(), new Date(T0).toISOString(),
	);
	await send.sendAsAgent(deps, agent, "d1", target);
	const [item] = (await q.listQueue(sql, T0)).waiting;
	const run = (it, args) => send.runHeldReply({ ...deps, now: T0 + 60_000 }, it, args);
	const decided = await q.decide(sql, item.id, "approve", run, T0 + 60_000);
	assert.equal(decided.item.state, "approved", decided.item.result);
	assert.deepEqual(sent, [[BOX, "d1"]]);
	const row = await sql.first(`SELECT state, draft_id FROM auto_draft_runs WHERE email_id = 'e1'`);
	assert.deepEqual({ ...row }, { state: "sent", draft_id: null });
	assert.deepEqual(await agents.agentSendsToday(sql, agent.id, SENDER, T0 + 120_000), { total: 1, toSender: 1 });
});

test("approval refuses a held reply while Send is closed, or when the agent left Send, was deleted, or is over its limit", async () => {
	const { sql, deps, sent, agent } = await setup({ sendSince: T0 - DAY });
	const args = { mailboxId: BOX, draftId: "d1", emailId: "e1", sender: SENDER };
	const it = { sourceId: agent.id };
	assert.deepEqual(await send.runHeldReply({ ...deps, enabled: false }, it, args), { error: "Send is not open in this version" });
	await sql.run(`UPDATE agents SET mode = 'draft' WHERE id = ?`, agent.id);
	assert.deepEqual(await send.runHeldReply(deps, it, args), { error: "The agent is no longer in Send" });
	await sql.run(`UPDATE agents SET mode = 'send', daily_limit = 0 WHERE id = ?`, agent.id);
	assert.match((await send.runHeldReply(deps, it, args)).error, /daily limit of 0 reached/);
	await sql.run(`UPDATE agents SET daily_limit = 25 WHERE id = ?`, agent.id);
	assert.deepEqual(await send.runHeldReply(deps, it, { ...args, draftId: "gone" }), { error: "Draft not found" });
	assert.deepEqual(await send.runHeldReply(deps, { sourceId: "nobody" }, args), { error: "The agent was deleted" });
	assert.equal(sent.length, 0);
});
