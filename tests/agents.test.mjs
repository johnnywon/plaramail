import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { openSql } from "./helpers/sql.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Agents (0.9): one job on the addresses it watches, Watch, Draft or Send.

const agents = await loadTs("workers/lib/agents.ts");
const runs = await loadTs("workers/agent/runs.ts");
const { app } = await loadTs("workers/index.ts");

const A = "a@example.com";
const B = "b@example.org";
const mail = (fields = {}) => ({ mailboxId: A, from: "bob@example.net", subject: "Guest post opportunity", body: "Can I write for your blog?", ...fields });

test("an agent starts in Watch at the bottom of the list, and names are unique", async () => {
	const { sql } = await openD1();
	const first = await agents.createAgent(sql, { name: "Outreach", job: "Decline guest-post pitches." });
	const second = await agents.createAgent(sql, { name: "Intake", job: "Ask for the order number.", mode: "draft", addresses: [B] });
	assert.equal(first.agent.mode, "watch");
	assert.equal(first.agent.position, 0);
	assert.equal(second.agent.position, 1);
	assert.deepEqual(second.agent.addresses, [B]);
	assert.deepEqual(await agents.createAgent(sql, { name: "outreach", job: "x" }), { error: "An agent with that name exists" });
	await agents.orderAgents(sql, [second.agent.id, first.agent.id]);
	assert.deepEqual((await agents.listAgents(sql)).map((a) => a.name), ["Intake", "Outreach"]);
	const updated = await agents.updateAgent(sql, first.agent.id, { mode: "draft", rules: [{ field: "subject", op: "contains", value: "guest post" }] });
	assert.equal(updated.agent.mode, "draft");
	assert.equal(updated.agent.job, "Decline guest-post pitches.");
	assert.deepEqual(updated.agent.rules, [{ field: "subject", op: "contains", value: "guest post" }]);
	assert.equal(await agents.deleteAgent(sql, first.agent.id), true);
	assert.equal(await agents.deleteAgent(sql, first.agent.id), false);
});

test("rules narrow the mail down before the model sees it", () => {
	const make = (fields) => ({ id: fields.name, enabled: true, addresses: [], rules: [], ...fields });
	const list = [
		make({ name: "all" }),
		make({ name: "only b", addresses: [B] }),
		make({ name: "guest", rules: [{ field: "subject", op: "contains", value: "guest post, link exchange" }] }),
		make({ name: "not guest", rules: [{ field: "subject", op: "not_contains", value: "guest" }] }),
		make({ name: "net domain", rules: [{ field: "from", op: "domain", value: "@example.net" }] }),
		make({ name: "off", enabled: false }),
	];
	assert.deepEqual(agents.matchAgents(list, mail()).map((a) => a.name), ["all", "guest", "net domain"]);
	assert.deepEqual(agents.matchAgents(list, mail({ mailboxId: B, subject: "Link exchange?", from: "x@example.com" })).map((a) => a.name), ["all", "only b", "guest", "not guest"]);
	assert.deepEqual(agents.matchAgents(list, mail({ subject: "Invoice", from: "c@example.com" })).map((a) => a.name), ["all", "not guest"]);
});

test("migration 0008 adds agents, the run's agent and the draft's agent on top of 0007", async () => {
	const { sql } = openSql();
	const before = readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f) && f < "0008").sort();
	await sql.schema(before.map((f) => readFileSync(`migrations/${f}`, "utf8")).join("\n"));
	await sql.schema(readFileSync("migrations/0008_agents.sql", "utf8"));
	const columns = async (table) => (await sql.all(`SELECT name FROM pragma_table_info('${table}')`)).map((r) => r.name);
	assert.ok((await columns("auto_draft_runs")).includes("agent_id"));
	assert.ok((await columns("draft_notes")).includes("agent"));
	assert.ok((await columns("agents")).includes("job"));
});

test("the version Send arrives in is one constant, and the Console shows it from there (#45)", () => {
	assert.equal(agents.SEND_VERSION, "0.10");
	assert.ok(agents.SEND_LATER.includes(agents.SEND_VERSION));
	const console_ = readFileSync("app/components/postal/Console.tsx", "utf8");
	assert.doesNotMatch(console_, /\b0\.(9|10)\b/, "no version typed into the Console");
	assert.match(console_, /\{SEND_VERSION\}/);
});

test("Send waits for SEND_VERSION: the API refuses it and a stored Send agent works as Draft", async () => {
	assert.equal(agents.SEND_ENABLED, false);
	const refused = agents.AgentBody.partial().safeParse({ mode: "send" });
	assert.equal(refused.success, false);
	assert.equal(refused.error.issues[0].message, agents.SEND_LATER);
	assert.equal(agents.AgentBody.partial().safeParse({ mode: "draft" }).success, true);
	const { sql } = await openD1();
	const made = await agents.createAgent(sql, { name: "Old sender", job: "Decline pitches." });
	await sql.run(`UPDATE agents SET mode = 'send' WHERE id = ?`, made.agent.id);
	assert.equal((await agents.getAgent(sql, made.agent.id)).mode, "draft");
});

test("a run records which agent took it, and ends watched or sent", async () => {
	const { sql } = await openD1();
	const target = (emailId) => ({ mailboxId: A, emailId, threadId: emailId, sender: "bob@example.net" });
	const discard = async () => {};
	await runs.recordRun(sql, target("w"));
	await runs.attemptRun(sql, { emailId: "w" }, async () => ({ status: "watched", agentId: "ag1", reason: "Would reply: no thanks" }), { final: false, discardDraft: discard });
	await runs.recordRun(sql, target("s"));
	await runs.attemptRun(sql, { emailId: "s" }, async () => ({ status: "sent", draftId: null, agentId: "ag1" }), { final: false, discardDraft: discard });
	await runs.recordRun(sql, target("d"));
	await runs.attemptRun(sql, { emailId: "d" }, async () => ({ status: "drafted", draftId: "d1", agentId: "ag2", reason: "daily limit of 0 reached; kept as a draft" }), { final: false, discardDraft: discard });
	const byAgent = await runs.listRuns(sql, { agentId: "ag1" });
	assert.deepEqual(byAgent.map((r) => [r.emailId, r.state]).sort(), [["s", "sent"], ["w", "watched"]]);
	assert.deepEqual(await agents.agentSendsToday(sql, "ag1", "bob@example.net"), { total: 1, toSender: 1 });
	const stats = await agents.agentStats(sql);
	assert.deepEqual(stats.find((s) => s.agentId === "ag1").runs, { sent: 1, watched: 1 });
	assert.equal(stats.find((s) => s.agentId === "ag2").today, 1);
});

test("an agent is working only while a run moved in the last ten minutes", async () => {
	const { sql } = await openD1();
	const now = Date.parse("2026-10-16T12:00:00.000Z");
	const at = (min) => new Date(now - min * 60_000).toISOString();
	const run = (id, state, min) => sql.run(
		`INSERT INTO auto_draft_runs (email_id, mailbox_id, thread_id, sender, state, attempts, agent_id, created_at, updated_at) VALUES (?, ?, ?, 'bob@example.net', ?, 1, ?, ?, ?)`,
		id, A, id, state, id.startsWith("live") ? "ag-live" : "ag-stale", at(min + 1), at(min),
	);
	await run("live-1", "running", 1);
	await run("live-2", "queued", 9);
	await run("stale-1", "running", 60 * 20);
	await run("stale-2", "queued", 11);
	const stats = await agents.agentStats(sql, now);
	assert.equal(stats.find((s) => s.agentId === "ag-live").live, 2);
	assert.equal(stats.find((s) => s.agentId === "ag-stale").live, 0);
	assert.equal(stats.find((s) => s.agentId === "ag-stale").runs.running, 1);
});

test("agent routes", async () => {
	const d1 = await openD1();
	await d1.addMailboxes(A, B);
	const env = { DB: d1.DB, EMAIL_ADDRESSES: [A, B] };
	const call = (path, method = "GET", body) => app.request(`/api/v1/agents${path}`, {
		method, headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: body ? JSON.stringify(body) : undefined,
	}, env);
	const created = await call("", "POST", { name: "Outreach", job: "Decline guest-post pitches." });
	assert.equal(created.status, 201);
	const { id, mode } = await created.json();
	assert.equal(mode, "watch");
	assert.equal((await call("", "POST", { name: " ", job: "x" })).status, 400);
	assert.equal((await call("", "POST", { name: "Bad", job: "x", mode: "shout" })).status, 400);
	assert.equal((await call(`/${id}`, "PUT", { mode: "draft" })).status, 200);
	const list = await (await call("")).json();
	assert.deepEqual(list.agents.map((a) => [a.name, a.mode]), [["Outreach", "draft"]]);
	assert.deepEqual(list.stats, []);
	assert.equal((await call("/order", "PUT", { ids: [id] })).status, 200);
	assert.deepEqual(await (await call(`/${id}/runs`)).json(), []);
	assert.deepEqual(await (await call("/review")).json(), []);
	assert.equal((await call("/nope", "PUT", { name: "X" })).status, 404);
	assert.equal((await call(`/${id}`, "DELETE")).status, 200);
	assert.equal((await call(`/${id}`, "DELETE")).status, 404);
});

test("review lists agent drafts still waiting in Drafts", async () => {
	const d1 = await openD1();
	await d1.addMailboxes(A);
	const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
	const box = new D1Mailbox(d1.sql, { delete: async () => {}, put: async () => {} }, A);
	await box.createEmail("draft", { id: "dr1", subject: "Re: Guest post", sender: A, recipient: "bob@example.net", date: "2026-10-01T10:00:00.000Z", body: "<p>No thanks</p>", thread_id: "t1" }, []);
	await box.setDraftNotes("dr1", { origin: "auto-draft", agent: "Outreach", instructions: [] });
	await box.createEmail("draft", { id: "mine", subject: "Hi", sender: A, recipient: "c@example.com", date: "2026-10-01T11:00:00.000Z", body: "<p>Mine</p>", thread_id: "t2" }, []);
	const list = await agents.listAgentDrafts(d1.sql, [A]);
	assert.deepEqual(list.map((d) => [d.emailId, d.agent]), [["dr1", "Outreach"]]);
});

test("the drafting prompt lists the matched agents' jobs highest first, and the model's pick is found by name", () => {
	assert.match(agents.agentPrompt([{ name: "A", job: "x", instructions: "", exampleReply: "" }]), /highest first. Take the first one whose job fits/);
	const list = [
		{ name: "Penny", job: "Decline pitches.", instructions: "One line.", exampleReply: "" },
		{ name: "Otis", job: "Ask for the order number.", instructions: "", exampleReply: "Could you send it?" },
	];
	const prompt = agents.agentPrompt(list);
	assert.match(prompt, /### Penny\nJob: Decline pitches\.\nInstructions: One line\./);
	assert.match(prompt, /### Otis\nJob: Ask for the order number\.\nExample reply:\nCould you send it\?/);
	assert.equal(agents.agentPrompt([]), "");
	assert.equal(agents.findAgent(list, " penny ")?.name, "Penny");
	assert.equal(agents.findAgent(list, "Mabel"), null);
	assert.equal(agents.findAgent(list, undefined), null);
});

test("list order decides between agents whose jobs fit, not the model", () => {
	const list = [{ name: "Penny" }, { name: "Otis" }, { name: "Mabel" }];
	assert.equal(agents.firstFitting(list, "Mabel", ["otis", "Mabel"])?.name, "Otis");
	assert.equal(agents.firstFitting(list, "Mabel")?.name, "Mabel");
	assert.equal(agents.firstFitting(list, null, []), null);
	assert.equal(agents.firstFitting(list, "Nobody", ["Ghost"]), null);
});

test("a watched run's reason is plain text of the reply, without the quoted original (#46)", () => {
	const body = `<div style="white-space:pre-wrap">Hi Alice,\n\nWe&#39;ve received your message &amp; will reply by Friday.</div><br><blockquote style="border: 1px solid #ddd;">On Sun, Oct 18, 2026, 8:00 AM, alice@example.org wrote:<br><br>Where is my order?</blockquote>`;
	assert.equal(runs.watchedReason(body), "Would reply: Hi Alice, We've received your message & will reply by Friday.");
	assert.equal(runs.watchedReason(""), "Would reply");
	assert.equal(runs.watchedReason(`<p>${"word ".repeat(100)}</p>`).length, "Would reply: ".length + 300);
});

test("a draft a run throws away is logged as discarded, with why (#47)", async () => {
	const { sql } = await openD1();
	const thrown = [];
	const discard = async (mailboxId, id) => { thrown.push([mailboxId, id]); return { status: "discarded" }; };
	// The model drafted, then no agent's job fit: the run ends skipped and its draft goes.
	const settled = runs.settleDrafts(["d1"], null, 1, "leave");
	assert.equal(settled.outcome.status, "skipped");
	await runs.discardRunDrafts(sql, discard, A, settled.discard, settled.outcome.reason);
	assert.deepEqual(thrown, [[A, "d1"]]);
	const rows = await sql.all(`SELECT actor, action, tool, target, summary, ok FROM agent_activity`);
	assert.deepEqual(rows, [{ actor: "auto-draft", action: "delete", tool: "discard_draft", target: "d1", summary: "discarded, no agent's job fits", ok: 1 }]);
});

test("a superseded run's draft is logged as discarded too (#47)", async () => {
	const { sql } = await openD1();
	const target = (emailId) => ({ mailboxId: A, emailId, threadId: "t", sender: "bob@example.net" });
	await runs.recordRun(sql, target("e1"));
	await runs.attemptRun(sql, { emailId: "e1" }, async () => {
		await runs.recordRun(sql, target("e2")); // newer mail in the thread supersedes e1 while it runs
		return { status: "drafted", draftId: "d1" };
	}, { final: false, discardDraft: async () => ({ status: "discarded" }) });
	const rows = await sql.all(`SELECT tool, target, summary FROM agent_activity`);
	assert.deepEqual(rows, [{ tool: "discard_draft", target: "d1", summary: "discarded, newer mail in the thread replaced this run" }]);
});
