import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const f = await loadTs("app/lib/mail-filter.ts");
const P = (s) => new URLSearchParams(s);

test("a bare URL lands on unread Inbox; an explicit view does not", () => {
	assert.deepEqual(f.parseFilter(P("")), { view: "inbox", chips: [{ kind: "is", value: "unread" }], sort: "date", dir: "desc" });
	assert.deepEqual(f.parseFilter(P("open=a@x.example.org:e1")).chips, [{ kind: "is", value: "unread" }]);
	assert.deepEqual(f.parseFilter(P("view=inbox")).chips, []);
});

test("URL round trip keeps chip order and drops invalid values", () => {
	const filter = f.parseFilter(P("view=all&from=Store.example.com&address=billing&is=starred&date=7d&q=invoice&sort=from&dir=asc&is=bogus&date=never&before=yesterday"));
	assert.deepEqual(filter, {
		view: "all",
		chips: [
			{ kind: "from", value: "store.example.com" }, { kind: "address", value: "billing" },
			{ kind: "is", value: "starred" }, { kind: "date", value: "7d" }, { kind: "q", value: "invoice" },
		],
		sort: "from", dir: "asc",
	});
	assert.equal(f.filterToParams(filter).toString(), "view=all&from=store.example.com&address=billing&is=starred&date=7d&q=invoice&sort=from&dir=asc");
	assert.deepEqual(f.parseFilter(f.filterToParams(filter)), filter);
	assert.equal(f.parseFilter(P("view=folder:x'1")).view, "inbox");
	assert.equal(f.parseFilter(P("view=folder:receipts")).view, "folder:receipts");
});

test("read and unread replace each other in place; single kinds replace; duplicates collapse", () => {
	let chips = [];
	chips = f.addChip(chips, { kind: "is", value: "unread" });
	chips = f.addChip(chips, { kind: "from", value: "a.example.com" });
	chips = f.addChip(chips, { kind: "is", value: "read" });
	chips = f.addChip(chips, { kind: "from", value: "a.example.com" });
	chips = f.addChip(chips, { kind: "date", value: "today" });
	chips = f.addChip(chips, { kind: "date", value: "30d" });
	chips = f.addChip(chips, { kind: "is", value: "starred" });
	assert.deepEqual(chips, [
		{ kind: "is", value: "read" }, { kind: "from", value: "a.example.com" }, { kind: "date", value: "30d" }, { kind: "is", value: "starred" },
	]);
	assert.deepEqual(f.removeChip(chips, { kind: "from", value: "a.example.com" }).map((c) => c.kind), ["is", "date", "is"]);
});

test("api params group chips by kind and carry the time zone", () => {
	const filter = f.parseFilter(P("view=inbox&from=a.example.com&address=billing&from=b.example.com"));
	assert.equal(f.apiParams(filter, 420).toString(), "view=inbox&address=billing&from=a.example.com&from=b.example.com&tz=420");
});

test("open param round trip", () => {
	assert.deepEqual(f.parseOpen(P("open=Billing@Example.org:abc-1")), { mailboxId: "billing@example.org", emailId: "abc-1" });
	assert.equal(f.parseOpen(P("open=nocolon")), null);
	assert.equal(f.toSearch(f.parseFilter(P("view=sent")), { mailboxId: "a@x.example.org", emailId: "e1" }), "?view=sent&open=a%40x.example.org%3Ae1");
	assert.equal(f.toSearch(f.parseFilter(P("view=inbox")), null, "from:ann "), "?view=inbox&search=from%3Aann+");
	assert.equal(f.toSearch(f.parseFilter(P("view=inbox")), null, "  "), "?view=inbox");
});

test("search text: operators become chips, in: sets the view, the rest is text", () => {
	const parsed = f.parseSearchText(`from:ann@b.example.com to:billing subject:"q 3 report" subject:lunch in:archive is:Starred has:attachment before:2026-09-01 after:2026-08-01 label:x rest words`);
	assert.equal(parsed.view, "archive");
	assert.deepEqual(parsed.chips, [
		{ kind: "from", value: "ann@b.example.com" }, { kind: "address", value: "billing" }, { kind: "subject", value: "lunch" },
		{ kind: "is", value: "starred" }, { kind: "has", value: "attachment" }, { kind: "before", value: "2026-09-01" }, { kind: "after", value: "2026-08-01" },
	]);
	assert.equal(parsed.text, `subject:"q 3 report" label:x rest words`, "a quoted subject is a phrase, which only the server runs");
	assert.deepEqual(parsed.errors, []);
	const bad = f.parseSearchText("is:maybe in:nowhere before:soon hello");
	assert.equal(bad.text, "in:nowhere hello", "bad values are left out; a folder name stays for the server");
	assert.deepEqual(bad.errors.map((e) => e.op), ["is", "before"]);
	assert.equal(f.parseSearchText("email:foo@bar.example.com").text, "email:foo@bar.example.com");
});

test("search text the URL has no chip for stays text", () => {
	const t = (s) => f.parseSearchText(s).text;
	assert.equal(t("-from:store.example.com invoice"), "-from:store.example.com invoice");
	assert.equal(t("from:store.example.com OR from:pay.example.net"), "from:store.example.com OR from:pay.example.net");
	assert.equal(t("from:ann"), "from:ann", "a name is a word search on the sender");
	assert.equal(t("is:scheduled has:pdf after:30d larger:5mb in:anywhere sort:date"), "is:scheduled has:pdf after:30d larger:5mb in:anywhere sort:date");
	assert.deepEqual(f.parseSearchText("is:unread OR is:starred").chips, []);
});

const LABELS = [{ id: "receipts", name: "Receipts" }, { id: "tax-2026", name: "Tax 2026" }];

test("label: resolves a name to the label's id; unknown labels stay text", () => {
	assert.deepEqual(f.parseSearchText("label:receipts", LABELS).chips, [{ kind: "label", value: "receipts" }]);
	assert.deepEqual(f.parseSearchText('label:"tax 2026" invoice', LABELS), { view: undefined, chips: [{ kind: "label", value: "tax-2026" }], text: "invoice", errors: [] });
	assert.deepEqual(f.parseSearchText("label:Tax-2026", LABELS).chips, [{ kind: "label", value: "tax-2026" }]);
	assert.deepEqual(f.parseSearchText("label:nope", LABELS), { view: undefined, chips: [], text: "label:nope", errors: [] });
	assert.deepEqual(f.parseSearchText("label:receipts").chips, [], "without a label list nothing resolves");
	const next = f.applySearch({ view: "inbox", chips: [], sort: "date", dir: "desc" }, "label:Receipts label:tax-2026", LABELS);
	assert.deepEqual(next.chips, [{ kind: "label", value: "receipts" }, { kind: "label", value: "tax-2026" }]);
});


test("label: resolves the current name only; a renamed label's first name doesn't (#43)", () => {
	const renamed = [{ id: "receipts", name: "Bills" }, { id: "tax-2026", name: "Tax 2026" }];
	assert.deepEqual(f.parseSearchText("label:bills", renamed).chips, [{ kind: "label", value: "receipts" }]);
	assert.deepEqual(f.parseSearchText("label:receipts", renamed).chips, []);
	assert.deepEqual(f.parseSearchText("label:tax-2026", renamed).chips, [{ kind: "label", value: "tax-2026" }], "spaces may be written as hyphens");
});
