import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { loadTs, openDb } from "./helpers/sqlite.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// The combined list, facet and folder queries (mail-index-sql.ts) run the
// same on node:sqlite (synchronously, as unit tests run them) and on D1.

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const SCHEMA = D1_SCHEMA;
const NOW = Date.parse("2026-10-11T12:00:00Z");
const FOLDERS = ["inbox", "sent", "draft", "archive", "spam", "trash", "receipts"];

function statements(text) {
	const out = [];
	let current = [];
	let inTrigger = false;
	for (const line of text.split("\n")) {
		if (!current.length && (!line.trim() || line.trim().startsWith("--"))) continue;
		current.push(line);
		if (/^\s*CREATE TRIGGER/i.test(line)) inTrigger = true;
		if (inTrigger ? /^\s*END;\s*$/i.test(line) : /;\s*(--.*)?$/.test(line)) {
			out.push(current.join("\n"));
			current = [];
			inTrigger = false;
		}
	}
	return out;
}

const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

// [id, mailbox, folder, conversation, hoursAgo, sender, subject, read, starred, body]
const MESSAGES = [
	[1, "a@example.com", "inbox", "t1", 1, "ann@example.org", "Invoice October", 0, 0, "your invoice is attached"],
	[2, "a@example.com", "sent", "t1", 0.5, "a@example.com", "Re: Invoice October", 1, 0, "thanks, paid"],
	[3, "a@example.com", "inbox", "t2", 30, "news@example.net", "Weekly digest", 1, 1, "this week in mail"],
	[4, "b@example.org", "inbox", "t3", 2, "ann@example.org", "Lunch", 0, 0, "lunch on friday"],
	[5, "b@example.org", "receipts", "t4", 50, "billing@example.net", "Receipt 2041", 1, 0, "receipt for your invoice"],
	[6, "b@example.org", "trash", "t5", 3, "spam@example.net", "Old offer", 1, 0, "limited offer"],
];

function seedStatements() {
	const list = [
		{ sql: "INSERT INTO mailboxes (id, created_at) VALUES ('a@example.com', 'x'), ('b@example.org', 'x')", params: [] },
	];
	for (const m of ["a@example.com", "b@example.org"]) {
		for (const f of FOLDERS) list.push({ sql: "INSERT INTO folders (mailbox_id, id, name) VALUES (?, ?, ?)", params: [m, f, f] });
	}
	for (const [id, mailbox, folder, conv, hours, sender, subject, read, starred, body] of MESSAGES) {
		const domain = sender.split("@")[1];
		list.push({
			sql: `INSERT INTO messages (id, email_id, mailbox_id, folder_id, conversation_id, date, subject, subject_norm, sender_addr, sender_name, sender_domain, recipient, recipients, snippet, body, read, starred)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
			params: [id, `e${id}`, mailbox, folder, conv, iso(hours), subject, subject.toLowerCase().replace(/^re: /, ""), sender, domain, mailbox, mailbox, body.slice(0, 200), `<p>${body}</p>`, read, starred],
		});
		list.push({ sql: "INSERT INTO messages_fts (rowid, subject, sender_name, sender_addr, recipients, body_text) VALUES (?, ?, '', ?, ?, ?)", params: [id, subject, sender, mailbox, body] });
	}
	list.push({ sql: "INSERT INTO labels (id, name, color) VALUES ('money', 'Money', 'green')", params: [] });
	list.push({ sql: "INSERT INTO message_labels (message, label_id) VALUES (1, 'money'), (5, 'money')", params: [] });
	return list;
}

const filter = (overrides = {}) => idx.emptyFilter(overrides);

/** The queries the store runs, each as a generator. */
const QUERIES = {
	inbox: () => idx.mailQuery(filter({ view: "inbox" }), { now: NOW }),
	unread: () => idx.mailQuery(filter({ view: "unread" }), { now: NOW }),
	all: () => idx.mailQuery(filter({ view: "all" }), { now: NOW }),
	address: () => idx.mailQuery(filter({ view: "all", address: ["b@example.org"] }), { now: NOW }),
	from: () => idx.mailQuery(filter({ view: "all", from: ["example.org"] }), { now: NOW }),
	label: () => idx.mailQuery(filter({ view: "all", label: ["money"] }), { now: NOW }),
	search: () => idx.mailQuery(filter({ view: "all", q: "invoice sort:date" }), { now: NOW }),
	page: () => idx.mailQuery(filter({ view: "all" }), { now: NOW, limit: 2 }),
	folder: () => idx.mailQuery(filter({ view: "folder:receipts" }), { now: NOW }),
	facets: () => idx.facetsQuery(filter({ view: "all" }), NOW),
	folders: () => idx.folderViewsQuery(),
};

function syncResults() {
	const { exec } = openDb();
	for (const s of statements(SCHEMA)) exec(s);
	for (const s of seedStatements()) exec(s.sql, ...s.params);
	return Object.fromEntries(Object.entries(QUERIES).map(([name, q]) => [name, idx.runSync(q(), exec)]));
}

const keys = (page) => page.conversations.map((c) => `${c.mailbox_id}/${c.email_id}`);

test("list, facet and folder queries give the expected results on the D1 schema", () => {
	const r = syncResults();
	assert.deepEqual(keys(r.inbox), ["a@example.com/e1", "b@example.org/e4", "a@example.com/e3"]);
	assert.equal(r.inbox.total, 3);
	assert.equal(r.inbox.unread, 2);
	const t1 = r.inbox.conversations[0];
	assert.equal(t1.thread_count, 2, "the sent reply counts in the thread");
	assert.deepEqual(t1.labels, ["money"]);
	assert.deepEqual(keys(r.unread), ["a@example.com/e1", "b@example.org/e4"]);
	assert.deepEqual(keys(r.all), ["a@example.com/e2", "b@example.org/e4", "a@example.com/e3", "b@example.org/e5"], "trash is left out; a thread shows its latest message");
	assert.deepEqual(keys(r.address), ["b@example.org/e4", "b@example.org/e5"]);
	assert.deepEqual(keys(r.from), ["a@example.com/e1", "b@example.org/e4"]);
	assert.deepEqual(keys(r.label), ["a@example.com/e1", "b@example.org/e5"]);
	assert.deepEqual(keys(r.search), ["a@example.com/e2", "b@example.org/e5"], "the reply matches too, so its thread shows the reply");
	assert.equal(r.page.conversations.length, 2);
	assert.ok(r.page.nextCursor);
	assert.deepEqual(keys(r.folder), ["b@example.org/e5"]);
	assert.deepEqual(r.facets.address, [{ value: "a@example.com", count: 2 }, { value: "b@example.org", count: 2 }]);
	assert.deepEqual(r.facets.label, [{ value: "money", name: "Money", count: 2 }]);
	assert.equal(r.facets.status.starred, 1);
	assert.deepEqual(r.folders, [{ view: "folder:receipts", count: 1 }]);
});

let mf;

before(async () => {
	const bundle = await build({ entryPoints: ["tests/fixtures/sql-worker.ts"], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent" });
	mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", d1Databases: ["DB"] });
});

after(async () => {
	await mf?.dispose();
});

async function d1(op, ...args) {
	const response = await mf.dispatchFetch("http://test/", { method: "POST", body: JSON.stringify({ op, args }) });
	const result = await response.json();
	if (result.error) throw new Error(result.error);
	return result.ok;
}

test("the same queries run asynchronously on local D1 and match", async () => {
	for (const s of statements(SCHEMA)) await d1("run", s);
	await d1("batch", seedStatements());
	const expected = syncResults();
	for (const [name, q] of Object.entries(QUERIES)) {
		const actual = await idx.runAsync(q(), (sql, ...params) => d1("all", sql, ...params));
		assert.deepEqual(actual, expected[name], name);
	}
});
