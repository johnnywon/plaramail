import assert from "node:assert/strict";
import { test } from "node:test";
import { DB, guarded, NOW } from "./helpers/search-fixture.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// The search compiler (workers/store/search.ts) on the D1 schema. The same
// text gives the same conversations from the list API and the agent's tools,
// and no statement holds two MATCHes.

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const bulk = await loadTs("workers/lib/mail-bulk-sql.ts");
const params = await loadTs("workers/lib/mail-filter-params.ts");
const tools = await loadTs("workers/lib/tools.ts");
/** The conversations a search finds, sorted. Also runs the facet and bulk queries over it. */
function find(q, overrides = {}) {
	const exec = guarded(DB.exec);
	const filter = idx.emptyFilter({ view: "anywhere", q, ...overrides });
	const page = idx.runSync(idx.mailQuery(filter, { now: NOW, limit: 100 }), exec);
	idx.runSync(idx.facetsQuery(filter, NOW), exec);
	const keys = idx.runSync(bulk.matchingThreadKeysQuery(filter, 100, NOW), exec);
	const convs = page.conversations.map((c) => c.thread_key.split("\u001f")[1]).sort();
	assert.deepEqual([...new Set(keys.map((k) => k.split("\u001f")[1]))].sort(), convs, `bulk targets match the list for ${q}`);
	return convs;
}

// [query, conversations]
const QUERIES = [
	["invoice", ["t1", "t4"]],
	["INVOICE octob", ["t1"]],
	[`"wire transfer"`, ["t1"]],
	[`"transfer wire"`, []],
	["wire", ["t1"]],
	["invoice -wire", ["t4"]],
	["-invoice", ["t2", "t3", "t5"]],
	[`-"limited offer" transfer`, ["t1"]],
	["from:ann", ["t1", "t3"]],
	[`from:"Ann Lee"`, ["t1"]],
	["from:example.net", ["t2", "t4", "t5"]],
	["from:@example.net", ["t2", "t4", "t5"]],
	["from:ann@example.org", ["t1", "t3"]],
	["-from:example.net", ["t1", "t2", "t3"]],
	["to:ann@example.org", ["t1"]],
	["to:b@example.org", ["t3", "t4", "t5"]],
	["subject:lunch", ["t3"]],
	[`subject:"invoice october"`, ["t1"]],
	["subject:friday", []],
	["label:Receipts", ["t4"]],
	["label:receipts invoice", ["t4"]],
	["-label:receipts invoice", ["t1"]],
	["label:nope", []],
	["in:sent invoice", ["t1"]],
	["in:receipts", ["t4"]],
	["in:trash", ["t5"]],
	["in:inbox OR in:trash", ["t1", "t2", "t3", "t5"]],
	["-in:trash offer", []],
	["in:all offer", []],
	["is:unread", ["t1", "t3"]],
	["is:read in:inbox", ["t2"]],
	["is:starred", ["t2"]],
	["is:replied", ["t1"]],
	["is:unread OR is:starred", ["t1", "t2", "t3"]],
	["has:attachment", ["t1", "t3"]],
	["has:draft", ["t2"]],
	["has:unsubscribe", ["t2"]],
	["after:2d", ["t1", "t2", "t3", "t5"]],
	["before:7d", ["t4"]],
	["older:1w", ["t4"]],
	["newer:1m -in:trash", ["t1", "t2", "t3"]],
	["after:2026-10-11", ["t1", "t2", "t3", "t5"]],
	["before:2026-10-11 in:inbox", ["t2"]],
	["after:2026-10-11T11:15:00Z", ["t1", "t2"]],
	["list:news.example.net", ["t2"]],
	["from:ann OR from:billing", ["t1", "t3", "t4"]],
	["receipt OR lunch", ["t3", "t4"]],
	["ratio:4:3", []],
	["cc:boss", ["t1"]],
	["cc:example.net -invoice", []],
	["is:scheduled", ["t2"]],
	["has:pdf", ["t1"]],
	["has:image", ["t3"]],
	["filename:invoice", ["t1"]],
	["filename:jpg", ["t3"]],
	[`filename:"invoice.pdf"`, ["t1"]],
	["larger:5mb", ["t3"]],
	["smaller:10k in:anywhere", ["t1", "t2", "t4", "t5"]],
	["in:Receipts", ["t4"]],
	["has:link", ["t2"]],
	["-has:link invoice", ["t1", "t4"]],
];

test("every operator finds the expected conversations", () => {
	for (const [q, want] of QUERIES) assert.deepEqual(find(q), want, q);
});

test("the view applies unless in: names where to look", () => {
	assert.deepEqual(find("offer", { view: "all" }), []);
	assert.deepEqual(find("offer in:trash", { view: "all" }), ["t5"]);
	assert.deepEqual(find("invoice", { view: "inbox" }), ["t1"]);
	assert.deepEqual(find("invoice -in:sent", { view: "anywhere" }), ["t1", "t4"]);
});

test("chips and search text compile together", () => {
	assert.deepEqual(find("invoice", { subject: ["receipt"] }), ["t4"]);
	assert.deepEqual(find("", { subject: ["lunch"], is: ["unread"] }), ["t3"]);
	assert.deepEqual(find("-wire", { from: ["ann@example.org"] }), ["t3"]);
	assert.deepEqual(find("", { after: "2026-10-11", tzOffset: -14 * 60 }), ["t1", "t2", "t3", "t5"], "a day starts at the reader's midnight");
	assert.deepEqual(find("", { after: "2026-10-12", tzOffset: -14 * 60 }), ["t1", "t2", "t3"], "10-12 starts at 10:00 UTC at UTC+14");
	assert.deepEqual(find("", { after: "2026-10-12" }), []);
});

test("query syntax in user text is inert", () => {
	for (const q of [`ann@example.org "x" a-b AND OR NEAR : - ( ) * ^ {subject}:x`, `NOT invoice`, `"a""b"`, `subject:"x AND y"`, "from:NEAR(a b)", `- * " : ^`]) {
		assert.doesNotThrow(() => find(q), q);
	}
	assert.deepEqual(find("NOT invoice"), [], "NOT is a word here, and no message has it");
});

test("bad values are refused with the parser's message", () => {
	assert.throws(() => find("before:soon"), /before: needs a date/);
	assert.throws(() => params.parseMailParams(new URLSearchParams({ q: "is:maybe" })), /is: takes/);
});

test("the list API and the agent's tools give the same conversations", () => {
	const labels = [{ id: "receipts", name: "Receipts" }];
	for (const [q] of QUERIES.filter(([q]) => !q.startsWith("-") && q !== "ratio:4:3")) {
		const fromApi = params.parseMailParams(new URLSearchParams({ view: "all", q })).filter;
		const fromTool = tools.mailSearchFilter({ query: q }, labels).filter;
		const run = (filter) => idx.runSync(idx.mailQuery(filter, { now: NOW }), DB.exec).conversations.map((c) => c.thread_key);
		assert.deepEqual(run(fromTool), run(fromApi), q);
	}
	assert.match(tools.mailSearchFilter({ query: "before:soon" }, labels).error, /^before: needs a date.*The query uses the mail search language/);
});

test("label: matches a label's current name, not the name it was created with (#43)", () => {
	const exec = guarded(DB.exec);
	exec(`UPDATE labels SET name = 'Bills' WHERE id = 'receipts'`);
	try {
		assert.deepEqual(find("label:bills"), find("label:Bills"));
		assert.equal(find("label:bills").length, 1);
		assert.deepEqual(find("label:receipts"), [], "the old name no longer matches");
	} finally {
		exec(`UPDATE labels SET name = 'Receipts' WHERE id = 'receipts'`);
	}
});
