import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";
import { statements } from "./helpers/schema.mjs";
import { loadTs, openDb } from "./helpers/sqlite.mjs";

// Ranking against a checked-in fixture (tests/fixtures/search-corpus.json):
// 200 messages and 30 queries. Each query's expected top result is an older
// message about it; newer messages only mention its words. A change to the
// weights (BM25 in workers/lib/mail-index-sql.ts) shows up here.

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const eng = await loadTs("workers/lib/search-engine-sql.ts");
const rows = await loadTs("workers/store/d1/rows.ts");
const { messages, queries } = JSON.parse(readFileSync("tests/fixtures/search-corpus.json", "utf8"));

const A = "a@example.com";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const db = openDb();
for (const s of statements(D1_SCHEMA)) db.exec(s);
db.exec(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
for (const f of ["inbox", "sent", "draft", "archive", "spam", "trash"]) db.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, ?, ?)`, A, f, f);
for (const m of messages) {
	const email = { id: m.id, subject: m.subject, sender: m.from, recipient: A, date: new Date(NOW - m.days * 86_400_000).toISOString(), body: `<p>${m.body}</p>`, thread_id: m.id };
	for (const s of rows.insertStatements(A, "inbox", email, [], m.id, { bodyInR2: false })) db.exec(s.sql, ...s.params);
}

const first = (q) => idx.runSync(eng.d1MailQuery(idx.emptyFilter({ view: "anywhere", q }), { now: NOW, limit: 5 }), db.exec).conversations[0]?.email_id;

test("the fixture has 200 messages and 30 queries", () => {
	assert.equal(messages.length, 200);
	assert.equal(queries.length, 30);
});

test("every query ranks its message first", () => {
	const wrong = queries.filter((q) => first(q.query) !== q.top).map((q) => `${q.query}: got ${first(q.query)}, want ${q.top}`);
	assert.deepEqual(wrong, []);
});

test("newest first would get most of them wrong", () => {
	const byDate = queries.filter((q) => first(`${q.query} sort:date`) === q.top).length;
	assert.ok(byDate <= 3, `${byDate} of 30 right by date; the fixture should need ranking`);
});
