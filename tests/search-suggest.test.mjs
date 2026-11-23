import assert from "node:assert/strict";
import { test } from "node:test";
import { DB, guarded, NOW } from "./helpers/search-fixture.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// The search window's server side (workers/lib/search-suggest-sql.ts) on the
// D1 schema: completion, people, counts, what would match when nothing does,
// and saved searches.

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const sg = await loadTs("workers/lib/search-suggest-sql.ts");

const base = (overrides = {}) => idx.emptyFilter({ view: "inbox", ...overrides });
const suggest = (text, at = -1, overrides = {}) => idx.runSync(sg.suggestQuery(base(overrides), text, at, NOW), guarded(DB.exec));
const values = (list) => list.map((p) => `${p.value}:${p.count}`);

test("completes from:, to: and cc: from the mail", () => {
	assert.deepEqual(values(suggest("invoice from:an", 15).completions), ["ann@example.org:2"], "by address prefix");
	assert.deepEqual(values(suggest("from:lee", 8).completions), ["ann@example.org:1"], "by name");
	const domains = values(suggest("from:exam", 9).completions);
	assert.equal(domains[0], "example.net:3", "domains and addresses by conversations");
	assert.ok(domains.includes("example.org:2") && domains.includes("ann@example.org:2"));
	assert.deepEqual(values(suggest("to:ann", 6).completions), ["ann@example.org:1"], "recipients");
	assert.deepEqual(values(suggest("-cc:boss", 8).completions), ["boss@example.net:1"], "cc: is a recipient");
	assert.deepEqual(values(suggest("to:", 3).completions), ["ann@example.org:1"], "empty to: lists who you wrote to");
	assert.equal(suggest("from:an x", 9).completions, null, "the cursor is on another word");
	assert.equal(suggest("subject:an", 10).completions, null, "other operators complete in the browser");
});

test("people with an empty box", () => {
	const out = suggest("");
	assert.deepEqual(values(out.people), ["ann@example.org:2", "billing@example.net:1", "news@example.net:1"]);
	assert.equal(out.people[0].name.length > 0, true);
	assert.equal(out.count, null);
});

test("counts and narrow", () => {
	const out = suggest("invoice");
	assert.equal(out.count, 1);
	assert.deepEqual(out.narrow.map((n) => `${n.token}:${n.count}`), ["from:example.org:1", "is:unread:1", "has:attachment:1"]);
	assert.deepEqual(suggest("invoice is:unread").narrow.map((n) => n.token), ["from:example.org", "has:attachment"], "typed filters aren't offered");
	assert.deepEqual(suggest("invoice", -1, { view: "anywhere" }).narrow.find((n) => n.token.startsWith("label:")), { token: "label:receipts", label: "Receipts", count: 1 });
	assert.equal(suggest("invoice").nothing, null);
});

test("when nothing matches", () => {
	let out = suggest("receipt");
	assert.equal(out.count, 0);
	assert.deepEqual(out.nothing, { everywhere: 1, removals: [] }, "it is in another folder");

	out = suggest("lunch is:read");
	assert.deepEqual(out.nothing, { everywhere: null, removals: [{ text: "is:read", start: 6, end: 13, count: 1 }] }, "a filter hides it");

	out = suggest("in:trash lunch");
	assert.deepEqual(out.nothing, { everywhere: 1, removals: [{ text: "in:trash", start: 0, end: 8, count: 1 }] }, "everywhere drops in:");

	assert.deepEqual(suggest("zzzz").nothing, { everywhere: null, removals: [] });
});

test("errors and requests", () => {
	const out = suggest("before:soon invoice");
	assert.deepEqual(out.errors, ["before: needs a date like 2026-01-31 or an age like 30d"]);
	assert.equal(out.count, 1, "the bad value is left out");
	assert.equal(suggest("find the invoice from ann").interpretable, true);
	assert.equal(suggest("invoice").interpretable, false);
	assert.equal(suggest("cc:boss", -1, { view: "anywhere" }).count, 1);
});

test("saved searches", () => {
	const exec = DB.exec;
	const run = (q) => idx.runSync(q, exec);
	const a = run(sg.createSavedSearchQuery({ query: "  invoice   is:unread " }, "s1"));
	assert.deepEqual(a, { id: "s1", name: "invoice is:unread", query: "invoice is:unread", position: 0 }, "the name defaults to the text");
	const b = run(sg.createSavedSearchQuery({ name: "Receipts", query: "label:receipts" }, "s2"));
	assert.equal(b.position, 1);
	assert.throws(() => run(sg.createSavedSearchQuery({ query: "invoice is:unread" })), /already saved/);
	assert.throws(() => run(sg.createSavedSearchQuery({ query: "   " })), /needs search text/);
	assert.throws(() => run(sg.createSavedSearchQuery({ query: "x".repeat(501) })), /limited to 500/);

	const listed = run(sg.listSavedSearchesQuery({ tzOffset: 0 }, NOW));
	assert.deepEqual(listed.map((s) => [s.name, s.count]), [["invoice is:unread", 1], ["Receipts", 1]], "counts over All mail");
	assert.equal(run(sg.listSavedSearchesQuery()).every((s) => s.count === undefined), true, "no counts unless asked");

	assert.deepEqual(run(sg.updateSavedSearchQuery(b.id, { name: "Paid", position: 0 })), { id: b.id, name: "Paid", query: "label:receipts", position: 0 });
	assert.equal(run(sg.updateSavedSearchQuery("nope", { name: "x" })), null);
	assert.throws(() => run(sg.updateSavedSearchQuery(b.id, { query: "invoice is:unread" })), /already saved/);
	assert.deepEqual(run(sg.listSavedSearchesQuery()).map((s) => s.name), ["Paid", "invoice is:unread"], "ordered by position");

	run(sg.createSavedSearchQuery({ query: "cc:boss" }, "s3"));
	const cc = run(sg.listSavedSearchesQuery({ tzOffset: 0 }, NOW)).find((s) => s.query === "cc:boss");
	assert.equal(cc.count, 1);
	run(sg.createSavedSearchQuery({ query: "before:soon" }, "s4"));
	assert.equal(run(sg.listSavedSearchesQuery({ tzOffset: 0 }, NOW)).find((s) => s.id === "s4").count, null, "a search that doesn't compile has no count");

	for (const s of run(sg.listSavedSearchesQuery())) assert.equal(run(sg.deleteSavedSearchQuery(s.id)), true);
	assert.equal(run(sg.deleteSavedSearchQuery("nope")), false);
	assert.deepEqual(run(sg.listSavedSearchesQuery()), []);
});

test("a create or update error comes back as a value", async () => {
	assert.deepEqual(await sg.savedResult(() => { throw new sg.SavedSearchError("nope"); }), { error: "nope" });
	await assert.rejects(sg.savedResult(() => { throw new Error("boom"); }), /boom/);
});
