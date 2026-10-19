import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { statements } from "./helpers/schema.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// End to end in local workerd: an MCP SDK client gets an OAuth token through the consent
// page, then talks to EmailMCP over Streamable HTTP with it.

/** The Worker's compatibility flags from wrangler.jsonc, so the test runs with what a deployment gets. */
const COMPATIBILITY_FLAGS = JSON.parse(
	readFileSync("wrangler.jsonc", "utf8").split("\n").map((line) => line.replace(/^(\s*)\/\/.*$/, "$1")).join("\n").replace(/,(\s*[\]}])/g, "$1"),
).compatibility_flags;

const MAILBOX = "a@example.com";
const ORIGIN = "http://localhost";
const REDIRECT = "http://localhost:3333/callback";
let mf;
let client;
let reader;

const seeded = [
	{ id: "e1", subject: "Invoice for October", sender: "billing@example.net", body: "<p>Amount due: 42</p>" },
	{ id: "e2", subject: "Weekly digest", sender: "news@example.org", body: "<p>This week</p>" },
].map((e, i) => ({
	recipient: MAILBOX, date: new Date(Date.UTC(2026, 9, 1, i)).toISOString(), read: false, starred: false,
	thread_id: e.id, message_id: `${e.id}@mail`, raw_headers: "[]", ...e,
}));

before(async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/mcp-worker.ts"],
		bundle: true,
		format: "esm",
		platform: "neutral",
		conditions: ["workerd", "worker", "browser"],
		mainFields: ["module", "main"],
		external: ["cloudflare:*", "node:*", "path"],
		write: false,
		logLevel: "silent",
	});
	mf = new Miniflare({
		modules: true,
		script: bundle.outputFiles[0].text,
		compatibilityDate: "2025-11-28",
		compatibilityFlags: COMPATIBILITY_FLAGS,
		bindings: { EMAIL_ADDRESSES: [MAILBOX] },
		email: { send_email: [{ name: "EMAIL" }] },
		r2Buckets: ["BUCKET"],
		d1Databases: ["DB"],
		durableObjects: {
			EMAIL_MCP: { className: "EmailMCP", useSQLite: true },
		},
		kvNamespaces: ["OAUTH_KV"],
	});
	for (const s of statements(D1_SCHEMA)) await mf.dispatchFetch(`${ORIGIN}/_sql`, { method: "POST", body: s });
	const seed = await mf.dispatchFetch(`${ORIGIN}/_seed`, { method: "POST", body: JSON.stringify({ mailbox: MAILBOX, emails: seeded }) });
	assert.equal(seed.status, 200, await seed.text());

	client = await connect("mcp-test", await grant({ send: true }));
	reader = await connect("mcp-reader", await grant({ send: false }));
});

after(async () => {
	await client?.close();
	await reader?.close();
	await mf?.dispose();
});

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

/** Register a client and walk the consent page; returns the consent page and, if approved, a token. */
async function authorizeFlow({ name = "mcp-test", send, decision = "approve" }) {
	const reg = await mf.dispatchFetch(`${ORIGIN}/mcp/oauth/register`, {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
	});
	assert.equal(reg.status, 201, await reg.clone().text());
	const { client_id } = await reg.json();
	const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
	const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
	const query = new URLSearchParams({
		response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256",
		state: "s1", scope: "mail mail.send", resource: `${ORIGIN}/mcp`,
	});
	const page = await mf.dispatchFetch(`${ORIGIN}/authorize?${query}`);
	const html = await page.text();
	assert.equal(page.status, 200, html);
	const handle = html.match(/name="handle" value="([^"]+)"/)[1];
	const cookie = page.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
	const form = new URLSearchParams({ handle, decision, ...(send ? { send: "on" } : {}) });
	const done = await mf.dispatchFetch(`${ORIGIN}/authorize`, {
		method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: ORIGIN }, body: form,
	});
	assert.equal(done.status, 302, await done.clone().text());
	const back = new URL(done.headers.get("location"));
	return { html, client_id, verifier, back };
}

/** An access token for a client approved with or without sending. */
async function grant({ send, name }) {
	const { client_id, verifier, back } = await authorizeFlow({ send, name });
	const token = await mf.dispatchFetch(`${ORIGIN}/mcp/oauth/token`, {
		method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), redirect_uri: REDIRECT, client_id, code_verifier: verifier, resource: `${ORIGIN}/mcp` }),
	});
	const body = await token.json();
	assert.equal(token.status, 200, JSON.stringify(body));
	return body;
}

async function connect(name, token) {
	const c = new Client({ name, version: "1.0.0" });
	await c.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
		fetch: (url, init) => mf.dispatchFetch(url, init),
		requestInit: { headers: { authorization: `Bearer ${token.access_token}` } },
	}));
	return c;
}

/** Call a tool; returns the parsed JSON (or raw text) and whether the server flagged an error. */
async function call(name, args = {}, as = client) {
	const result = await as.callTool({ name, arguments: args });
	const text = result.content[0].text;
	let data;
	try { data = JSON.parse(text); } catch { data = text; }
	return { isError: !!result.isError, data };
}

async function ok(name, args) {
	const { isError, data } = await call(name, args);
	assert.equal(isError, false, `${name}: ${JSON.stringify(data)}`);
	return data;
}

const listOf = (data) => (Array.isArray(data) ? data : data.emails);
const found = (data) => data.conversations.map((c) => c.emailId);

test("the server lists every tool", async () => {
	assert.equal(client.getServerVersion().name, "pluramail");
	const { tools } = await client.listTools();
	assert.deepEqual(tools.map((t) => t.name).sort(), [
		"create_draft", "create_label", "delete_email", "delete_label", "draft_reply", "get_email", "get_thread",
		"label_conversation", "label_matching", "list_emails", "list_labels", "list_mailboxes", "list_shortcuts", "mark_email_read",
		"move_email", "rename_label", "reply_to_email", "reset_shortcuts", "search_all_mail", "search_emails", "send_draft", "send_email",
		"set_shortcut", "update_draft",
	]);
});

test("a grant without the send scope gets no tool that sends", async () => {
	const names = (await reader.listTools()).tools.map((t) => t.name);
	for (const sending of ["send_draft", "reply_to_email", "send_email"]) assert.ok(!names.includes(sending), sending);
	assert.ok(names.includes("draft_reply") && names.includes("get_email"));
	assert.equal(names.length, 21);
});

test("tools say whether they only read, and which ones send", async () => {
	const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.annotations]));
	assert.equal(tools.get_email.readOnlyHint, true);
	assert.equal(tools.send_email.destructiveHint, true);
	assert.equal(tools.label_conversation.readOnlyHint, false);
	assert.equal(tools.label_conversation.destructiveHint, false);
});

test("without a token /mcp answers 401 and points at its OAuth metadata", async () => {
	const res = await mf.dispatchFetch(`${ORIGIN}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
	assert.equal(res.status, 401);
	assert.match(res.headers.get("www-authenticate"), /resource_metadata="http:\/\/localhost\/\.well-known\/oauth-protected-resource\/mcp"/);
	const meta = await (await mf.dispatchFetch(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`)).json();
	assert.equal(meta.resource, `${ORIGIN}/mcp`);
	const server = await (await mf.dispatchFetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).json();
	assert.equal(server.token_endpoint, `${ORIGIN}/mcp/oauth/token`);
	assert.equal(server.registration_endpoint, `${ORIGIN}/mcp/oauth/register`);
	assert.deepEqual(server.scopes_supported, ["mail", "mail.send"]);
	assert.equal((await mf.dispatchFetch(`${ORIGIN}/mcp/tools`)).status, 404, "nothing else lives under /mcp");
});

test("the protected resource metadata lists every scope the server grants, mail.send included (#44)", async () => {
	const res = await mf.dispatchFetch(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
	assert.equal(res.headers.get("content-type")?.split(";")[0], "application/json");
	const resource = await res.json();
	const server = await (await mf.dispatchFetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).json();
	assert.deepEqual(resource.scopes_supported, ["mail", "mail.send"]);
	assert.deepEqual(resource.scopes_supported, server.scopes_supported);
	assert.equal(resource.resource, `${ORIGIN}/mcp`, "the rest is unchanged");
	const challenge = (await mf.dispatchFetch(`${ORIGIN}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).headers.get("www-authenticate");
	assert.match(challenge, /scope="mail"/, "only mail is required");
});

test("/mcp refuses requests from another site's page, with the frame headers", async () => {
	const res = await mf.dispatchFetch(`${ORIGIN}/mcp`, { method: "POST", headers: { origin: "https://evil.example.net", "content-type": "application/json" }, body: "{}" });
	assert.equal(res.status, 403);
	assert.equal(await res.text(), "Cross-origin request refused");
	assert.equal(res.headers.get("x-frame-options"), "DENY");
	const meta = await mf.dispatchFetch(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
	assert.equal(meta.headers.get("x-frame-options"), "DENY");
});

test("a client ID metadata document URL is supported, and one that can't load shows Can't connect (#31)", async () => {
	const server = await (await mf.dispatchFetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).json();
	assert.equal(server.client_id_metadata_document_supported, true);
	const query = new URLSearchParams({
		response_type: "code", client_id: "https://app.example.invalid/client.json", redirect_uri: "https://app.example.invalid/callback",
		scope: "mail", state: "s1", code_challenge: "x".repeat(43), code_challenge_method: "S256",
	});
	const res = await mf.dispatchFetch(`${ORIGIN}/authorize?${query}`, { headers: { accept: "text/html" } });
	assert.equal(res.status, 400);
	assert.match(await res.text(), /Can&#39;t connect this app|Can't connect this app/);
});

test("the consent page escapes the client's name, and Deny sends access_denied back", async () => {
	const { html, back } = await authorizeFlow({ name: "<img src=x onerror=alert(1)>", decision: "deny" });
	assert.ok(!html.includes("<img src=x"));
	assert.match(html, /&lt;img src=x/);
	assert.match(html, /name="send"(?! checked)/, "Send starts unticked");
	assert.equal(back.searchParams.get("error"), "access_denied");
	assert.equal(back.searchParams.get("state"), "s1");
});

test("shortcuts can be listed, rebound and reset", async () => {
	const keysOf = async (id) => (await ok("list_shortcuts")).shortcuts.find((s) => s.id === id).keys;
	assert.deepEqual(await keysOf("archive"), ["e"]);

	const saved = await ok("set_shortcut", { shortcut: "Archive", keys: ["S"] });
	assert.deepEqual(saved.keys, ["s"]);
	assert.deepEqual(saved.takenFrom.map((t) => t.id), ["star"]);
	assert.deepEqual(await keysOf("archive"), ["s"]);
	assert.deepEqual(await keysOf("star"), []);

	const refused = await call("set_shortcut", { shortcut: "help", keys: ["h"] });
	assert.equal(refused.isError, true);

	await ok("reset_shortcuts", {});
	assert.deepEqual(await keysOf("archive"), ["e"]);
	assert.deepEqual(await keysOf("star"), ["s"]);
});

test("read tools return the seeded mail", async () => {
	const boxes = await ok("list_mailboxes");
	assert.ok(JSON.stringify(boxes).includes(MAILBOX));

	const inbox = listOf(await ok("list_emails", { mailboxId: MAILBOX }));
	assert.deepEqual(inbox.map((e) => e.id).sort(), ["e1", "e2"]);

	const email = await ok("get_email", { mailboxId: MAILBOX, emailId: "e1" });
	assert.match(email.body, /Amount due: 42/);

	const thread = await ok("get_thread", { mailboxId: MAILBOX, threadId: "e1" });
	assert.deepEqual(thread.messages.map((e) => e.id), ["e1"]);

	assert.deepEqual(found(await ok("search_all_mail", { query: "invoice" })), ["e1"]);
	assert.deepEqual(found(await ok("search_emails", { mailboxId: MAILBOX, query: "digest" })), ["e2"]);
});

test("read state and folder changes stick", async () => {
	await ok("mark_email_read", { mailboxId: MAILBOX, emailId: "e2", read: true });
	assert.equal(!!(await ok("get_email", { mailboxId: MAILBOX, emailId: "e2" })).read, true);

	await ok("move_email", { mailboxId: MAILBOX, emailId: "e2", folderId: "archive" });
	assert.deepEqual(listOf(await ok("list_emails", { mailboxId: MAILBOX, folder: "archive" })).map((e) => e.id), ["e2"]);
	await ok("move_email", { mailboxId: MAILBOX, emailId: "e2", folderId: "inbox" });
});

test("a label can be created, applied, searched, renamed and deleted", async () => {
	const label = await ok("create_label", { name: "Receipts" });
	assert.ok(label.id ?? label.label?.id);

	await ok("label_conversation", { mailboxId: MAILBOX, emailId: "e1", add: ["Receipts"] });
	assert.deepEqual(found(await ok("search_all_mail", { label: ["Receipts"] })), ["e1"]);

	await ok("rename_label", { label: "Receipts", name: "Bills" });
	assert.ok(JSON.stringify(await ok("list_labels")).includes("Bills"));

	const removed = await ok("label_matching", { label: ["Bills"], remove: ["Bills"] });
	assert.equal(removed.conversations, 1);

	await ok("delete_label", { label: "Bills" });
	assert.ok(!JSON.stringify(await ok("list_labels")).includes("Bills"));
});

test("a draft is created, updated under a new id, and sent", async () => {
	const created = await ok("create_draft", { mailboxId: MAILBOX, to: "bob@example.org", subject: "Hello", bodyHtml: "<p>v1</p>" });

	const updated = await ok("update_draft", { mailboxId: MAILBOX, draftId: created.draftId, bodyHtml: "<p>v2</p>" });
	assert.notEqual(updated.newDraftId, created.draftId, "an update replaces the draft");
	assert.equal((await call("get_email", { mailboxId: MAILBOX, emailId: created.draftId })).isError, true, "the old id is gone");
	assert.match((await ok("get_email", { mailboxId: MAILBOX, emailId: updated.newDraftId })).body, /v2/);

	const sent = await ok("send_draft", { mailboxId: MAILBOX, draftId: updated.newDraftId });
	assert.equal(sent.status, "sent");
	assert.deepEqual(listOf(await ok("list_emails", { mailboxId: MAILBOX, folder: "draft" })), []);
	assert.deepEqual(listOf(await ok("list_emails", { mailboxId: MAILBOX, folder: "sent" })).map((e) => e.subject), ["Hello"]);

	const again = await call("send_draft", { mailboxId: MAILBOX, draftId: updated.newDraftId });
	assert.equal(again.data.error, "Draft not found", "a sent draft is gone, so it can't go out twice");
	assert.equal(listOf(await ok("list_emails", { mailboxId: MAILBOX, folder: "sent" })).length, 1);
});

test("a reply draft can be saved and moved to Trash", async () => {
	const reply = await ok("draft_reply", {
		mailboxId: MAILBOX, originalEmailId: "e1", to: "billing@example.net", subject: "Re: Invoice for October", bodyHtml: "<p>Paid</p>",
	});
	await ok("delete_email", { mailboxId: MAILBOX, emailId: reply.draftId });
	assert.deepEqual(listOf(await ok("list_emails", { mailboxId: MAILBOX, folder: "trash" })).map((e) => e.id), [reply.draftId]);
});

test("bad input comes back as an error", async () => {
	const unknown = await call("list_emails", { mailboxId: "nobody@example.com" });
	assert.equal(unknown.isError, true);
	assert.match(unknown.data.error, /not found/);

	const missing = await call("send_draft", { mailboxId: MAILBOX, draftId: "no-such-draft" });
	assert.equal(missing.isError, true);
	assert.equal(missing.data.error, "Draft not found");

	const invalid = await client.callTool({
		name: "draft_reply", arguments: { mailboxId: MAILBOX, originalEmailId: "e1", to: "not-an-address", subject: "s", bodyHtml: "b" },
	}).catch((e) => ({ isError: true, content: [{ text: e.message }] }));
	assert.equal(invalid.isError, true);
	assert.match(invalid.content[0].text, /to/);
});

test("reply_to_email sends once per key, to the reply address the client expects", async () => {
	const email = await ok("get_email", { mailboxId: MAILBOX, emailId: "e1" });
	assert.deepEqual(email.replyTarget, ["billing@example.net"]);
	const sentBefore = listOf(await ok("list_emails", { mailboxId: MAILBOX, folder: "sent" })).length;
	const reply = { mailboxId: MAILBOX, emailId: "e1", expectedRecipients: ["billing@example.net"], text: "Paid today.", idempotencyKey: "reply-e1-0001" };

	const wrong = await call("reply_to_email", { ...reply, expectedRecipients: ["someone@example.org"] });
	assert.equal(wrong.data.code, "recipient_changed");
	assert.deepEqual(wrong.data.replyTarget, ["billing@example.net"]);

	const sent = await ok("reply_to_email", reply);
	assert.equal(sent.status, "sent");
	assert.equal(sent.subject, "Re: Invoice for October");
	const again = await ok("reply_to_email", reply);
	assert.equal(again.status, "already_sent", "a retry with the same key doesn't send again");
	assert.equal(again.sentId, sent.sentId);
	const reused = await call("reply_to_email", { ...reply, text: "Something else." });
	assert.equal(reused.data.code, "key_conflict");
	assert.equal(listOf(await ok("list_emails", { mailboxId: MAILBOX, folder: "sent" })).length, sentBefore + 1);

	const own = await call("reply_to_email", { ...reply, emailId: sent.sentId, idempotencyKey: "reply-own-0001" });
	assert.equal(own.data.code, "not_received");
});

test("reply_to_email refuses an email that a newer one in its conversation has passed", async () => {
	const at = (h) => new Date(Date.UTC(2026, 9, 2, h)).toISOString();
	const thread = [
		{ id: "t1", date: at(1), message_id: "t1@mail" },
		{ id: "t2", date: at(2), message_id: "t2@mail" },
	].map((e) => ({ ...e, subject: "Schedule", sender: "ann@example.org", recipient: MAILBOX, body: "<p>When?</p>", read: false, starred: false, thread_id: "t1", raw_headers: "[]" }));
	await mf.dispatchFetch(`${ORIGIN}/_seed`, { method: "POST", body: JSON.stringify({ mailbox: MAILBOX, emails: thread }) });
	const old = await call("reply_to_email", { mailboxId: MAILBOX, emailId: "t1", expectedRecipients: ["ann@example.org"], text: "Tuesday.", idempotencyKey: "reply-t1-0001" });
	assert.equal(old.data.code, "conversation_advanced");
	assert.equal(old.data.latestEmailId, "t2");
});

test("a retried reply answers with the first send even after newer mail arrived", async () => {
	const at = (h) => new Date(Date.UTC(2026, 9, 3, h)).toISOString();
	const email = (id, h) => ({ id, date: at(h), message_id: `${id}@mail`, subject: "Lunch", sender: "dan@example.org", recipient: MAILBOX, body: "<p>Friday?</p>", read: false, starred: false, thread_id: "u1", raw_headers: "[]" });
	const seed = (emails) => mf.dispatchFetch(`${ORIGIN}/_seed`, { method: "POST", body: JSON.stringify({ mailbox: MAILBOX, emails }) });
	await seed([email("u1", 1)]);
	const reply = { mailboxId: MAILBOX, emailId: "u1", expectedRecipients: ["dan@example.org"], text: "Friday works.", idempotencyKey: "reply-u1-0001" };
	const sent = await ok("reply_to_email", reply);
	assert.equal(sent.status, "sent");
	await seed([email("u2", 2)]);
	const retry = await ok("reply_to_email", reply);
	assert.equal(retry.status, "already_sent");
	assert.equal(retry.sentId, sent.sentId);
	const fresh = await call("reply_to_email", { ...reply, idempotencyKey: "reply-u1-0002" });
	assert.equal(fresh.data.code, "conversation_advanced");
});

test("send_email sends a new email with an attachment, and checks the file", async () => {
	const pdf = Buffer.from("%PDF-1.4 test").toString("base64");
	const base = { mailboxId: MAILBOX, to: ["carol@example.org"], subject: "Report", text: "Attached.", idempotencyKey: "send-report-0001" };
	const sent = await ok("send_email", { ...base, attachments: [{ filename: "report.pdf", contentType: "application/pdf", contentBase64: pdf }] });
	assert.equal(sent.status, "sent");
	const copy = await ok("get_email", { mailboxId: MAILBOX, emailId: sent.sentId });
	assert.equal(copy.subject, "Report");
	assert.deepEqual(copy.attachments.map((a) => a.filename), ["report.pdf"]);

	const bad = await call("send_email", { ...base, idempotencyKey: "send-report-0002", attachments: [{ filename: "x.bin", contentType: "application/octet-stream", contentBase64: "not base64!" }] });
	assert.equal(bad.data.code, "invalid_input");
	const shortKey = await call("send_email", { ...base, idempotencyKey: "short" });
	assert.equal(shortKey.isError, true);
});

test("a grant without the send scope can't call the send tools", async () => {
	const refused = await call("send_email", { mailboxId: MAILBOX, to: ["carol@example.org"], subject: "No", text: "No.", idempotencyKey: "send-denied-0001" }, reader)
		.catch((e) => ({ isError: true, data: e.message }));
	assert.equal(refused.isError, true);
	assert.match(JSON.stringify(refused.data), /not found|send_email/i);
});
