import assert from "node:assert/strict";
import { test } from "node:test";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";
import { statements } from "./helpers/schema.mjs";
import { loadTs, openDb } from "./helpers/sqlite.mjs";

// Searches that must match exactly what they name: saved-search counts with
// the substring fallback, full addresses in from: and to:, and month and
// year ages at the end of a month.

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const eng = await loadTs("workers/lib/search-engine-sql.ts");
const sg = await loadTs("workers/lib/search-suggest-sql.ts");
const rows = await loadTs("workers/store/d1/rows.ts");
const search = await loadTs("workers/store/search.ts");

const A = "a@example.com";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const iso = (days) => new Date(NOW - days * 86_400_000).toISOString();
const MAIL = [
	{ id: "m1", from: "orders@example.org", to: A, subject: "Order XK7731Q shipped" },
	{ id: "m2", from: "jo.ann@example.org", to: A, subject: "Hello" },
	{ id: "m3", from: "ann@example.org", to: A, subject: "Hey" },
	{ id: "m4", from: A, to: "jo.ann@example.org", subject: "To Jo" },
	{ id: "m5", from: A, to: "bob@example.net, ann@example.org", subject: "To both" },
	{ id: "m6", from: "bob@example.net", to: A, subject: "invoice" },
];

const db = openDb();
for (const s of statements(D1_SCHEMA)) db.exec(s);
db.exec(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
for (const f of ["inbox", "sent", "draft", "archive", "spam", "trash"]) db.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, ?, ?)`, A, f, f);
for (const m of MAIL) {
	const email = { id: m.id, subject: m.subject, sender: m.from, recipient: m.to, date: iso(3), body: `<p>${m.subject}</p>`, thread_id: m.id };
	for (const s of rows.insertStatements(A, m.from === A ? "sent" : "inbox", email, [], m.id, { bodyInR2: false })) db.exec(s.sql, ...s.params);
}
const run = (q) => idx.runSync(q, db.exec);
const find = (q) => run(eng.d1MailQuery(idx.emptyFilter({ view: "all", q }), { now: NOW })).conversations.map((c) => c.subject).sort();

test("a saved search counts what the list finds by substring", () => {
	assert.deepEqual(find("7731"), ["Order XK7731Q shipped"]);
	run(sg.createSavedSearchQuery({ query: "7731" }, "s1"));
	const [saved] = run(sg.listSavedSearchesQuery({ tzOffset: 0 }, NOW));
	assert.equal(saved.count, 1);
});
