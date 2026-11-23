import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { openSql } from "./helpers/sql.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Action agents (WON-453): star, label, archive or mark read instead of replying.

const agents = await loadTs("workers/lib/agents.ts");
const actions = await loadTs("workers/lib/agent-actions.ts");
const activity = await loadTs("workers/lib/activity.ts");
const { createActionTools, createAutoDraftTools, autoDraftPrompt } = await loadTs("workers/agent/auto-draft.ts");
const { suggestRule } = await loadTs("shared/agent.ts");

const A = "a@example.com";
const mail = (emailId, fields = {}) => ({ mailboxId: A, emailId, from: "news@example.org", subject: "Weekly digest", body: "This week", ...fields });
const fromRule = [{ field: "from", op: "domain", value: "example.org" }];

/** Mail ops that record each call and change nothing. */
function fakeOps() {
	const calls = [];
	const op = (name) => async (...args) => (calls.push([name, ...args]), { status: "ok" });
	return { calls, ops: { star: op("star"), label: op("label"), archive: op("archive"), read: op("read") } };
}

async function setup() {
	const { sql } = await openD1();
	const { calls, ops } = fakeOps();
	const deps = { sql, ops, labelName: async (id) => (id === "l-news" ? "Newsletters" : null) };
	const make = async (input) => (await agents.createAgent(sql, input)).agent;
	return { sql, calls, deps, make };
}

const activityRows = async (sql) => (await activity.listActivity(sql)).entries;

test("an action agent's Does, mode and label are checked, and a new Does starts in Watch", async () => {
	const { sql, make } = await setup();
	assert.deepEqual(await agents.createAgent(sql, { name: "Tagger", job: "Label newsletters", does: "label" }), { error: "Pick the label it adds" });
	assert.match((await agents.createAgent(sql, { name: "Starrer", job: "Star", does: "star", mode: "draft" })).error, /Watch or On/);
	assert.match((await agents.createAgent(sql, { name: "Replier", job: "Reply", mode: "on" })).error, /On is for action agents/);

	const star = await make({ name: "Starrer", job: "Star mail from example.org", does: "star", rules: fromRule });
	assert.equal(star.does, "star");
	assert.equal(star.mode, "watch");
	assert.equal(star.dailyLimit, agents.ACTION_DAILY_LIMIT);
	assert.equal((await agents.updateAgent(sql, star.id, { mode: "on" })).agent.mode, "on");
	// Archiving is new work: back to Watch.
	const archive = (await agents.updateAgent(sql, star.id, { does: "archive" })).agent;
	assert.deepEqual([archive.does, archive.mode], ["archive", "watch"]);
	const reply = await make({ name: "Replier", job: "Reply", mode: "draft" });
	assert.equal(reply.does, "reply");
	assert.equal(reply.dailyLimit, 25);
	const label = await make({ name: "Tagger", job: "Label newsletters", does: "label", labelId: "l-news" });
	assert.equal(label.labelId, "l-news");
	assert.equal((await agents.updateAgent(sql, label.id, { does: "star" })).agent.labelId, null);
});

test("rules-only fast path: an action agent whose rules pass acts with no model call", async () => {
	const { calls, deps, make, sql } = await setup();
	const star = await make({ name: "Starrer", job: "Star mail from example.org", does: "star", mode: "on", rules: fromRule });
	const first = await actions.actFirst(deps, [star], "leave", mail("e1"));
	assert.equal(first.needsModel, false, "nothing is left for the model");
	assert.deepEqual(calls, [["star", A, "e1", true]]);
	assert.deepEqual(first.acted.map((a) => [a.agent, a.state]), [["Starrer", "done"]]);
	const [entry] = await activityRows(sql);
	assert.equal(entry.tool, "star_email");
	assert.equal(entry.summary, "Starrer · starred");
	assert.equal(entry.undo, first.acted[0].id);

	// Rules that don't pass: no action, and still no model.
	const other = await actions.actFirst(deps, [star], "leave", mail("e2", { from: "bob@example.net" }));
	assert.deepEqual([other.needsModel, other.acted.length, calls.length], [false, 0, 1]);
});

test("inbound mail runs the action agents before the injection scan and the model, and stops when nothing is left", () => {
	const source = readFileSync("workers/agent/index.ts", "utf8");
	const handler = source.slice(source.indexOf("async handleNewEmail("), source.indexOf("private async settle("));
	const at = (s) => {
		const i = handler.indexOf(s);
		assert.ok(i > 0, `${s} is in handleNewEmail`);
		return i;
	};
	assert.ok(at("actFirst(") < at("if (!first.needsModel) return"));
	assert.ok(at("if (!first.needsModel) return") < at("prepareAutoDraft("));
	assert.ok(at("prepareAutoDraft(") < at("agentModel("));
});

test("Watch logs what it would do and changes nothing", async () => {
	const { calls, deps, make, sql } = await setup();
	const label = await make({ name: "Tagger", job: "Label newsletters", does: "label", labelId: "l-news", rules: fromRule });
	const first = await actions.actFirst(deps, [label], "leave", mail("e1"));
	assert.deepEqual(first.acted.map((a) => a.state), ["watched"]);
	assert.deepEqual(calls, []);
	const [entry] = await activityRows(sql);
	assert.equal(entry.summary, "Tagger · Would add label Newsletters");
	assert.equal(entry.undo, null, "nothing to undo");
	assert.equal((await agents.agentStats(sql)).find((s) => s.agentId === label.id).runs.watched, 1);
});

test("On acts once per message: a second run does nothing", async () => {
	const { calls, deps, make } = await setup();
	const archive = await make({ name: "Archiver", job: "Archive digests", does: "archive", mode: "on", rules: fromRule });
	assert.equal((await actions.runAgentAction(deps, archive, mail("e1"))).state, "done");
	assert.equal((await actions.runAgentAction(deps, archive, mail("e1"))).state, "repeat");
	assert.deepEqual((await actions.actFirst(deps, [archive], "leave", mail("e1"))).acted.map((a) => a.state), ["repeat"]);
	assert.deepEqual(calls, [["archive", A, "e1", true]]);
});

test("Undo reverses the action from the Activity log, once", async () => {
	const { calls, deps, make, sql } = await setup();
	const made = {
		star: await make({ name: "S", job: "star", does: "star", mode: "on", rules: fromRule }),
		label: await make({ name: "L", job: "label", does: "label", labelId: "l-news", mode: "on", rules: fromRule }),
		archive: await make({ name: "Ar", job: "archive", does: "archive", mode: "on", rules: fromRule }),
		mark_read: await make({ name: "R", job: "read", does: "mark_read", mode: "on", rules: fromRule }),
	};
	const first = await actions.actFirst(deps, Object.values(made), "leave", mail("e1"));
	assert.deepEqual(first.acted.map((a) => a.state), ["done", "done", "done", "done"]);
	const undoIds = (await activityRows(sql)).map((e) => e.undo).filter(Boolean);
	assert.equal(undoIds.length, 4, "every done action offers Undo");
	calls.length = 0;
	for (const id of undoIds) assert.equal((await actions.undoAgentAction(deps, id)).ok, true);
	assert.deepEqual(calls.map((c) => c[0]).sort(), ["archive", "label", "read", "star"]);
	assert.ok(calls.every((c) => c.at(-1) === false), "each reversed");
	assert.deepEqual(calls.find((c) => c[0] === "label"), ["label", A, "e1", "l-news", false]);

	const entries = await activityRows(sql);
	assert.ok(entries.every((e) => e.undo === null), "undone actions offer no Undo");
	assert.equal(entries.filter((e) => e.tool === "undo_action" && e.actor === "person").length, 4);
	assert.ok(entries.some((e) => e.summary === "Ar · moved back to the inbox"));
	assert.deepEqual(await actions.undoAgentAction(deps, undoIds[0]), { error: "Already undone", status: 409 });
	assert.equal((await actions.undoAgentAction(deps, "nope")).status, 404);
});

test("Undo is offered for 30 days", async () => {
	const { deps, make, sql } = await setup();
	const star = await make({ name: "S", job: "star", does: "star", mode: "on", rules: fromRule });
	const old = Date.now() - 31 * 86_400_000;
	const { id } = await actions.runAgentAction({ ...deps, now: old }, star, mail("e1"));
	assert.equal((await activityRows(sql))[0].undo, null);
	assert.match((await actions.undoAgentAction(deps, id)).error, /30 days/);
});

test("the daily limit stops an action agent, and the message is not acted on later", async () => {
	const { calls, deps, make, sql } = await setup();
	const read = await make({ name: "Reader", job: "Mark digests read", does: "mark_read", mode: "on", rules: fromRule, dailyLimit: 2 });
	const states = [];
	for (const id of ["e1", "e2", "e3"]) states.push((await actions.runAgentAction(deps, read, mail(id))).state);
	assert.deepEqual(states, ["done", "done", "limited"]);
	assert.equal(calls.length, 2);
	assert.equal((await activityRows(sql))[0].summary, "Reader · did not mark read, daily limit of 2 reached");
	// A day later the limit is new, but e3 already had its turn.
	assert.equal((await actions.runAgentAction({ ...deps, now: Date.now() + 86_400_000 + 1000 }, read, mail("e3"))).state, "repeat");
	assert.equal((await actions.runAgentAction({ ...deps, now: Date.now() + 86_400_000 + 1000 }, read, mail("e4"))).state, "done");
	const stats = (await agents.agentStats(sql, Date.now() + 86_400_000 + 1000)).find((s) => s.agentId === read.id);
	assert.equal(stats.runs.done, 3);
	assert.equal(stats.runs.skipped, 1);
});

test("an action agent and a reply agent both handle one message", async () => {
	const { calls, deps, make } = await setup();
	const reply = await make({ name: "Replier", job: "Thank them", mode: "draft", rules: fromRule });
	const star = await make({ name: "Starrer", job: "Star digests", does: "star", mode: "on", rules: fromRule });
	const first = await actions.actFirst(deps, [reply, star], "leave", mail("e1"));
	assert.deepEqual(calls, [["star", A, "e1", true]], "the star happens before the reply");
	assert.equal(first.needsModel, true, "the reply agent still gets the message");
	assert.deepEqual(first.plan.reply.map((a) => a.name), ["Replier"]);
	assert.deepEqual(first.plan.act.map((a) => a.name), ["Starrer"]);
	// The reply run's agents are reply agents only: the star agent can't take the reply.
	const prompt = autoDraftPrompt(A, "t1", { email: { id: "e1", sender: "news@example.org", sender_name: "", subject: "Weekly digest", body_text: "x" }, thread: [] }, first.plan.reply);
	assert.match(prompt, /### Replier/);
	assert.doesNotMatch(prompt, /Starrer/);
	// With no reply agent and unmatched mail drafted, the action still doesn't stop the fallback reply.
	assert.equal((await actions.actFirst(deps, [star], "draft", mail("e2"))).needsModel, true);
});

test("an action agent with no rules asks the model, with only its own tool and no reply tool", async () => {
	const { calls, deps, make } = await setup();
	const star = await make({ name: "Starrer", job: "Star mail from people I know", does: "star", mode: "on" });
	const label = await make({ name: "Tagger", job: "Label invoices", does: "label", labelId: "l-news", mode: "on" });
	const first = await actions.actFirst(deps, [star, label], "leave", mail("e1"));
	assert.deepEqual([first.needsModel, first.acted.length, first.plan.ask.length], [true, 0, 2]);

	const target = { mailboxId: A, emailId: "e1", threadId: "t1", to: "news@example.org" };
	const replyTools = createAutoDraftTools({}, target, { thread: [] }, async () => ({}), { reply: false });
	assert.deepEqual(Object.keys(replyTools).sort(), ["get_email", "get_thread"]);
	const acted = [];
	const tools = createActionTools(target, first.plan.ask, deps, (r) => acted.push(r));
	assert.deepEqual(Object.keys(tools).sort(), ["label_email", "star_email"]);
	assert.deepEqual(await tools.star_email.execute({ agent: "starrer" }), { status: "done", agent: "Starrer" });
	assert.match((await tools.star_email.execute({ agent: "Tagger" })).error, /No agent named "Tagger"/);
	assert.deepEqual(await tools.star_email.execute({ agent: "Starrer" }), { status: "repeat", agent: "Starrer" });
	assert.deepEqual(calls, [["star", A, "e1", true]]);
	assert.deepEqual(acted.map((a) => a.state), ["done", "repeat"]);
	const prompt = autoDraftPrompt(A, "t1", { email: { id: "e1", sender: "news@example.org", sender_name: "", subject: "s", body_text: "x" }, thread: [] }, [], { actions: first.plan.ask, reply: false });
	assert.match(prompt, /Do not reply/);
	assert.doesNotMatch(prompt, /draft_reply/);
	assert.match(prompt, /### Starrer\nJob: Star mail from people I know\nTool: star_email/);
});

test("a failed action is recorded, offers no Undo, and is not retried", async () => {
	const { sql } = await openD1();
	const ops = { ...fakeOps().ops, star: async () => ({ error: "Email not found" }) };
	const star = (await agents.createAgent(sql, { name: "S", job: "star", does: "star", mode: "on", rules: fromRule })).agent;
	const result = await actions.runAgentAction({ sql, ops }, star, mail("e1"));
	assert.deepEqual([result.state, result.error], ["failed", "Email not found"]);
	const [entry] = await activityRows(sql);
	assert.deepEqual([entry.ok, entry.undo, entry.summary], [false, null, "S · did not star, Email not found"]);
	assert.equal((await actions.runAgentAction({ sql, ops }, star, mail("e1"))).state, "repeat");
});

test("migration 0013 keeps every existing agent a reply agent in its mode", async () => {
	const { sql } = openSql();
	const files = (await import("node:fs")).readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
	await sql.schema(files.filter((f) => f < "0013").map((f) => readFileSync(`migrations/${f}`, "utf8")).join("\n"));
	await sql.run(`INSERT INTO agents (id, name, job, mode, created_at, updated_at) VALUES ('a1', 'Old', 'Decline pitches', 'draft', 'x', 'x')`);
	await sql.schema(readFileSync("migrations/0013_action_agents.sql", "utf8"));
	const [old] = await agents.listAgents(sql);
	assert.deepEqual([old.does, old.mode, old.labelId], ["reply", "draft", null]);
});

test("New agent offers a From rule from the job's words", () => {
	assert.deepEqual(suggestRule("favorite emails from northwind when they come in"), { field: "from", op: "contains", value: "northwind" });
	assert.deepEqual(suggestRule("Archive mail from news@example.org."), { field: "from", op: "contains", value: "news@example.org" });
	assert.deepEqual(suggestRule("Label anything from @example.net"), { field: "from", op: "contains", value: "example.net" });
	assert.equal(suggestRule("Star invoices"), null);
});
