import assert from "node:assert/strict";
import { test } from "node:test";
import { addMessages, d1Db, row } from "./helpers/d1-mail.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// The combined list, facets, bulk planning and labels (mail-index-sql.ts,
// mail-bulk-sql.ts) on the D1 schema, run synchronously over node:sqlite.

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const { emptyFilter: filter } = idx;

const NOW = Date.parse("2026-10-09T15:00:00Z");

const apply = addMessages;

function keys(result) {
	return result.conversations.map((c) => `${c.mailbox_id}/${c.email_id}`);
}

const q = (exec, f, options = {}) => idx.runSync(idx.mailQuery(filter(f), { now: NOW, ...options }), exec);
const queryFacets = (exec, f) => idx.runSync(idx.facetsQuery(f, NOW), exec);

test("search follows deletes", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [row("e1", { body_text: "quarterly invoice attached" }), row("e2", { body_text: "lunch plans" })]);
	assert.equal(q(exec, { q: "invoice" }).conversations.length, 1);
	exec(`DELETE FROM messages WHERE email_id = 'e1'`);
	assert.equal(q(exec, { q: "invoice", view: "anywhere" }).conversations.length, 0);
	assert.equal(q(exec, { q: "lunch" }).conversations.length, 1);
});

function viewFixture() {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [
		row("in-unread"),
		row("in-read", { unread: false }),
		row("arch-star", { state: "archive", starred: true, unread: false }),
		row("trash-star", { state: "trash", starred: true }),
		row("spam", { state: "spam" }),
		row("draft", { state: "draft", unread: false }),
		row("sent", { state: "sent", unread: false }),
		row("custom", { state: "folder:receipts" }),
	]);
	return exec;
}

test("views map to states", () => {
	const exec = viewFixture();
	const ids = (view) => q(exec, { view }).conversations.map((c) => c.email_id).sort();
	assert.deepEqual(ids("inbox"), ["in-read", "in-unread"]);
	assert.deepEqual(ids("unread"), ["in-unread"]);
	assert.deepEqual(ids("starred"), ["arch-star"]);
	assert.deepEqual(ids("drafts"), ["draft"]);
	assert.deepEqual(ids("sent"), ["sent"]);
	assert.deepEqual(ids("trash"), ["trash-star"]);
	assert.deepEqual(ids("spam"), ["spam"]);
	assert.deepEqual(ids("folder:receipts"), ["custom"]);
	assert.deepEqual(ids("all"), ["arch-star", "custom", "draft", "in-read", "in-unread", "sent"]);
	assert.throws(() => q(exec, { view: "bogus" }), idx.InvalidFilterError);
	assert.throws(() => q(exec, { view: "folder:x' OR 1" }), idx.InvalidFilterError);
});

test("address matches full address, domain or local part, OR across values", () => {
	const { exec } = d1Db();
	apply(exec, "billing@example.org", [row("g1")]);
	apply(exec, "billing@example.net", [row("a1")]);
	apply(exec, "hello@example.com", [row("w1")]);
	const ids = (address) => q(exec, { address }).conversations.map((c) => c.email_id).sort();
	assert.deepEqual(ids(["billing"]), ["a1", "g1"]);
	assert.deepEqual(ids(["example.org"]), ["g1"]);
	assert.deepEqual(ids(["@example.org"]), ["g1"]);
	assert.deepEqual(ids(["hello@example.com", "example.org"]), ["g1", "w1"]);
	assert.deepEqual(ids(["Billing@Example.net"]), ["a1"]);
});

test("from matches sender address or domain, OR across values", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [
		row("s1", { sender_addr: "ann@store.example.com", sender_domain: "store.example.com" }),
		row("s2", { sender_addr: "bob@code.example.com", sender_domain: "code.example.com" }),
		row("s3", { sender_addr: "cy@x.example.net", sender_domain: "x.example.net" }),
	]);
	const ids = (from) => q(exec, { from }).conversations.map((c) => c.email_id).sort();
	assert.deepEqual(ids(["store.example.com", "bob@code.example.com"]), ["s1", "s2"]);
});

test("status, has, label and subject combine with AND", () => {
	const { exec } = d1Db();
	exec(`INSERT INTO labels (id, name, color) VALUES ('l1', 'Tax', 'red'), ('l2', 'Work', 'blue')`);
	apply(exec, "a@example.com", [
		row("both", { labels: ["l1", "l2"], starred: true, has_attachment: true, subject: "Invoice October" }),
		row("one", { labels: ["l1"], starred: true, subject: "Invoice September" }),
		row("unsub", { unsubscribe: "{}", unread: false, subject: "News" }),
	]);
	const ids = (f) => q(exec, f).conversations.map((c) => c.email_id).sort();
	assert.deepEqual(ids({ label: ["l1", "l2"] }), ["both"]);
	assert.deepEqual(ids({ label: ["l1"] }), ["both", "one"]);
	assert.deepEqual(ids({ is: ["starred", "unread"] }), ["both", "one"]);
	assert.deepEqual(ids({ is: ["read"] }), ["unsub"]);
	assert.deepEqual(ids({ has: ["attachment"] }), ["both"]);
	assert.deepEqual(ids({ has: ["unsubscribe"] }), ["unsub"]);
	assert.deepEqual(ids({ subject: ["invoice", "oct"] }), ["both"]);
	assert.deepEqual(ids({ subject: ["invoice"], is: ["starred"], has: ["attachment"] }), ["both"]);
});

test("search handles operators and punctuation without errors", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [
		row("e1", { sender_addr: "ann@example.org", body_text: "near the OR and AND gate" }),
		row("e2", { subject: "Quarterly report", body_text: "x", sender_addr: "zed@q.example.net", sender_name: "Zed", recipients: "me@example.net" }),
	]);
	const ids = (text) => q(exec, { q: text }).conversations.map((c) => c.email_id).sort();
	assert.deepEqual(ids("ann@example.org"), ["e1"]);
	assert.deepEqual(ids(`NEAR OR AND`), ["e1"]);
	assert.deepEqual(ids(`"gate`), ["e1"]);
	assert.deepEqual(ids("quart"), ["e2"]);
	assert.deepEqual(ids("-"), ["e1", "e2"]);
});

test("date tokens are relative to now and the viewer's time zone", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [
		row("today", { date: "2026-10-09T08:00:00.000Z" }),
		row("late-yesterday-utc", { date: "2026-10-09T02:00:00.000Z" }),
		row("week", { date: "2026-10-05T00:00:00.000Z" }),
		row("month", { date: "2026-09-20T00:00:00.000Z" }),
		row("old", { date: "2026-08-01T00:00:00.000Z" }),
	]);
	const ids = (f) => q(exec, f).conversations.map((c) => c.email_id).sort();
	assert.deepEqual(ids({ date: "today" }), ["late-yesterday-utc", "today"]);
	// UTC-7 (tzOffset 420): local today starts 2026-10-09T07:00Z.
	assert.deepEqual(ids({ date: "today", tzOffset: 420 }), ["today"]);
	assert.deepEqual(ids({ date: "yesterday", tzOffset: 420 }), ["late-yesterday-utc"]);
	assert.deepEqual(ids({ date: "7d" }), ["late-yesterday-utc", "today", "week"]);
	assert.deepEqual(ids({ date: "30d" }), ["late-yesterday-utc", "month", "today", "week"]);
	assert.deepEqual(ids({ date: "older" }), ["old"]);
	assert.deepEqual(ids({ after: "2026-09-01", before: "2026-10-06" }), ["month", "week"]);
});

test("a conversation shows its latest matching message with whole-thread counts", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [
		row("m1", { conversation_id: "t", date: "2026-10-01T00:00:00.000Z", sender_addr: "ann@x.example.org", unread: true }),
		row("m2", { conversation_id: "t", date: "2026-10-02T00:00:00.000Z", sender_addr: "bob@x.example.org", state: "archive", unread: false }),
		row("m3", { conversation_id: "t", date: "2026-10-03T00:00:00.000Z", sender_addr: "a@example.com", state: "draft", unread: false }),
	]);
	const [inbox] = q(exec, { view: "inbox" }).conversations;
	assert.equal(inbox.email_id, "m1");
	assert.equal(inbox.thread_count, 3);
	assert.equal(inbox.thread_unread_count, 1);
	assert.deepEqual(inbox.participants.sort(), ["a@example.com", "ann@x.example.org", "bob@x.example.org"]);
	assert.equal(inbox.has_draft, true);
	const all = q(exec, { view: "all" });
	assert.equal(all.conversations.length, 1);
	assert.equal(all.conversations[0].email_id, "m3");
});

test("also_in lists other mailboxes holding the same message", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [row("x1", { message_id: "shared@mail" })]);
	apply(exec, "b@example.org", [row("x2", { message_id: "shared@mail" })]);
	apply(exec, "c@example.org", [row("x3", { message_id: "other@mail" })]);
	const byBox = Object.fromEntries(q(exec, {}).conversations.map((c) => [c.mailbox_id, c.also_in]));
	assert.deepEqual(byBox, { "a@example.com": ["b@example.org"], "b@example.org": ["a@example.com"], "c@example.org": [] });
});

test("cursor pages cover every conversation once for every sort and direction", () => {
	const { exec } = d1Db();
	const rows = Array.from({ length: 23 }, (_, i) => row(`e${String(i).padStart(2, "0")}`, {
		date: `2026-10-0${1 + (i % 3)}T00:00:00.000Z`,
		sender_name: ["", "Zed", "amy", "Émile"][i % 4],
		sender_addr: `s${i % 5}@x.example.org`,
		subject_norm: ["alpha", "beta", ""][i % 3],
	}));
	apply(exec, "a@example.com", rows.slice(0, 12));
	apply(exec, "b@example.com", rows.slice(12));
	for (const sort of ["date", "from", "subject"]) {
		for (const dir of ["asc", "desc"]) {
			const seen = [];
			let cursor = null;
			let pages = 0;
			do {
				const page = q(exec, { sort, dir }, { cursor, limit: 5 });
				if (!cursor) assert.equal(page.total, 23);
				seen.push(...keys(page));
				cursor = page.nextCursor;
				assert.ok(++pages < 10);
			} while (cursor);
			assert.equal(seen.length, 23, `${sort} ${dir}`);
			assert.equal(new Set(seen).size, 23, `${sort} ${dir}`);
		}
	}
	assert.throws(() => q(exec, {}, { cursor: "not-a-cursor" }), idx.InvalidFilterError);
});

test("totals count conversations and conversations with unread mail", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [
		row("m1", { conversation_id: "t" }),
		row("m2", { conversation_id: "t" }),
		row("m3", { unread: false }),
	]);
	const page = q(exec, {});
	assert.equal(page.total, 2);
	assert.equal(page.unread, 1);
});

test("facets ignore their own dimension and count distinct conversations", () => {
	const { exec } = d1Db();
	exec(`INSERT INTO labels (id, name, color, position) VALUES ('l1', 'Tax', 'red', 0), ('l2', 'Unused', 'gray', 1)`);
	apply(exec, "a@example.com", [
		row("m1", { conversation_id: "t", sender_addr: "ann@store.example.com", sender_domain: "store.example.com", sender_name: "Ann", labels: ["l1"] }),
		row("m2", { conversation_id: "t", sender_addr: "ann@store.example.com", sender_domain: "store.example.com", sender_name: "Ann", unread: false }),
		row("m3", { sender_addr: "bob@code.example.com", sender_domain: "code.example.com", sender_name: "", has_attachment: true, date: "2026-08-01T00:00:00.000Z" }),
	]);
	apply(exec, "b@example.org", [row("m4", { sender_addr: "ann@store.example.com", sender_domain: "store.example.com", starred: true })]);
	const facets = queryFacets(exec, filter({ address: ["a@example.com"], from: ["store.example.com"] }));
	assert.deepEqual(facets.address, [{ value: "a@example.com", count: 1 }, { value: "b@example.org", count: 1 }]);
	assert.deepEqual(facets.from.domains, [{ value: "code.example.com", count: 1 }, { value: "store.example.com", count: 1 }]);
	assert.deepEqual(facets.from.addresses, [{ value: "ann@store.example.com", name: "Ann", count: 1 }, { value: "bob@code.example.com", name: "", count: 1 }]);
	assert.equal(facets.from.more, false);
	assert.deepEqual(facets.label, [{ value: "l1", name: "Tax", count: 1 }, { value: "l2", name: "Unused", count: 0 }]);
	assert.deepEqual(facets.status, { unread: 1, read: 1, starred: 0, attachment: 0, unsubscribe: 0 });
	assert.deepEqual(facets.date, { today: 1, yesterday: 0, "7d": 1, "30d": 1, older: 0 });
	const statusOmitted = queryFacets(exec, filter({ is: ["starred"] }));
	assert.equal(statusOmitted.status.unread, 3);
	assert.deepEqual(statusOmitted.address, [{ value: "b@example.org", count: 1 }]);
});

test("benchmark: 5,000 conversations, inbox page and facets under 100 ms each", () => {
	const { exec } = d1Db();
	const senders = Array.from({ length: 300 }, (_, i) => `s${i}@d${i % 40}.com`);
	const boxes = Array.from({ length: 19 }, (_, i) => `box${i}@example.com`);
	for (let b = 0; b < boxes.length; b++) {
		const rows = [];
		for (let i = b; i < 5000; i += boxes.length) {
			for (let k = 0; k < 2; k++) {
				const sender = senders[(i * 7 + k) % senders.length];
				rows.push(row(`c${i}-${k}`, {
					conversation_id: `c${i}`, state: k === 0 ? "inbox" : (i % 3 ? "archive" : "sent"),
					date: new Date(NOW - (i * 2 + k) * 3_600_000).toISOString(), sender_addr: sender,
					sender_domain: sender.split("@")[1], unread: i % 4 === 0, starred: i % 17 === 0,
					has_attachment: i % 9 === 0, subject: `Subject ${i % 500}`, subject_norm: `subject ${i % 500}`,
					body_text: `message body number ${i} about topic${i % 50}`,
				}));
			}
		}
		for (let i = 0; i < rows.length; i += 99) apply(exec, boxes[b], rows.slice(i, i + 99));
	}
	assert.equal(exec(`SELECT COUNT(*) AS n FROM messages`)[0].n, 10_000);
	const time = (fn) => { fn(); const start = performance.now(); fn(); return performance.now() - start; };
	const pageMs = time(() => q(exec, { view: "inbox" }, { limit: 50 }));
	const facetMs = time(() => queryFacets(exec, filter({ view: "inbox" })));
	const searchMs = time(() => q(exec, { view: "all", q: "topic7" }, { limit: 50 }));
	console.log(`inbox page ${pageMs.toFixed(1)} ms, facets ${facetMs.toFixed(1)} ms, search ${searchMs.toFixed(1)} ms`);
	// Time budgets hold only in CI. A busy laptop fails them with nothing wrong (WON-388); CI runs on every PR.
	if (process.env.CI) {
		assert.ok(pageMs < 100, `inbox page ${pageMs} ms`);
		assert.ok(facetMs < 100, `facets ${facetMs} ms`);
	}
});

const { parseMailParams } = await loadTs("workers/lib/mail-filter-params.ts");

test("parseMailParams reads repeatable values and defaults", () => {
	const { filter: f, cursor, limit } = parseMailParams(new URLSearchParams(
		"view=all&address=Billing&address=example.org&from=store.example.com&is=unread&is=starred&is=read&has=attachment&label=l1&q=%20invoice%20&date=7d&sort=from&dir=asc&tz=420&limit=500&cursor=abc",
	));
	assert.deepEqual(f, filter({
		view: "all", address: ["billing", "example.org"], from: ["store.example.com"], label: ["l1"], is: ["starred", "read"],
		has: ["attachment"], q: "invoice", date: "7d", sort: "from", dir: "asc", tzOffset: 420,
	}));
	assert.equal(cursor, "abc");
	assert.equal(limit, 100);
	assert.deepEqual(parseMailParams(new URLSearchParams("")).filter, filter());
});

test("parseMailParams rejects bad values", () => {
	for (const query of ["view=bogus", "is=maybe", "has=x", "date=tomorrow", "sort=size", "dir=up", "before=yesterday", `q=${"x".repeat(501)}`]) {
		assert.throws(() => parseMailParams(new URLSearchParams(query)), { name: "InvalidFilterError" }, query);
	}
});

test("folderViews lists custom folders with conversation counts", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [row("f1", { state: "folder:receipts" }), row("f2", { state: "folder:receipts" }), row("i1")]);
	assert.deepEqual(idx.runSync(idx.folderViewsQuery(), exec), [{ view: "folder:receipts", count: 2 }]);
});

// ── Phase 3: bulk planning, undo, labels ───────────────────────────

const bulk = await loadTs("workers/lib/mail-bulk-sql.ts");
const T = "\u001f";
/** A mail-bulk-sql query by name (`planBulk` runs `planBulkQuery`), over `exec`. */
const run = (exec, name, ...args) => idx.runSync(bulk[`${name}Query`](...args), exec);

function seedThread(exec) {
	apply(exec, "a@example.com", [
		row("in1", { conversation_id: "t", state: "inbox", date: "2026-10-09T10:00:00.000Z", unread: true }),
		row("in2", { conversation_id: "t", state: "inbox", date: "2026-10-09T09:00:00.000Z", unread: false, starred: true }),
		row("sent1", { conversation_id: "t", state: "sent", date: "2026-10-09T11:00:00.000Z", unread: false }),
		row("draft1", { conversation_id: "t", state: "draft", date: "2026-10-09T12:00:00.000Z", unread: false }),
		row("f1", { conversation_id: "f", state: "folder:receipts", date: "2026-10-08T10:00:00.000Z" }),
	]);
	return { t: `a@example.com${T}t`, f: `a@example.com${T}f` };
}

const ids = (plan) => plan.entries.map((e) => e.email_id).sort();

test("sourceState maps views to the state a move takes messages from", () => {
	assert.equal(bulk.sourceState("inbox"), "inbox");
	assert.equal(bulk.sourceState("unread"), "inbox");
	assert.equal(bulk.sourceState("starred"), "inbox");
	assert.equal(bulk.sourceState("all"), "inbox");
	assert.equal(bulk.sourceState("drafts"), "draft");
	assert.equal(bulk.sourceState("sent"), "sent");
	assert.equal(bulk.sourceState("folder:receipts"), "folder:receipts");
});

test("thread moves change only messages in the source state", () => {
	const { exec } = d1Db();
	const k = seedThread(exec);
	for (const view of ["inbox", "unread", "starred", "all"]) {
		assert.deepEqual(ids(run(exec, "planBulk", [k.t], view, { type: "archive" })), ["in1", "in2"], view);
	}
	assert.deepEqual(ids(run(exec, "planBulk", [k.t], "sent", { type: "archive" })), ["sent1"]);
	assert.deepEqual(ids(run(exec, "planBulk", [k.f], "folder:receipts", { type: "archive" })), ["f1"]);
	assert.deepEqual(run(exec, "planBulk", [k.t], "archive", { type: "archive" }).ops, []);
	const plan = run(exec, "planBulk", [k.f], "folder:receipts", { type: "archive" });
	assert.deepEqual(plan.ops, [{ mailboxId: "a@example.com", kind: "move", emailIds: ["f1"], to: "archive", from: "receipts" }]);
});

test("flag actions plan only rows that change; star picks the latest non-draft message", () => {
	const { exec } = d1Db();
	const k = seedThread(exec);
	assert.deepEqual(ids(run(exec, "planBulk", [k.t], "inbox", { type: "read" })), ["in1"]);
	assert.deepEqual(ids(run(exec, "planBulk", [k.t], "inbox", { type: "star" })), ["sent1"]);
	assert.deepEqual(ids(run(exec, "planBulk", [k.t], "inbox", { type: "unstar" })), ["in2"]);
});

test("label_add skips messages that have the label; label_remove takes only those that do", () => {
	const { exec } = d1Db();
	exec(`INSERT INTO labels (id, name, color) VALUES ('tax', 'Tax', '#c8372d')`);
	apply(exec, "a@example.com", [
		row("x1", { conversation_id: "t", labels: ["tax"] }),
		row("x2", { conversation_id: "t", date: "2026-10-09T11:00:00.000Z" }),
	]);
	const key = `a@example.com${T}t`;
	const add = run(exec, "planBulk", [key], "inbox", { type: "label_add", labelId: "tax" });
	assert.deepEqual(ids(add), ["x2"]);
	assert.deepEqual(add.entries[0].label, { id: "tax", had: false });
	assert.deepEqual(ids(run(exec, "planBulk", [key], "inbox", { type: "label_remove", labelId: "tax" })), ["x1"]);
});

test("ops are grouped per mailbox and chunked to 100 ids", () => {
	const { exec } = d1Db();
	const rows = Array.from({ length: 150 }, (_, i) => row(`m${String(i).padStart(3, "0")}`, { conversation_id: `c${i}` }));
	for (let i = 0; i < rows.length; i += 50) apply(exec, "a@example.com", rows.slice(i, i + 50));
	apply(exec, "b@example.com", [row("b1", { conversation_id: "cb" })]);
	const keys = [...rows.map((_, i) => `a@example.com${T}c${i}`), `b@example.com${T}cb`];
	const plan = run(exec, "planBulk", keys, "inbox", { type: "archive" });
	assert.deepEqual(plan.ops.map((op) => [op.mailboxId, op.emailIds.length]), [["a@example.com", 100], ["a@example.com", 50], ["b@example.com", 1]]);
	assert.equal(bulk.opSize(plan.ops), 151);
});

test("undo reverses exactly what was planned", () => {
	const { exec } = d1Db();
	const k = seedThread(exec);
	const archive = run(exec, "planBulk", [k.t, k.f], "all", { type: "archive" });
	assert.deepEqual(bulk.planUndo({ action: { type: "archive" }, entries: archive.entries }), [
		{ mailboxId: "a@example.com", kind: "move", emailIds: ["in1", "in2"], to: "inbox", from: "archive" },
	]);
	const folder = run(exec, "planBulk", [k.f], "folder:receipts", { type: "trash" });
	assert.deepEqual(bulk.planUndo({ action: { type: "trash" }, entries: folder.entries }), [
		{ mailboxId: "a@example.com", kind: "move", emailIds: ["f1"], to: "receipts", from: "trash" },
	]);
	const read = run(exec, "planBulk", [k.t], "inbox", { type: "read" });
	assert.deepEqual(bulk.planUndo({ action: { type: "read" }, entries: read.entries }), [
		{ mailboxId: "a@example.com", kind: "flags", emailIds: ["in1"], patch: { read: false } },
	]);
	const add = { action: { type: "label_add", labelId: "tax" }, entries: [{ mailbox_id: "a@example.com", email_id: "in1", label: { id: "tax", had: false } }] };
	assert.deepEqual(bulk.planUndo(add), [{ mailboxId: "a@example.com", kind: "labels", emailIds: ["in1"], add: [], remove: ["tax"] }]);
});

test("undo records are taken once and expire after an hour", () => {
	const { exec } = d1Db();
	const payload = { action: { type: "archive" }, entries: [] };
	run(exec, "saveUndo", "u1", payload, NOW);
	assert.deepEqual(run(exec, "takeUndo", "u1", NOW + 1000), payload);
	assert.equal(run(exec, "takeUndo", "u1", NOW + 1000), null);
	run(exec, "saveUndo", "u2", payload, NOW);
	assert.equal(run(exec, "takeUndo", "u2", NOW + 61 * 60 * 1000), null);
});

test("a filter target counts conversations up to asOf and refuses a changed count", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [
		row("old", { date: "2026-10-09T10:00:00.000Z" }),
		row("new", { date: "2026-10-09T14:00:00.000Z" }),
	]);
	const keys = run(exec, "resolveFilterTarget", filter({}), "2026-10-09T12:00:00.000Z", 1, NOW);
	assert.deepEqual(keys, [`a@example.com${T}old`]);
	assert.throws(() => run(exec, "resolveFilterTarget", filter({}), "2026-10-09T15:00:00.000Z", 1, NOW), (e) => e.name === "BulkConflictError" && e.count === 2);
});

test("label definitions: slug ids, unique names, rename keeps the id, counts and delete", () => {
	const { exec } = d1Db();
	const a = run(exec, "createLabel", { name: "Receipts", color: "#c8372d" });
	assert.equal(a.id, "receipts");
	assert.throws(() => run(exec, "createLabel", { name: "receipts" }), /exists/);
	assert.throws(() => run(exec, "createLabel", { name: "Bad", color: "#123456" }), /palette/);
	exec(`UPDATE labels SET name = 'Old receipts' WHERE id = 'receipts'`);
	assert.equal(run(exec, "createLabel", { name: "Receipts!" }).id, "receipts-2");
	assert.equal(run(exec, "updateLabel", "receipts", { name: "Paid" }).id, "receipts");
	assert.equal(run(exec, "createLabel", { name: "Folder", id: "my-folder" }).id, "my-folder");

	apply(exec, "a@example.com", [
		row("l1", { conversation_id: "t", labels: ["receipts"] }),
		row("l2", { conversation_id: "t", labels: ["receipts"] }),
		row("l3", { conversation_id: "u", labels: ["receipts"], state: "trash" }),
	]);
	assert.equal(run(exec, "listLabels").find((l) => l.id === "receipts").count, 1);
	assert.deepEqual(run(exec, "labelThreadKeys", "receipts").sort(), [`a@example.com${T}t`, `a@example.com${T}u`]);

	assert.equal(run(exec, "threadKeyOf", "A@example.com", "l1"), `a@example.com${T}t`);
	assert.equal(run(exec, "deleteLabelRows", "receipts"), true);
	assert.equal(Number(exec(`SELECT COUNT(*) AS n FROM message_labels WHERE label_id = 'receipts'`)[0].n), 0);
});

test("bulk jobs record progress and finish", () => {
	const { exec } = d1Db();
	const ops = [1, 2, 3].map((i) => ({ mailboxId: "a@example.com", kind: "flags", emailIds: [`e${i}`], patch: { read: true } }));
	run(exec, "createBulkJob", "j1", { type: "read" }, ops, "u1", NOW);
	const first = run(exec, "nextBulkOps", 2);
	assert.equal(first.ops.length, 2);
	run(exec, "saveBulkProgress", "j1", { ops: 2, affected: 2, failed: [] }, NOW);
	run(exec, "saveBulkProgress", "j1", { ops: 1, affected: 0, failed: [{ mailboxId: "a@example.com", error: "x" }] }, NOW);
	const job = run(exec, "getBulkJob", "j1");
	assert.equal(job.done, 3);
	assert.equal(job.affected, 2);
	assert.ok(job.finishedAt);
	assert.equal(run(exec, "nextBulkOps", 2), null);
});

test("Empty Trash counts trash messages and plans purge ops per mailbox", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [
		row("t1", { conversation_id: "c1", state: "trash" }),
		row("t2", { conversation_id: "c1", state: "trash", date: "2026-10-09T11:00:00.000Z" }),
		row("i1", { conversation_id: "c1", state: "inbox" }),
		row("d1", { conversation_id: "c2", state: "draft" }),
	]);
	apply(exec, "b@example.com", [row("t3", { conversation_id: "c3", state: "trash" })]);
	assert.deepEqual(run(exec, "trashCount"), { messages: 3, conversations: 2 });
	assert.deepEqual(run(exec, "planEmptyTrash", 3), [
		{ mailboxId: "a@example.com", kind: "purge", emailIds: ["t1", "t2"] },
		{ mailboxId: "b@example.com", kind: "purge", emailIds: ["t3"] },
	]);
	assert.throws(() => run(exec, "planEmptyTrash", 2), (e) => e instanceof bulk.BulkConflictError && e.count === 3);
	exec(`DELETE FROM messages WHERE email_id = 't1'`);
	assert.deepEqual(run(exec, "trashCount"), { messages: 2, conversations: 2 });
});

test("Empty Trash ops are chunked to 100 ids", () => {
	const { exec } = d1Db();
	const rows = Array.from({ length: 130 }, (_, i) => row(`t${String(i).padStart(3, "0")}`, { conversation_id: `c${i}`, state: "trash" }));
	for (let i = 0; i < rows.length; i += 50) apply(exec, "a@example.com", rows.slice(i, i + 50));
	assert.deepEqual(run(exec, "planEmptyTrash", 130).map((op) => op.emailIds.length), [100, 30]);
});

test("rows carry the recipient, so Sent can say who mail went to (#34)", () => {
	const { exec } = d1Db();
	apply(exec, "a@example.com", [row("s1", { state: "sent", sender_addr: "a@example.com", sender_name: "a", recipients: "bob@example.org, cy@example.net" })]);
	const [sent] = q(exec, { view: "sent" }).conversations;
	assert.equal(sent.recipient, "bob@example.org, cy@example.net");
});
