import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { statements } from "./helpers/schema.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// A demo build (PLARAMAIL_DEMO=1): sample mail, no sends, two capped AI actions, no MCP, read-only settings, no sign-in, hourly reset.

const DEMO_DEFINE = { __PLARAMAIL_DEMO__: "true" };
const asModule = (bundle) => import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const { demoRefusal, demoBlocksPath, DEMO, demoAiCall, demoAiCap, claimDemoAiCall, DEMO_AI_DAILY } = await loadTs("workers/lib/demo.ts");
const { d1Sql } = await loadTs("workers/store/sql.ts");

test("without the build flag DEMO is false", () => {
	assert.equal(DEMO, false);
});

const SEND = "Sending is off in the demo";
const AI = "AI is off in the demo";
const SETTINGS = "Settings are read-only in the demo";

// Every write route in the API, with what a demo does with it. A new write route fails here until it is listed.
const WRITES = {
	"POST /api/v1/dev/seed": SETTINGS,
	"POST /api/v1/dev/seed-agents": SETTINGS,
	"POST /api/v1/agents": SETTINGS,
	"PUT /api/v1/agents/order": SETTINGS,
	"PUT /api/v1/agents/:id": SETTINGS,
	"DELETE /api/v1/agents/:id": SETTINGS,
	"DELETE /api/v1/mcp/apps/:id": SETTINGS,
	"PUT /api/v1/prefs": SETTINGS,
	"PUT /api/v1/agent-model": SETTINGS,
	"POST /api/v1/agent-model/test": AI,
	"POST /api/v1/mailboxes": SETTINGS,
	"PUT /api/v1/mailboxes/:mailboxId": SETTINGS,
	"PUT /api/v1/agent-limits": SETTINGS,
	"POST /api/v1/mail/bulk": null,
	"POST /api/v1/mail/bulk/undo": null,
	"POST /api/v1/mail/empty-trash": null,
	"POST /api/v1/search/interpret": null,
	"POST /api/v1/saved-searches": null,
	"PUT /api/v1/saved-searches/:id": null,
	"DELETE /api/v1/saved-searches/:id": null,
	"POST /api/v1/labels": null,
	"PUT /api/v1/labels/:id": null,
	"DELETE /api/v1/labels/:id": null,
	"POST /api/v1/labels/import-folders": null,
	"POST /api/v1/mailboxes/:mailboxId/emails": SEND,
	"POST /api/v1/mailboxes/:mailboxId/drafts": null,
	"POST /api/v1/mailboxes/:mailboxId/drafts/:id/redraft": null,
	"POST /api/v1/mailboxes/:mailboxId/scheduled": SEND,
	"DELETE /api/v1/mailboxes/:mailboxId/scheduled/:emailId": null,
	"DELETE /api/v1/mailboxes/:mailboxId/emails/:id": null,
	"POST /api/v1/mailboxes/:mailboxId/threads/:threadId/read": null,
	"POST /api/v1/mailboxes/:mailboxId/emails/:id/reply": SEND,
	"POST /api/v1/mailboxes/:mailboxId/emails/:id/forward": SEND,
	"POST /api/v1/mailboxes/:mailboxId/emails/:id/unsubscribe": "Unsubscribe is off in the demo",
	"POST /api/v1/mailboxes/:mailboxId/emails/:id/block": SETTINGS,
	"DELETE /api/v1/mailboxes/:mailboxId/blocked-senders/:address": SETTINGS,
};

const sample = (route) => route.replace(":mailboxId", "hello@example.com").replace(/:[a-zA-Z]+/g, "x1");

test("every write route in the API has a decided demo rule", () => {
	const source = readFileSync("workers/index.ts", "utf8");
	const routes = [...source.matchAll(/app\.(post|put|patch|delete)\("([^"]+)"/g)].map(([, m, p]) => `${m.toUpperCase()} ${p}`);
	assert.ok(routes.length > 20);
	assert.deepEqual(routes.filter((r) => !(r in WRITES)), [], "add new write routes to WRITES");
	for (const [route, expected] of Object.entries(WRITES)) {
		const [method, path] = route.split(" ");
		assert.equal(demoRefusal(method, sample(path)), expected, route);
	}
});

test("reads go through, and an unknown write is refused", () => {
	for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(demoRefusal(method, "/api/v1/anything"), null);
	assert.equal(demoRefusal("PATCH", "/api/v1/mail/bulk"), SETTINGS);
	assert.equal(demoRefusal("POST", "/api/v1/something-new"), SETTINGS);
	assert.equal(demoRefusal("POST", "/api/v1/labels/x/y"), SETTINGS);
});

test("two AI actions count against the daily cap; the model test and everything else stay off", () => {
	assert.equal(demoAiCall("POST", "/api/v1/search/interpret"), true);
	assert.equal(demoAiCall("POST", "/api/v1/mailboxes/a@example.com/drafts/d1/redraft"), true);
	for (const [m, p] of [["GET", "/api/v1/search/interpret"], ["POST", "/api/v1/agent-model/test"], ["POST", "/api/v1/mailboxes/a@example.com/drafts"]]) assert.equal(demoAiCall(m, p), false, `${m} ${p}`);
	assert.equal(demoAiCap(undefined), DEMO_AI_DAILY);
	assert.equal(demoAiCap(""), DEMO_AI_DAILY);
	assert.equal(demoAiCap("lots"), DEMO_AI_DAILY);
	assert.equal(demoAiCap("-3"), DEMO_AI_DAILY);
	assert.equal(demoAiCap("0"), 0);
	assert.equal(demoAiCap("25"), 25);
});

test("the MCP server and the agent socket are off", () => {
	for (const p of ["/mcp", "/mcp/session", "/agents/email-agent/x", "/authorize", "/.well-known/oauth-authorization-server"]) assert.equal(demoBlocksPath(p), true, p);
	for (const p of ["/", "/api/v1/mail", "/mcpx", "/agentsx"]) assert.equal(demoBlocksPath(p), false, p);
});

const api = await asModule(await build({
	entryPoints: ["workers/index.ts"], bundle: true, platform: "node", format: "esm", write: false, define: DEMO_DEFINE,
}));
const ENV = { DOMAINS: "example.com", EMAIL_ADDRESSES: ["hello@example.com"], DEV_SEED: "off", AUTO_DRAFT_ENABLED: "true" };
const WRITE_HEADERS = { "content-type": "application/json", "sec-fetch-site": "same-origin" };

test("a demo API refuses sends, AI and settings with a 403 before any handler runs", async () => {
	for (const [route, expected] of Object.entries(WRITES)) {
		if (!expected || route.includes("dev/seed")) continue;
		const [method, path] = route.split(" ");
		const response = await api.app.request(`http://localhost${sample(path)}`, { method, headers: WRITE_HEADERS, body: "{}" }, ENV);
		assert.equal(response.status, 403, route);
		assert.deepEqual(await response.json(), { error: expected }, route);
	}
});

test("a demo says so in its config and never auto-drafts", async () => {
	const config = await (await api.app.request("http://localhost/api/v1/config", {}, ENV)).json();
	assert.equal(config.demo, true);
	assert.equal(config.autoDraft, false);
});

test("a demo rejects incoming mail", async () => {
	let reason = null;
	await api.receiveEmail({ to: "hello@example.com", raw: new ReadableStream(), rawSize: 0, setReject: (r) => { reason = r; } }, ENV, { waitUntil() {} });
	assert.equal(reason, "This address does not take mail");
});

test("the dev seed route is still dev-only in a demo", async () => {
	const response = await api.app.request("http://localhost/api/v1/dev/seed", { method: "POST", headers: WRITE_HEADERS, body: "{}" }, ENV);
	assert.equal(response.status, 403);
});

// workers/app.ts with its heavy imports stubbed; Access is not configured.
async function appWith(define) {
	const stubs = {
		"virtual:react-router/server-build": "export default {};",
		"react-router": "export const createRequestHandler = () => () => new Response('spa');",
		"agents": "export const routeAgentRequest = async () => new Response('agent');",
		"jose": "export const jwtVerify = async () => ({}); export const createRemoteJWKSet = () => ({});",
		"./cron": "export const runCron = async () => {};",
		"./lib/access-config": "export const accessConfigError = () => 'not set up'; export const accessJwks = () => ({}); export const getAccessUrls = () => ({});",
		"./lib/error-page": "export const errorResponse = (_r, status) => new Response('error', { status });",
		"./index": "import { Hono } from 'hono'; export const app = new Hono(); export const receiveEmail = async () => {};",
		"./mcp": "export class EmailMCP { static serve() { return { fetch: async () => new Response('mcp') }; } }",
		"./mcp/authorize": "export const authorize = async () => new Response('consent');",
		"./mcp/oauth": "export const withMcpOAuth = (web) => (req, env, ctx) => new URL(req.url).pathname.startsWith('/mcp') ? new Response('oauth', { status: 401 }) : web.fetch(req, env, ctx);",
		"./agent": "export class EmailAgent {}",
	};
	const bundle = await build({
		entryPoints: ["workers/app.ts"], bundle: true, platform: "node", format: "esm", write: false,
		define: { "import.meta.env": JSON.stringify({ DEV: false, MODE: "production" }), ...define },
		plugins: [{
			name: "app-test-stubs",
			setup(b) {
				b.onResolve({ filter: /.*/ }, (args) => {
					if (args.path === "virtual:react-router/server-build") return { path: args.path, namespace: "app-stub" };
					if (args.importer.endsWith("/workers/app.ts") && stubs[args.path]) return { path: args.path, namespace: "app-stub" };
				});
				b.onLoad({ filter: /.*/, namespace: "app-stub" }, (args) => ({ contents: stubs[args.path], loader: "js", resolveDir: process.cwd() }));
			},
		}],
	});
	const mod = await asModule(bundle);
	return (path) => mod.default.fetch(new Request(`https://mail.example.com${path}`), {}, { waitUntil() {} });
}

test("a demo needs no sign-in and has no MCP server or agent socket", async () => {
	const fetchDemo = await appWith(DEMO_DEFINE);
	const home = await fetchDemo("/");
	assert.equal(home.status, 200);
	assert.equal(await home.text(), "spa");
	for (const p of ["/mcp", "/mcp/session", "/agents/email-agent/shared", "/authorize", "/.well-known/oauth-protected-resource/mcp"]) {
		assert.equal((await fetchDemo(p)).status, 403, p);
	}
});

test("a normal production build still fails closed without Access; /mcp answers with OAuth instead", async () => {
	const fetchProd = await appWith({ __PLARAMAIL_DEMO__: "false" });
	assert.equal((await fetchProd("/")).status, 500);
	assert.equal((await fetchProd("/authorize")).status, 500, "the consent page is behind Access");
	assert.equal((await fetchProd("/mcp")).status, 401, "MCP clients bring an OAuth token, not an Access sign-in");
});

// The cron on D1, as a demo.
const A = "hello@example.com";
let mf;

before(async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/cron-worker.ts"], bundle: true, format: "esm", platform: "neutral",
		conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"], external: ["cloudflare:workers"],
		write: false, logLevel: "silent", define: DEMO_DEFINE,
	});
	mf = new Miniflare({
		modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		bindings: { EMAIL_ADDRESSES: [A] }, r2Buckets: ["BUCKET"], d1Databases: ["DB"],
	});
	for (const s of statements(D1_SCHEMA)) await call("_sql", s);
	await call("register", A);
});

after(async () => {
	await mf?.dispose();
});

async function call(op, ...args) {
	const response = await mf.dispatchFetch("http://test/", { method: "POST", body: JSON.stringify({ op, args }) });
	const body = await response.json();
	if (body.error !== undefined) throw new Error(`${op}: ${body.error}`);
	return body.ok;
}
const count = async (sql) => (await call("rows", sql))[0].n;

test("the demo cron sends nothing and writes the sample inbox again on the hour", async () => {
	const T0 = Date.parse("2026-10-13T09:00:00Z");
	const due = await call("scheduleSend", A, {
		sendAt: new Date(T0 - 60_000).toISOString(), mode: "new",
		email: { to: "c@example.net", from: A, subject: "due", html: "<p>due</p>" },
	});
	assert.ok(due.id);
	await call("_sql", `INSERT INTO labels (id, name, color) VALUES ('visitor', 'Visitor label', '#888888')`);
	await call("_sql", `INSERT INTO agent_activity (at, actor, action, tool, summary) VALUES ('2026-10-13T08:30:00Z', 'person', 'draft', 'redraft', 'a visitor''s instruction')`);

	const [quiet] = await call("cron", T0 + 5 * 60_000);
	assert.deepEqual(quiet, { demo: null });
	assert.equal(await count(`SELECT COUNT(*) AS n FROM messages WHERE email_id = '${due.id}'`), 1, "off the hour nothing changes");

	const [reset] = await call("cron", T0);
	assert.ok(reset.demo.messages >= 300);
	assert.deepEqual(await call("sent"), [], "nothing was sent");
	assert.equal(await count(`SELECT COUNT(*) AS n FROM messages`), reset.demo.messages, "only sample mail is left");
	assert.equal(await count(`SELECT COUNT(*) AS n FROM scheduled_sends`), 0);
	assert.equal(await count(`SELECT COUNT(*) AS n FROM labels WHERE name = 'Visitor label'`), 0);
	assert.equal(await count(`SELECT COUNT(*) AS n FROM labels`), reset.demo.labels);
	assert.equal(await count(`SELECT COUNT(*) AS n FROM agent_activity`), 0, "visitors' activity is gone");
	const newest = (await call("rows", `SELECT MAX(date) AS d FROM messages WHERE folder_id = 'inbox'`))[0].d;
	assert.ok(T0 - Date.parse(newest) < 3_600_000, `newest inbox mail is fresh: ${newest}`);

	const [again] = await call("cron", T0 + 3_600_000);
	assert.equal(again.demo.messages, reset.demo.messages, "a second reset writes the same inbox");
	assert.equal(await count(`SELECT COUNT(*) AS n FROM messages`), reset.demo.messages);
});

test("a first request during the reset doesn't seed the inbox a second time", async () => {
	await call("_sql", "DELETE FROM messages");
	await call("marker", new Date().toISOString());
	await call("ensure");
	assert.equal(await count("SELECT COUNT(*) AS n FROM messages"), 0, "the reset is writing the inbox, so the request leaves it");
	await call("marker", new Date(Date.now() - 3_600_000).toISOString());
	await call("ensure");
	assert.ok(await count("SELECT COUNT(*) AS n FROM messages") > 0, "a marker left by a reset that died doesn't block seeding");
	await call("marker", "");
});

test("the daily AI cap: calls stop at the cap and start again the next UTC day", async () => {
	const db = d1Sql(await mf.getD1Database("DB"));
	const day = new Date("2026-10-14T10:00:00Z");
	const taken = [];
	for (let i = 0; i < 4; i++) taken.push(await claimDemoAiCall(db, 3, day));
	assert.deepEqual(taken, [true, true, true, false]);
	assert.equal(await claimDemoAiCall(db, 0, day), false, "a cap of 0 turns AI off");
	assert.equal(await claimDemoAiCall(db, 3, new Date("2026-10-15T00:00:01Z")), true, "a new day has its own allowance");
	assert.equal(await count(`SELECT COUNT(*) AS n FROM ai_budget`), 1, "earlier days are cleared");
	const [reset] = await call("cron", Date.parse("2026-10-15T01:00:00Z"));
	assert.ok(reset.demo, "the hourly reset ran");
	assert.equal(await count(`SELECT COUNT(*) AS n FROM ai_budget`), 1, "the hourly reset keeps the day's count");
});

test("a demo API answers 429 once the day's AI calls are used, before any model runs", async () => {
	const DB = await mf.getD1Database("DB");
	await call("_sql", "DELETE FROM ai_budget");
	const ask = (env) => api.app.request("http://localhost/api/v1/search/interpret", { method: "POST", headers: WRITE_HEADERS, body: JSON.stringify({ text: "invoices from last week" }) }, { ...ENV, DB, ...env });
	const off = await ask({ DEMO_AI_DAILY: "0" });
	assert.equal(off.status, 429);
	assert.deepEqual(await off.json(), { error: "The demo's AI calls for today are used up" });
	const first = await ask({ DEMO_AI_DAILY: "1" });
	// The test has no AI binding, so the handler falls back to a word search.
	assert.equal(first.status, 502, "the first call reaches the handler");
	assert.equal((await first.json()).query, "invoices from last week");
	assert.equal((await ask({ DEMO_AI_DAILY: "1" })).status, 429, "the second is refused");
});

test("an invalid request doesn't use the day's AI allowance", async () => {
	const DB = await mf.getD1Database("DB");
	await call("_sql", "DELETE FROM ai_budget");
	const url = "http://localhost/api/v1/search/interpret";
	const env = { ...ENV, DB, DEMO_AI_DAILY: "5" };
	const noOrigin = await api.app.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "invoices" }) }, env);
	assert.equal(noOrigin.status, 403, "csrf refuses it");
	const badBody = await api.app.request(url, { method: "POST", headers: WRITE_HEADERS, body: JSON.stringify({ text: 42 }) }, env);
	assert.equal(badBody.status, 400);
	assert.equal(await count("SELECT COUNT(*) AS n FROM ai_budget"), 0);
	// Regression: ISSUE-005 — Redraft spent the allowance before checking the draft
	const missing = await api.app.request("http://localhost/api/v1/mailboxes/hello%40example.com/drafts/no-such-draft/redraft", { method: "POST", headers: WRITE_HEADERS, body: JSON.stringify({ instruction: "shorter" }) }, env);
	assert.equal(missing.status, 404);
	const blank = await api.app.request("http://localhost/api/v1/mailboxes/hello%40example.com/drafts/no-such-draft/redraft", { method: "POST", headers: WRITE_HEADERS, body: JSON.stringify({ instruction: "   " }) }, env);
	assert.equal(blank.status, 400);
	assert.equal(await count("SELECT COUNT(*) AS n FROM ai_budget"), 0, "neither used the allowance");
});

test("a demo keeps the agent entry points, answers in the panel with a notice, and its Console is Settings only", async () => {
	const { readFileSync } = await import("node:fs");
	const read = (f) => readFileSync(`app/components/postal/${f}`, "utf8");
	const agent = read("Agent.tsx");
	assert.match(agent, /return useDemo\(\) \? <DemoAgentPanel \{\.\.\.props\} \/> : <LiveAgentPanel \{\.\.\.props\} \/>;/, "the demo panel has no agent socket");
	const demoPanel = agent.slice(agent.indexOf("function DemoNotice"), agent.indexOf("function LiveAgentPanel"));
	assert.doesNotMatch(demoPanel, /useAgent|useAgentChat/);
	assert.match(demoPanel, /<DemoNotice \/>/, "the empty chat shows the notice");
	assert.match(demoPanel, /<DemoNotice compact \/>/, "a question gets the compact notice as the reply");
	assert.match(agent, /if \(demo\) return Promise\.reject\(new Error\(DEMO_AGENT_NOTICE\)\);/, "Draft and Draft reply show the notice");
	assert.doesNotMatch(read("SearchBar.tsx"), /demo/, "search keeps its Ask rows");
	assert.doesNotMatch(read("Reader.tsx"), /!demo/, "the Reply bar keeps Draft reply");
	assert.match(read("PostalMail.tsx"), /const panelOpen = mobile \? panelTemp/);
	const consolePage = read("Console.tsx");
	assert.match(consolePage, /demo && !isSettingsTab\(props\.tab\) \? "general" : props\.tab/, "an agent page opens Preferences");
	assert.match(consolePage, /demo \? CONSOLE_RAIL\.filter\(\(g\) => g\.tabs\.every\(isSettingsTab\)\)/, "the rail shows the settings groups only");
	const consoleSrc = read("Modals.tsx");
	assert.match(consoleSrc, /READ_ONLY_IN_DEMO = new Set<ConsoleTab>\(\["general", "addresses", "signatures", "shortcuts"\]\)/);
});

test("after the first full write, the hourly reset puts the copied inbox back without writing it again", async () => {
	const T0 = Date.parse("2026-10-13T12:00:00Z");
	const [first] = await call("cron", T0);
	const [second] = await call("cron", T0 + 3_600_000);
	assert.equal(second.demo.restored, true, "the second reset restores the copy");
	assert.equal(second.demo.messages, first.demo.messages ?? second.demo.messages);
	const copied = await count("SELECT COUNT(*) AS n FROM demo_snapshot_messages");
	const labels = await count("SELECT COUNT(*) AS n FROM labels");
	const links = await count("SELECT COUNT(*) AS n FROM message_labels");

	// A visitor moves and stars a message, deletes a sample label, adds one, writes a draft and edits a sample draft.
	const [msg] = await call("rows", "SELECT id, email_id, folder_id, starred FROM messages WHERE folder_id = 'inbox' ORDER BY id LIMIT 1");
	await call("_sql", `UPDATE messages SET folder_id = 'trash', starred = 1 WHERE id = ${msg.id}`);
	const [label] = await call("rows", "SELECT id FROM labels ORDER BY id LIMIT 1");
	await call("_sql", `DELETE FROM labels WHERE id = '${label.id}'`);
	await call("_sql", "INSERT INTO labels (id, name, color) VALUES ('visitor', 'Visitor', '#888888')");
	await call("createEmail", A, "draft", { id: "visitor-draft", subject: "Visitor draft", sender: A, recipient: "x@example.net", date: new Date(T0).toISOString(), body: "<p>quokka</p>" }, []);
	const [draft] = await call("rows", "SELECT id, subject FROM messages WHERE folder_id = 'draft' AND email_id != 'visitor-draft' ORDER BY id LIMIT 1");
	await call("_sql", `UPDATE messages SET subject = 'zebra subject', body = '<p>zebra</p>' WHERE id = ${draft.id}`);
	await call("_sql", `DELETE FROM messages_fts WHERE rowid = ${draft.id}`);
	await call("_sql", `INSERT INTO messages_fts (rowid, subject, sender_name, sender_addr, recipients, body_text, attachment_names) VALUES (${draft.id}, 'zebra subject', '', '', '', 'zebra', '')`);
	await call("_sql", "INSERT INTO agent_activity (at, actor, action, tool, summary) VALUES ('2026-10-13T12:30:00Z', 'person', 'draft', 'redraft', 'typed by a visitor')");

	const [third] = await call("cron", T0 + 2 * 3_600_000);
	assert.equal(third.demo.restored, true);
	assert.equal(third.demo.reindexed, 1, "the edited sample draft's index rows are written again");
	assert.equal(await count("SELECT COUNT(*) AS n FROM messages"), copied);
	const [back] = await call("rows", `SELECT folder_id, starred FROM messages WHERE id = ${msg.id}`);
	assert.deepEqual(back, { folder_id: msg.folder_id, starred: msg.starred });
	assert.equal(await count("SELECT COUNT(*) AS n FROM labels"), labels);
	assert.equal(await count("SELECT COUNT(*) AS n FROM labels WHERE id = 'visitor'"), 0);
	assert.equal(await count("SELECT COUNT(*) AS n FROM message_labels"), links);
	assert.equal(await count("SELECT COUNT(*) AS n FROM messages WHERE email_id = 'visitor-draft'"), 0);
	assert.equal(await count("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'zebra'"), 0);
	assert.equal(await count("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'quokka'"), 0);
	const word = String(draft.subject).match(/[A-Za-z]{4,}/)?.[0];
	if (word) assert.ok(await count(`SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH '${word}'`) > 0, `the draft's own subject (${word}) is found again`);
	assert.equal(await count("SELECT COUNT(*) AS n FROM agent_activity"), 0);
});

// Regression: ISSUE-001 — editing a sample draft deletes it and its file, which forced a full write
// Found by /qa on 2026-10-15
// Report: .gstack/qa-reports/run-20261015T132922Z/qa-report-localhost-2026-10-15.md
test("a reset after a visitor edits a sample draft restores it from the copy, file included", async () => {
	const T0 = Date.parse("2026-10-14T12:00:00Z");
	await call("cron", T0);
	await call("cron", T0 + 3_600_000);
	const [taken] = await call("rows", "SELECT v FROM demo_snapshot_meta WHERE k = 'taken_at'");
	const [draft] = await call("rows", "SELECT m.email_id, m.mailbox_id, a.id AS att, a.filename FROM messages m JOIN attachments a ON a.email_id = m.email_id ORDER BY m.folder_id = 'draft' DESC, m.id LIMIT 1");
	const files = await call("r2", "list", "attachments/");
	// Saving an edited draft deletes the old one and its files, then writes a new draft.
	// Emptying Trash takes the same path for any message.
	await call("_sql", `UPDATE messages SET folder_id = CASE WHEN folder_id = 'draft' THEN 'draft' ELSE 'trash' END WHERE email_id = '${draft.email_id}'`);
	await call("deleteEmail", draft.mailbox_id, draft.email_id);
	const key = files.find((k) => k.includes(`/${draft.att}/`));
	assert.ok(key, "the draft's file is in R2");
	await call("r2", "delete", key);
	await call("createEmail", draft.mailbox_id, "draft", { id: "edited-draft", subject: "zebra", sender: draft.mailbox_id, recipient: "x@example.net", date: new Date(T0).toISOString(), body: "<p>zebra</p>" }, []);

	const [reset] = await call("cron", T0 + 2 * 3_600_000);
	assert.equal(reset.demo.restored, true, "restored from the copy, not written again");
	const [after] = await call("rows", "SELECT v FROM demo_snapshot_meta WHERE k = 'taken_at'");
	assert.equal(after.v, taken.v, "the copy wasn't retaken");
	assert.equal(await count(`SELECT COUNT(*) AS n FROM messages WHERE email_id = '${draft.email_id}'`), 1);
	assert.equal(await count(`SELECT COUNT(*) AS n FROM attachments WHERE id = '${draft.att}'`), 1);
	assert.equal(await count("SELECT COUNT(*) AS n FROM messages WHERE email_id = 'edited-draft'"), 0);
	assert.ok((await call("r2", "list", "attachments/")).includes(key), "the file is back");
	const [{ id }] = await call("rows", `SELECT id FROM messages WHERE email_id = '${draft.email_id}'`);
	assert.equal(await count(`SELECT COUNT(*) AS n FROM messages_fts WHERE rowid = ${id}`), 1, "the draft is searchable again");
});

// Regression: ISSUE-002 — a swapped pair of sample label names made every restore fail on UNIQUE(name)
// Regression: ISSUE-003 — a restore that threw never fell back to a full write
// Regression: ISSUE-004 — deleting every sample message made the restore's statement count grow with them
// Found by /qa review on 2026-10-15
test("the reset survives swapped label names, deletes of every sample message, and a broken copy", async () => {
	const T0 = Date.parse("2026-10-15T12:00:00Z");
	await call("cron", T0);
	await call("cron", T0 + 3_600_000);
	const copied = await count("SELECT COUNT(*) AS n FROM demo_snapshot_messages");
	const [a, b] = await call("rows", "SELECT id, name FROM labels ORDER BY id LIMIT 2");
	await call("_sql", `UPDATE labels SET name = 'tmp-swap' WHERE id = '${a.id}'`);
	await call("_sql", `UPDATE labels SET name = '${a.name.replace(/'/g, "''")}' WHERE id = '${b.id}'`);
	await call("_sql", `UPDATE labels SET name = '${b.name.replace(/'/g, "''")}' WHERE id = '${a.id}'`);
	await call("_sql", "DELETE FROM messages");
	const [r1] = await call("cron", T0 + 2 * 3_600_000);
	assert.equal(r1.demo.restored, true, "restored, not written again");
	assert.equal(r1.demo.reindexed, copied);
	const names = Object.fromEntries((await call("rows", `SELECT id, name FROM labels WHERE id IN ('${a.id}', '${b.id}')`)).map((r) => [r.id, r.name]));
	assert.deepEqual(names, { [a.id]: a.name, [b.id]: b.name });
	assert.equal(await count("SELECT COUNT(*) AS n FROM messages"), copied);
	assert.equal(await count("SELECT COUNT(*) AS n FROM messages_fts"), copied, "every sample message is searchable again");
	assert.equal(await count("SELECT COUNT(*) AS n FROM messages_trigram"), copied);

	// A copy the restore can't apply: the reset writes the inbox again instead of failing every hour.
	await call("_sql", `UPDATE demo_snapshot_meta SET v = '["no_such_column"]' WHERE k = 'columns'`);
	const [r2] = await call("cron", T0 + 3 * 3_600_000);
	assert.notEqual(r2.demo.restored, true);
	assert.ok(r2.demo.messages > 0);
	const [meta] = await call("rows", "SELECT v FROM demo_snapshot_meta WHERE k = 'taken_at'");
	assert.equal(Number(meta.v), T0 + 3 * 3_600_000, "a new copy was taken");
});
