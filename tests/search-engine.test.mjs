import assert from "node:assert/strict";
import { test } from "node:test";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";
import { statements } from "./helpers/schema.mjs";
import { loadTs, openDb } from "./helpers/sqlite.mjs";

// The search engine on D1 (S4): ranking with the count-first rule, match
// counts, Worker-built snippets, the substring fallback, "Did you mean"
// and has:link. Mail is stored through the real D1 row writer.

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const eng = await loadTs("workers/lib/search-engine-sql.ts");
const snip = await loadTs("workers/lib/snippets.ts");
const sg = await loadTs("workers/lib/search-suggest-sql.ts");
const rows = await loadTs("workers/store/d1/rows.ts");

const A = "a@example.com";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const iso = (days) => new Date(NOW - days * 86_400_000).toISOString();

const MAIL = [
	{ id: "m1", days: 1, from: "Ann Lee <ann@example.org>", subject: "Lunch on Friday", body: "<p>Are you free? The quarterly report can wait.</p>" },
	{ id: "m2", days: 30, from: "Billing <billing@example.net>", subject: "Quarterly report", body: "<p>Attached is the quarterly report for Q3.</p>" },
	{ id: "m3", days: 2, from: "News <news@example.net>", subject: "Weekly digest", body: "<p>Read more at https://example.net/digest about the café opening.</p>" },
	{ id: "m4", days: 3, from: "Shop <orders@example.org>", subject: "Order XK7731Q shipped", body: "<p>Your order is on its way.</p>" },
	{ id: "m5", days: 4, from: "Ann Lee <ann@example.org>", subject: "Re: Lunch on Friday", body: "<p>Friday works. &lt;script&gt;alert(1)&lt;/script&gt; <b>See you</b> at the invoice desk.</p>", thread: "m1" },
	{ id: "m6", days: 5, from: "Billing <billing@example.net>", subject: "Invoice 2041", body: "<p>Your invoice is attached. Pay by wire transfer within 30 days.</p>" },
];

function db() {
	const d = openDb();
	for (const s of statements(D1_SCHEMA)) d.exec(s);
	d.exec(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
	for (const f of ["inbox", "sent", "draft", "archive", "spam", "trash"]) d.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, ?, ?)`, A, f, f);
	for (const m of MAIL) {
		const email = { id: m.id, subject: m.subject, sender: m.from, recipient: A, date: iso(m.days), body: m.body, thread_id: m.thread ?? m.id };
		for (const s of rows.insertStatements(A, "inbox", email, [], m.thread ?? m.id, { bodyInR2: false })) d.exec(s.sql, ...s.params);
	}
	return d;
}

const D = db();
/** Run SQL, refusing a statement with more than one MATCH on the same table. */
const exec = (sql, ...params) => {
	for (const table of ["messages_fts", "messages_trigram", "attachment_trigram"]) {
		const n = sql.match(new RegExp(`${table} MATCH`, "g"))?.length ?? 0;
		assert.ok(n <= 1, `${n} MATCHes on ${table}:\n${sql}`);
	}
	return D.exec(sql, ...params);
};
const filter = (q, overrides = {}) => idx.emptyFilter({ view: "anywhere", q, ...overrides });
const list = (q, overrides, options = {}) => idx.runSync(eng.d1MailQuery(filter(q, overrides), { now: NOW, ...options }), exec);
const ids = (page) => page.conversations.map((c) => c.email_id);

test("searches with words rank by relevance", () => {
	const page = list("quarterly report");
	assert.equal(page.order, "relevance");
	assert.deepEqual(ids(page), ["m2", "m1"], "the subject match beats a newer body match");
	assert.deepEqual(ids(list("quarterly report sort:date")), ["m1", "m2"], "sort:date keeps newest first");
	assert.equal(list("quarterly report sort:date").order, "date");
	assert.deepEqual(ids(list("quarterly report", { dir: "asc" })), ["m2", "m1"], "oldest first is a date order");
	assert.equal(list("quarterly report", { dir: "asc" }).order, "date");
	assert.equal(list("is:unread").order, "date", "no words, no ranking");
});

test("a conversation shows its best match and how many messages matched", () => {
	const [lunch] = list("friday").conversations;
	assert.equal(lunch.thread_key.endsWith("m1"), true);
	assert.equal(lunch.match_count, 2);
	assert.equal(list("").conversations[0].match_count, undefined, "only searches count matches");
});

test("ranked pages", () => {
	const all = ids(list("the OR your OR friday"));
	const paged = [];
	let cursor = null;
	do {
		const page = list("the OR your OR friday", {}, { limit: 1, cursor });
		paged.push(...ids(page));
		cursor = page.nextCursor;
	} while (cursor);
	assert.deepEqual(paged, all);
	assert.throws(() => list("friday", {}, { cursor: idx.encodeCursor(["x", "y", "z"]) }), /Invalid cursor/);
});

test("over the rank limit the list is newest first, unless relevance is asked for", () => {
	const big = openDb();
	for (const s of statements(D1_SCHEMA)) big.exec(s);
	big.exec(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
	for (const f of ["inbox", "sent", "draft", "archive", "spam", "trash"]) big.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, ?, ?)`, A, f, f);
	// Only the word index needs the rows: the count reads it alone.
	big.db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i <= ${idx.RANK_LIMIT})
		INSERT INTO messages_fts (rowid, subject, sender_name, sender_addr, recipients, body_text, attachment_names)
		SELECT i + 100, 'common', '', '', '', '', '' FROM n`);
	const run = (q, o) => idx.runSync(idx.mailQuery(filter(q, o), { now: NOW }), big.exec);
	assert.deepEqual([run("common").order, run("common").rankSkipped], ["date", true]);
	assert.equal(run("common sort:relevance").order, "relevance");
	assert.equal(run("common", { sort: "relevance" }).order, "relevance");
});

test("snippets are escaped text around the words", () => {
	const html = snip.snippetHtml("Friday works. <script>alert(1)</script> & \"quotes\" See you at the invoice desk.", ["invoice", "friday"]);
	assert.equal(html, "<mark>Friday</mark> works. &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; See you at the <mark>invoice</mark> desk.");
	assert.ok(!/<(?!\/?mark>)/.test(snip.snippetHtml("<img src=x onerror=alert(1)> &lt;b&gt; invoice", ["invoice"])), "no tag but <mark>");
	assert.equal(snip.snippetHtml("Le Café ouvre", ["cafe"]), "Le <mark>Café</mark> ouvre", "diacritics fold");
	assert.equal(snip.snippetHtml("invoices and reinvoice", ["invoice"]), "<mark>invoices</mark> and reinvoice", "prefixes match, not infixes");
	const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
	assert.equal(snip.snippetHtml(`${long} target ${long}`, ["target"], 6), "… w57 w58 w59 <mark>target</mark> w0 w1 …");
	assert.equal(snip.snippetHtml("no match here", ["zzz"]), "no match here");
	assert.equal(snip.snippetHtml("", ["a"]), "");
	assert.equal(snip.snippetText("a <mark>b</mark> &amp; &lt;c&gt;"), "a b & <c>");
	assert.equal(snip.snippetHtml("Order XK7731Q shipped", ["7731"], 18, ["7731"]), "Order XK<mark>7731</mark>Q shipped", "a substring is marked inside its word");
	assert.equal(snip.snippetHtml("Order XK7731Q shipped", ["7731"]), "Order XK7731Q shipped", "only when the substring search found it");
	assert.equal(snip.snippetHtml("a<b>XK7731Q</b>", ["7731"], 18, ["7731"]), "a&lt;b&gt;XK<mark>7731</mark>Q&lt;/b&gt;", "both sides stay escaped");
	assert.equal(snip.snippetHtml("Réf CAFÉ77 x", ["fe7"], 18, ["fe7"]), "Réf CA<mark>FÉ7</mark>7 x", "diacritics fold inside a word");
});

test("the list carries snippets for its rows", () => {
	const [m5] = list("invoice desk").conversations;
	assert.equal(m5.email_id, "m5");
	assert.match(m5.snippet_html, /<mark>invoice<\/mark> <mark>desk<\/mark>/);
	assert.match(m5.snippet_html, /&lt;script&gt;/, "mail text stays escaped");
	assert.equal(list("").conversations[0].snippet_html, undefined);
	assert.match(list(`"wire transfer"`).conversations[0].snippet_html, /<mark>wire<\/mark> <mark>transfer<\/mark>/);
});

test("a word the index lacks is found as a substring", () => {
	assert.deepEqual(ids(list("7731")), ["m4"], "inside XK7731Q");
	assert.deepEqual(ids(list("7731 shipped")), ["m4"]);
	assert.deepEqual(ids(list("zzqx")), []);
	assert.deepEqual(ids(list("xk")), ["m4"], "a word's start is the word index's");
	assert.deepEqual(ids(list("31")), [], "under three letters there's no substring search");
	const keys = idx.runSync((function* () {
		const bulk = yield* eng.withSubstrings(filter("7731"));
		return yield* idx.mailQuery(bulk, { now: NOW });
	})(), exec);
	assert.equal(keys.conversations.length, 1);
});

test("Did you mean", () => {
	assert.deepEqual(idx.runSync(eng.didYouMeanQuery("invoce from:billing"), exec), { text: "invoice from:billing", words: [{ from: "invoce", to: "invoice" }] });
	assert.deepEqual(idx.runSync(eng.didYouMeanQuery("quartrly reprot"), exec), { text: "quarterly report", words: [{ from: "quartrly", to: "quarterly" }, { from: "reprot", to: "report" }] });
	assert.equal(idx.runSync(eng.didYouMeanQuery("invoice"), exec), null, "known words stay");
	assert.equal(idx.runSync(eng.didYouMeanQuery("zzzzzz"), exec), null);
	assert.equal(eng.editDistance("kitten", "sitting"), 3);
	assert.equal(eng.editDistance("abc", "xyzw", 1), 2, "stops early past the limit");

	const out = idx.runSync(sg.suggestQuery(filter(""), "invoce", -1, NOW), exec);
	assert.equal(out.count, 0);
	assert.equal(out.didYouMean.text, "invoice");
});

test("has:link is set when mail is stored", () => {
	assert.deepEqual(ids(list("has:link")), ["m3"]);
});

test("facets with words count the newest matches on D1", () => {
	const seen = [];
	const spy = (s, ...p) => (seen.push(s), exec(s, ...p));
	idx.runSync(eng.d1FacetsQuery(filter("invoice"), NOW), spy);
	const counts = seen.filter((s) => /FROM messages m/.test(s) && /MATCH/.test(s));
	assert.ok(counts.length > 0 && counts.every((s) => /ORDER BY rowid DESC LIMIT \?/.test(s)));
});

test("search folds accents both ways, for words and substrings (#40)", () => {
	const d = openDb();
	for (const s of statements(D1_SCHEMA)) d.exec(s);
	d.exec(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
	d.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, 'inbox', 'inbox')`, A);
	const mail = [["a1", "Café menu"], ["a2", "Cafe hours"], ["a3", "Über rides"], ["a4", "Uber receipts"], ["a5", "ünïcødé test"], ["a6", "Résumé attached"], ["a7", "Resume draft"]];
	for (const [id, subject] of mail) {
		const email = { id, subject, sender: "ann@example.org", recipient: A, date: iso(1), body: "<p>x</p>", thread_id: id };
		for (const s of rows.insertStatements(A, "inbox", email, [], id, { bodyInR2: false })) d.exec(s.sql, ...s.params);
	}
	const find = (q) => ids(idx.runSync(eng.d1MailQuery(filter(q), { now: NOW }), d.exec)).sort();
	assert.deepEqual(find("cafe"), ["a1", "a2"]);
	assert.deepEqual(find("café"), ["a1", "a2"]);
	assert.deepEqual(find("uber"), ["a3", "a4"]);
	assert.deepEqual(find("über"), ["a3", "a4"]);
	assert.deepEqual(find("unicode"), ["a5"]);
	assert.deepEqual(find("sume"), ["a6", "a7"], "inside Résumé, by substring");
	assert.deepEqual(find("sumé"), ["a6", "a7"]);
});

test("migration 0009 refills the substring index from stored mail, folded (#40)", async () => {
	const { readdirSync, readFileSync } = await import("node:fs");
	const fold = await loadTs("workers/lib/search-fold.ts");
	const files = readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
	const before = files.filter((f) => f < "0009").map((f) => readFileSync(`migrations/${f}`, "utf8")).join("\n");
	const m9 = readFileSync("migrations/0009_search_fold.sql", "utf8");
	assert.ok(m9.includes(fold.foldLettersSql("m.subject")), "the migration folds the letters search-fold.ts folds");

	const d = openDb();
	for (const s of statements(before)) d.exec(s);
	d.exec(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
	d.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, 'inbox', 'inbox')`, A);
	const email = { id: "old", subject: "Résumé for Bjørn", sender: "ann@example.org", recipient: A, date: iso(1), body: "<p>x</p>", thread_id: "old" };
	for (const s of rows.insertStatements(A, "inbox", email, [], "old", { bodyInR2: false })) d.exec(s.sql, ...s.params);
	for (const s of statements(m9)) d.exec(s);
	const hit = (q) => d.exec(`SELECT rowid FROM messages_trigram WHERE messages_trigram MATCH ?`, `"${q}"`).length;
	assert.equal(hit("sume"), 1);
	assert.equal(hit("bjorn"), 1);
});
