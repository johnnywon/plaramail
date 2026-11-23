import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Console > MCP lists the tools from shared/mcp-tools.ts; the server must register exactly those.

const { MCP_TOOLS, MCP_GROUPS } = await loadTs("shared/mcp-tools.ts");
const activity = await loadTs("workers/lib/activity.ts");
const { tokenize } = await loadTs("app/components/postal/ConsoleUI.tsx");

test("the server registers exactly the listed tools", () => {
	const src = readFileSync("workers/mcp/index.ts", "utf8");
	const registered = [...src.matchAll(/\btool\(\s*"(\w+)"/g)].map((m) => m[1]).sort();
	assert.deepEqual(registered, MCP_TOOLS.map((t) => t.name).sort());
});

test("every tool has a known group, and every group has a tool", () => {
	const groups = new Set(MCP_GROUPS.map((g) => g.id));
	for (const t of MCP_TOOLS) assert.ok(groups.has(t.group), t.name);
	for (const g of groups) assert.ok(MCP_TOOLS.some((t) => t.group === g), g);
});

test("tools that send or delete sit in the send group", () => {
	const actions = activity.TOOL_ACTIONS;
	for (const t of MCP_TOOLS) {
		if (actions[t.name] === "send" || actions[t.name] === "delete") assert.equal(t.group, "send", t.name);
	}
});

test("mcpUsage counts calls per client and per tool, MCP only", async () => {
	const d1 = await openD1();
	const now = Date.parse("2026-10-13T12:00:00Z");
	const log = (client, tool, at, ok = true) => activity.logActivity(d1.sql, { actor: "mcp", client, tool, ok }, at);
	await log("Claude Code 2.1", "get_email", now - 2 * 86_400_000);
	await log("Claude Code 2.1", "get_email", now - 60_000);
	await log("Claude Code 2.1", "send_draft", now - 30_000, false);
	await log("cursor 1.0", "list_mailboxes", now - 3_600_000);
	await activity.logActivity(d1.sql, { actor: "chat", tool: "get_email", ok: true }, now);
	const usage = await activity.mcpUsage(d1.sql, now);
	assert.deepEqual(usage.clients.map((c) => [c.client, c.calls, c.today, c.errors]), [
		["Claude Code 2.1", 3, 2, 1],
		["cursor 1.0", 1, 1, 0],
	]);
	assert.equal(usage.tools.get_email.calls, 2);
	assert.equal(usage.lastCall, usage.clients[0].last);
});

test("code tints shell commands, flags, strings and variables", () => {
	const kinds = (lang, src) => tokenize(lang, src).filter((t) => t.kind).map((t) => [t.kind, t.text]);
	assert.deepEqual(kinds("sh", 'claude mcp add \\\n  --header "X: $ID" -H $SECRET'), [
		["cmd", "claude"], ["flag", "--header"], ["str", '"X: $ID"'], ["flag", "-H"], ["var", "$SECRET"],
	]);
	assert.deepEqual(kinds("json", '{"url": "https://example.com/mcp"}'), [
		["punct", "{"], ["key", '"url"'], ["punct", ":"], ["str", '"https://example.com/mcp"'], ["punct", "}"],
	]);
	assert.equal(tokenize("sh", "a --b 'c'").map((t) => t.text).join(""), "a --b 'c'");
});
