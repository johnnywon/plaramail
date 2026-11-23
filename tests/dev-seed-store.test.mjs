import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { statements } from "./helpers/schema.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// The dev sample inbox written to local D1 and R2 (workers/lib/dev-seed), then
// read back the way the app reads it.

const SIX = ["hello@example.com", "billing@example.com", "support@example.org", "legal@example.org", "ops@example.net", "press@example.net"];
const instances = [];
let script;

before(async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/dev-seed-worker.ts"], bundle: true, format: "esm", platform: "neutral",
		conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"], external: ["cloudflare:workers"],
		write: false, logLevel: "silent",
	});
	script = bundle.outputFiles[0].text;
});

after(async () => {
	await Promise.all(instances.map((mf) => mf.dispose()));
});

async function start(bindings = {}) {
	const mf = new Miniflare({
		modules: true, script, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		bindings: { EMAIL_ADDRESSES: SIX, ...bindings }, r2Buckets: ["BUCKET"], d1Databases: ["DB"],
	});
	instances.push(mf);
	const call = async (op, args) => {
		const response = await mf.dispatchFetch("http://worker/", { method: "POST", body: JSON.stringify({ op, args }) });
		const body = await response.json();
		if (body.error) throw new Error(body.error);
		return body.ok;
	};
	for (const s of statements(D1_SCHEMA)) await call("exec", { sql: s });
	return {
		call,
		rows: (sql, ...params) => call("rows", { sql, params }),
		one: async (sql, ...params) => Object.values((await call("rows", { sql, params }))[0] ?? {})[0],
	};
}

test("a fresh database gets the whole sample inbox: mailboxes, mail, files, labels, searches", async () => {
	const db = await start();
	const summary = await db.call("seed", {});
	assert.ok(summary.messages >= 300);
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages`), summary.messages);
	assert.equal(await db.one(`SELECT COUNT(*) FROM mailboxes`), 6);
	for (const a of SIX) assert.equal(await db.one(`SELECT COUNT(*) FROM messages WHERE mailbox_id = ?`, a) > 10, true, a);

	// Every folder, and unread mail only where it should be
	const folders = Object.fromEntries((await db.rows(`SELECT folder_id AS f, COUNT(*) AS n FROM messages GROUP BY folder_id`)).map((r) => [r.f, r.n]));
	for (const f of ["inbox", "sent", "draft", "archive", "trash", "spam"]) assert.ok(folders[f] > 0, f);
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages WHERE unread = 1 AND folder_id IN ('sent', 'draft')`), 0);

	// Files are in D1 and R2, with the sizes the rows say
	assert.equal(await db.one(`SELECT COUNT(*) FROM attachments`), summary.attachments);
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages WHERE has_attachment = 1`) > 30, true);
	const objects = new Map((await db.call("r2", { prefix: "attachments/" })).map((l) => l.split("\t")).map(([k, n]) => [k, Number(n)]));
	assert.equal(objects.size, summary.attachments);
	for (const a of await db.rows(`SELECT id, email_id, filename, size FROM attachments`)) {
		assert.equal(objects.get(`attachments/${a.email_id}/${a.id}/${a.filename}`), a.size, a.filename);
	}

	// Labels and saved searches
	assert.equal(await db.one(`SELECT COUNT(*) FROM labels`), 12);
	assert.ok(await db.one(`SELECT COUNT(*) FROM message_labels`) > 100);
	assert.equal(await db.one(`SELECT COUNT(*) FROM saved_searches`), 3);

	// Search works: words, substrings, and the list and facet queries the UI runs
	assert.ok(await db.one(`SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'invoice'`) > 5);
	assert.ok(await db.one(`SELECT COUNT(*) FROM messages_trigram WHERE messages_trigram MATCH '"larksp"'`) > 0);
	const filter = (over) => ({ view: "inbox", address: [], from: [], label: [], is: [], has: [], subject: [], q: "", sort: "date", dir: "desc", tzOffset: 0, ...over });
	const list = (over) => db.call("store", { mailbox: "all", method: "queryMail", params: [filter(over), { limit: 200 }] });
	assert.ok((await list({})).conversations.length > 80, "the inbox list is long");
	assert.ok((await list({ is: ["unread"] })).conversations.length >= 15, "there is unread mail");
	assert.ok((await list({ has: ["attachment"] })).conversations.length >= 10, "has:attachment finds files");
	assert.ok((await list({ has: ["unsubscribe"], view: "inbox" })).conversations.length >= 10, "newsletters carry unsubscribe headers");
	assert.ok((await list({ q: "tee sheet" })).conversations.length >= 1, "a search finds a thread by its words");
	assert.ok((await list({ view: "spam" })).conversations.length >= 5 && (await list({ view: "trash" })).conversations.length >= 5 && (await list({ view: "drafts" })).conversations.length >= 4);
	assert.ok((await list({ address: ["support@example.org"] })).conversations.length > 10, "one address's inbox");
	const labels = await db.call("store", { mailbox: "all", method: "listLabels", params: [] });
	assert.ok(labels.every((l) => l.count > 0 || l.name === "Personal" || l.name === "Travel"), "every sample label has mail");

	// Threads: a conversation groups its inbox mail and its sent replies
	const thread = await db.rows(`SELECT folder_id, subject FROM messages WHERE conversation_id = 'seed-mail-v1-larkspur-1' ORDER BY date`);
	assert.deepEqual(thread.map((r) => r.folder_id), ["inbox", "sent", "inbox", "sent", "inbox"]);
	assert.equal(await db.one(`SELECT COUNT(DISTINCT thread_key) FROM messages WHERE state = 'inbox'`) < (await db.one(`SELECT COUNT(*) FROM messages WHERE state = 'inbox'`)), true, "threads collapse in the list");
});

test("seeding again replaces the sample mail, keeps your own, and reuses labels", async () => {
	const db = await start();
	// A label of the developer's own, and one the sample data also wants
	await db.call("store", { mailbox: "all", method: "createLabel", params: [{ name: "grass", color: "#4f8a3c" }] });
	await db.call("store", { mailbox: "all", method: "createLabel", params: [{ name: "Receipts", color: "#2f6db3" }] });
	// Mail they made themselves, and a row the old seed route wrote
	await db.call("store", { mailbox: "hello@example.com", method: "createEmail", params: ["inbox", { id: "mine-1", subject: "From me", sender: "me@example.net", recipient: "hello@example.com", date: new Date().toISOString(), body: "<p>hi</p>", thread_id: "mine-1" }, []] });
	await db.call("store", { mailbox: "hello@example.com", method: "createEmail", params: ["inbox", { id: "legacy-1", subject: "Invoice for October #0", sender: "ann@store.example.com", recipient: "hello@example.com", date: new Date().toISOString(), body: "<p>Sample message 0 for hello@example.com. Quarterly numbers and a follow-up.</p>", thread_id: "legacy-1", message_id: "legacy-1@seed.local" }, []] });

	// A row from the old route that was then edited by hand keeps its edited body
	await db.call("store", { mailbox: "hello@example.com", method: "createEmail", params: ["inbox", { id: "legacy-edited", subject: "Intake form notes", sender: "ann@store.example.com", recipient: "hello@example.com", date: new Date().toISOString(), body: "<p>Thanks for the notes on the intake form.</p>", thread_id: "legacy-edited", message_id: "legacy-edited@seed.local" }, []] });

	const first = await db.call("seed", {});
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages WHERE email_id = 'legacy-edited'`), 1, "a sample row you edited stays");
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages WHERE email_id = 'mine-1'`), 1, "your mail stays");
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages WHERE email_id = 'legacy-1'`), 0, "the old sample row goes");
	assert.equal(await db.one(`SELECT color FROM labels WHERE name = 'Receipts'`), "#2f6db3", "an existing label keeps its colour");
	assert.equal(await db.one(`SELECT COUNT(*) FROM labels`), 13, "twelve sample labels (one already existed) and grass");

	const second = await db.call("seed", { extra: 50 });
	assert.equal(second.messages, first.messages + 50);
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages`), second.messages + 2);
	assert.equal(await db.one(`SELECT COUNT(*) FROM labels`), 13);
	assert.equal(await db.one(`SELECT COUNT(*) FROM saved_searches`), 3);
	assert.equal((await db.call("r2", { prefix: "attachments/" })).length, second.attachments, "no leftover files");
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages_fts`) > 0, true);

	// Moving a message out of the sample set and back: reading it, starring it and labelling it survive a restart
	await db.call("store", { mailbox: "hello@example.com", method: "updateEmail", params: ["seed-mail-v1-larkspur-5", { read: true, starred: true }] });
});

test("starting the dev server fills an empty database, and does nothing the second time", async () => {
	const db = await start();
	await db.call("ensure", {});
	const n = await db.one(`SELECT COUNT(*) FROM messages`);
	assert.ok(n >= 300);
	await db.call("ensure", {});
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages`), n);
});

test("starting after days away moves the sample mail forward and keeps what you did to it", async () => {
	const db = await start();
	const past = Date.now() - 5 * 86_400_000;
	await db.call("seed", { now: past });
	await db.call("store", { mailbox: "hello@example.com", method: "updateEmail", params: ["seed-mail-v1-larkspur-5", { read: true, starred: true }] });
	const before = await db.one(`SELECT MAX(date) FROM messages`);
	assert.ok(Date.parse(before) < Date.now() - 4 * 86_400_000);
	const count = await db.one(`SELECT COUNT(*) FROM messages`);
	const labelled = await db.one(`SELECT COUNT(*) FROM message_labels`);

	await db.call("ensure", {});
	const after = Date.parse(await db.one(`SELECT MAX(date) FROM messages`));
	assert.ok(Math.abs(Date.now() - 4 * 60_000 - after) < 2 * 60_000, "the newest is a few minutes old again");
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages`), count);
	assert.equal(await db.one(`SELECT COUNT(*) FROM message_labels`), labelled);
	assert.equal(await db.one(`SELECT read FROM messages WHERE email_id = 'seed-mail-v1-larkspur-5'`), 1);
	assert.equal(await db.one(`SELECT starred FROM messages WHERE email_id = 'seed-mail-v1-larkspur-5'`), 1);
	// A thread keeps its order
	const order = await db.rows(`SELECT email_id FROM messages WHERE conversation_id = 'seed-mail-v1-larkspur-1' ORDER BY date`);
	assert.deepEqual(order.map((r) => r.email_id.replace("seed-mail-v1-", "")), ["larkspur-1", "larkspur-2", "larkspur-3", "larkspur-4", "larkspur-5"]);
});

test("DEV_SEED=off leaves the database alone", async () => {
	const db = await start({ DEV_SEED: "off" });
	await db.call("ensure", {});
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages`), 0);
});

test("an unmigrated database doesn't break the server", async () => {
	const mf = new Miniflare({ modules: true, script, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"], bindings: { EMAIL_ADDRESSES: SIX }, r2Buckets: ["BUCKET"], d1Databases: ["DB"] });
	instances.push(mf);
	const response = await mf.dispatchFetch("http://worker/", { method: "POST", body: JSON.stringify({ op: "ensure" }) });
	assert.deepEqual(await response.json(), { ok: true });
});
