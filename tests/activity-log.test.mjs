import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// The activity log of agent and MCP actions (WON-208).

const activity = await loadTs("workers/lib/activity.ts");
const { logTools, defineTool } = await loadTs("workers/agent/tool-def.ts");
const { pruneAgentHistory } = await loadTs("workers/cron.ts");
const { app } = await loadTs("workers/index.ts");

const MAILBOX = "a@example.com";
const rows = (d1) => d1.exec(`SELECT mailbox_id, actor, client, action, tool, target, summary, ok FROM agent_activity ORDER BY id`);

test("every tool the agents and MCP expose has an action", () => {
	const mcp = readFileSync("workers/mcp/index.ts", "utf8");
	assert.doesNotMatch(mcp, /this\.server\.tool\(/, "MCP tools register through the logging wrapper");
	const mcpTools = [...mcp.matchAll(/\btool\(\s*"(\w+)"/g)].map((m) => m[1]);
	const agent = readFileSync("workers/agent/index.ts", "utf8") + readFileSync("workers/agent/auto-draft.ts", "utf8");
	const agentTools = [...agent.matchAll(/^\t+(\w+): defineTool\(/gm)].map((m) => m[1]);
	assert.ok(mcpTools.length > 15 && agentTools.length > 15);
	for (const name of ["label_conversation", "star_conversation"]) assert.ok(mcpTools.includes(name) && agentTools.includes(name), name);
	for (const name of [...mcpTools, ...agentTools]) assert.ok(activity.TOOL_ACTIONS[name], `${name} has no action`);
});

test("describeCall names the address, the target and what happened", () => {
	assert.deepEqual(
		activity.describeCall("send_draft", { mailboxId: "A@example.com", draftId: "d1" }, { status: "sent", to: "bob@example.org", subject: "Hi" }),
		{ mailboxId: MAILBOX, target: "d1", summary: "to bob@example.org · Hi · sent", ok: true },
	);
	assert.deepEqual(
		activity.describeCall("label_matching", { from: ["receipts@example.org"], add: ["Receipts"] }, { count: 12 }),
		{ mailboxId: null, target: null, summary: "add Receipts · 12 matched", ok: true },
	);
	assert.deepEqual(
		activity.describeCall("move_email", { emailId: "e1", folderId: "archive" }, { error: "Email not found" }, MAILBOX),
		{ mailboxId: MAILBOX, target: "e1", summary: "to archive · Email not found", ok: false },
	);
	assert.equal(activity.describeCall("search_all_mail", { query: "invoice" }, []).summary, "\"invoice\"");
	assert.equal(activity.TOOL_ACTIONS.star_conversation, "label");
	assert.deepEqual(
		activity.describeCall("star_conversation", { mailboxId: MAILBOX, emailId: "e1", starred: false }, { status: "unstarred", emailId: "e1" }),
		{ mailboxId: MAILBOX, target: "e1", summary: "unstarred", ok: true },
	);
});

test("logged records the call and passes its result or error through", async () => {
	const d1 = await openD1();
	const who = { actor: "mcp", client: "Claude Code 2.1" };
	assert.deepEqual(await activity.logged(d1.sql, who, "get_email", { mailboxId: MAILBOX, emailId: "e1" }, async () => ({ id: "e1" })), { id: "e1" });
	await assert.rejects(activity.logged(d1.sql, who, "delete_email", { mailboxId: MAILBOX, emailId: "e2" }, async () => { throw new Error("D1 down"); }), /D1 down/);
	assert.deepEqual(rows(d1), [
		{ mailbox_id: MAILBOX, actor: "mcp", client: "Claude Code 2.1", action: "read", tool: "get_email", target: "e1", summary: null, ok: 1 },
		{ mailbox_id: MAILBOX, actor: "mcp", client: "Claude Code 2.1", action: "delete", tool: "delete_email", target: "e2", summary: "D1 down", ok: 0 },
	]);
});

test("a failed log write never fails the call", async () => {
	const broken = { run: async () => { throw new Error("no table"); } };
	assert.equal(await activity.logged(broken, { actor: "chat" }, "list_labels", {}, async () => "ok"), "ok");
});

test("agent tools are logged with the bound address", async () => {
	const d1 = await openD1();
	const tools = logTools({
		draft_reply: defineTool({ description: "", parameters: { parse: (v) => v }, execute: async () => ({ status: "draft_saved", draftId: "d9" }) }),
	}, d1.sql, { actor: "auto-draft", bound: MAILBOX });
	assert.deepEqual(await tools.draft_reply.execute({ subject: "Re: Hi" }), { status: "draft_saved", draftId: "d9" });
	assert.deepEqual(rows(d1), [
		{ mailbox_id: MAILBOX, actor: "auto-draft", client: null, action: "draft", tool: "draft_reply", target: "d9", summary: "Re: Hi", ok: 1 },
	]);
});

test("listActivity filters and pages newest first", async () => {
	const d1 = await openD1();
	for (let i = 0; i < 5; i++) await activity.logActivity(d1.sql, { actor: i % 2 ? "mcp" : "chat", tool: "get_email", mailboxId: MAILBOX, target: `e${i}`, ok: true });
	await activity.logActivity(d1.sql, { actor: "chat", tool: "send_draft", mailboxId: "b@example.org", target: "d1", ok: true });
	const first = await activity.listActivity(d1.sql, { limit: 2 });
	assert.deepEqual(first.entries.map((e) => e.target), ["d1", "e4"]);
	const second = await activity.listActivity(d1.sql, { limit: 2, before: first.next });
	assert.deepEqual(second.entries.map((e) => e.target), ["e3", "e2"]);
	assert.deepEqual((await activity.listActivity(d1.sql, { actor: "mcp" })).entries.map((e) => e.target), ["e3", "e1"]);
	assert.deepEqual((await activity.listActivity(d1.sql, { mailboxId: "B@example.org" })).entries.map((e) => e.action), ["send"]);
	assert.deepEqual((await activity.listActivity(d1.sql, { action: "send" })).next, null);
});

test("the cron prunes past the retention set in prefs", async () => {
	const d1 = await openD1();
	const now = Date.now();
	const day = 86_400_000;
	for (const age of [10, 100, 130, 200]) {
		d1.exec(`INSERT INTO agent_activity (at, actor, action, tool, ok) VALUES (?, 'chat', 'read', 'get_email', 1)`, new Date(now - age * day).toISOString());
		d1.exec(`INSERT INTO auto_draft_runs (email_id, mailbox_id, thread_id, sender, state, created_at, updated_at) VALUES (?, ?, 't', 's', 'drafted', ?, ?)`,
			`e${age}`, MAILBOX, new Date(now - age * day).toISOString(), new Date(now - age * day).toISOString());
	}
	const store = new Map([["config/prefs.json", JSON.stringify({ activityDays: 120 })]]);
	const env = { DB: d1.DB, BUCKET: { get: async (k) => (store.has(k) ? { json: async () => JSON.parse(store.get(k)) } : null) } };
	assert.deepEqual(await pruneAgentHistory(env, now), { days: 120, activity: 2, runs: 2, abandoned: 0 });
	store.clear();
	assert.deepEqual(await pruneAgentHistory(env, now), { days: 90, activity: 1, runs: 1, abandoned: 0 });
});

test("GET /api/v1/activity lists entries, with filters", async () => {
	const d1 = await openD1();
	await activity.logActivity(d1.sql, { actor: "mcp", client: "Cursor 1.0", tool: "send_draft", mailboxId: MAILBOX, target: "d1", ok: true });
	await activity.logActivity(d1.sql, { actor: "chat", tool: "get_email", mailboxId: MAILBOX, target: "e1", ok: true });
	const get = async (query) => (await app.request(`/api/v1/activity${query}`, {}, { DB: d1.DB })).json();
	assert.deepEqual((await get("")).entries.map((e) => e.tool), ["get_email", "send_draft"]);
	const mcp = await get("?actor=mcp");
	assert.equal(mcp.entries.length, 1);
	assert.equal(mcp.entries[0].client, "Cursor 1.0");
	// An unknown filter value is ignored rather than matching nothing.
	assert.equal((await get("?actor=robot")).entries.length, 2);
});

test("an auto-draft saved from the model's text is logged like draft_reply (WON-242)", async () => {
	const { saveTextDraft } = await loadTs("workers/agent/auto-draft.ts");
	const d1 = await openD1();
	const saved = [];
	const stub = { createEmail: async (folder, email) => saved.push([folder, email]), setDraftNotes: async () => {} };
	const ids = [];
	await saveTextDraft(stub, d1.sql, { mailboxId: MAILBOX, emailId: "e1", threadId: "t1", to: "bob@example.org" }, "Lunch", "Sounds good.", (id) => ids.push(id));
	assert.equal(saved.length, 1);
	assert.equal(saved[0][1].subject, "Re: Lunch");
	assert.deepEqual(ids, [saved[0][1].id]);
	assert.deepEqual(rows(d1), [
		{ mailbox_id: MAILBOX, actor: "auto-draft", client: null, action: "draft", tool: "draft_reply", target: ids[0], summary: "to bob@example.org · Re: Lunch", ok: 1 },
	]);
});

test("a redraft from the app is logged as the person, not the chat agent (WON-244)", async () => {
	const route = readFileSync("workers/index.ts", "utf8").match(/\/redraft", async[\s\S]*?\n\}\);/)[0];
	assert.match(route, /logged\(sql, \{ actor: "person"/);
	const d1 = await openD1();
	await activity.logActivity(d1.sql, { actor: "person", tool: "redraft", mailboxId: MAILBOX, target: "d1", ok: true });
	await activity.logActivity(d1.sql, { actor: "chat", tool: "get_email", mailboxId: MAILBOX, ok: true });
	const res = await (await app.request("/api/v1/activity?actor=person", {}, { DB: d1.DB })).json();
	assert.deepEqual(res.entries.map((e) => e.tool), ["redraft"]);
});
