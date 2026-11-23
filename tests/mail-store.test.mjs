import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { statements } from "./helpers/schema.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// One script of store calls (workers/store/types.ts) on local D1 and R2:
// what every route, the agent and MCP rely on. Tests run in order and share
// the database.

const A = "a@example.com";
const B = "b@example.org";
let mf;
let bucket;

before(async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/store-worker.ts"], bundle: true, format: "esm", platform: "neutral",
		conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"], external: ["cloudflare:workers"],
		write: false, logLevel: "silent",
	});
	mf = new Miniflare({
		modules: true,
		script: bundle.outputFiles[0].text,
		compatibilityDate: "2025-11-28",
		compatibilityFlags: ["nodejs_compat"],
		bindings: { EMAIL_ADDRESSES: [A, B] },
		r2Buckets: ["BUCKET"],
		d1Databases: ["DB"],
	});
	for (const s of statements(D1_SCHEMA)) await ok("-", "_sql", s);
	for (const m of [A, B]) await ok("registry", "put", m, { fromName: m });
	bucket = await mf.getR2Bucket("BUCKET");
});

after(async () => {
	await mf?.dispose();
});

async function call(target, op, ...args) {
	const response = await mf.dispatchFetch("http://test/", { method: "POST", body: JSON.stringify({ target, op, args }) });
	return response.json();
}

async function ok(target, op, ...args) {
	const result = await call(target, op, ...args);
	assert.equal(result.error, undefined, `${target}.${op}: ${result.error}`);
	return result.ok;
}

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const email = (id, fields = {}) => ({
	id, subject: "Hello", sender: "ann@example.net", recipient: A, cc: null, bcc: null, date: hoursAgo(1),
	body: "<p>Hello there</p>", thread_id: id, message_id: `${id}@example.net`, raw_headers: JSON.stringify([{ key: "from", value: "Ann <ann@example.net>" }]),
	...fields,
});
const all = { view: "all", address: [], from: [], label: [], is: [], has: [], subject: [], q: "", sort: "date", dir: "desc", tzOffset: 0 };
const ids = (page) => page.conversations.map((c) => c.email_id);

test("the registry lists, reads and updates mailboxes", async () => {
	assert.deepEqual(await ok("registry", "list"), [{ id: A, email: A }, { id: B, email: B }]);
	assert.equal(await ok("registry", "exists", "A@Example.com"), true);
	assert.equal(await ok("registry", "exists", "c@example.net"), false);
	await ok("registry", "put", B, { fromName: "Billing" });
	assert.deepEqual(await ok("registry", "get", B), { fromName: "Billing" });
	assert.equal(await ok("registry", "get", "c@example.net"), null);
});

test("storing and reading mail", async () => {
	await ok(A, "createEmail", "inbox", email("e1", { subject: "Invoice October", body: "<p>Your invoice is attached</p>" }), [
		{ id: "att1", email_id: "e1", filename: "invoice.pdf", mimetype: "application/pdf", size: 1200, content_id: null, disposition: "attachment" },
	]);
	await ok(A, "createEmail", "sent", email("e2", { subject: "Re: Invoice October", sender: A, recipient: "ann@example.net", thread_id: "e1", in_reply_to: "e1@example.net", date: hoursAgo(0.5) }), []);
	await ok(A, "createEmail", "inbox", email("e3", { subject: "Weekly digest", sender: "news@example.net", date: hoursAgo(30), raw_headers: JSON.stringify([{ key: "list-id", value: "<news.example.net>" }]) }), []);
	await ok(B, "createEmail", "inbox", email("e4", { subject: "Lunch", recipient: B, date: hoursAgo(2) }), []);
	await ok(A, "createEmail", "draft", email("e5", { subject: "Re: Lunch", sender: A, thread_id: null, in_reply_to: "e1" }), []);
	assert.match((await call(A, "createEmail", "nowhere", email("bad"), [])).error, /not found/);

	assert.equal(await ok(A, "hasInboundMessageId", "e1@example.net"), true);
	assert.equal(await ok(A, "hasInboundMessageId", "e2@example.net"), false, "sent mail is not inbound");
	assert.equal(await ok(A, "hasInboundMessageId", "e4@example.net"), false, "another mailbox's mail");
	assert.equal(await ok(A, "hasInboundMessageId", "unknown@example.net"), false);

	const e1 = await ok(A, "getEmail", "e1");
	assert.equal(e1.subject, "Invoice October");
	assert.equal(e1.folder_id, "inbox");
	assert.deepEqual(e1.attachments.map((a) => a.filename), ["invoice.pdf"]);
	assert.equal(await ok(A, "getEmail", "e4"), null, "another mailbox's mail");
	assert.deepEqual((await ok(A, "getEmails", { folder: "inbox" })).map((e) => e.id), ["e1", "e3"]);
	assert.deepEqual((await ok(A, "getEmails", { folder: "Inbox", sortColumn: "subject", sortDirection: "ASC" })).map((e) => e.subject), ["Invoice October", "Weekly digest"]);
	assert.deepEqual((await ok(A, "getThreadEmails", "e1")).map((e) => e.id), ["e1", "e2"]);
	assert.equal((await ok(A, "getAttachment", "att1")).filename, "invoice.pdf");
	assert.equal(await ok(B, "getAttachment", "att1"), null, "another mailbox's attachment");
});

test("flags, moves and deletes", async () => {
	await ok(A, "markThreadRead", "e1");
	assert.equal((await ok(A, "getEmail", "e1")).read, true);
	await ok(A, "updateEmail", "e3", { starred: true });
	assert.equal((await ok(A, "getEmail", "e3")).starred, true);
	assert.equal(await ok(A, "moveEmail", "e3", "archive"), true);
	assert.equal(await ok(A, "moveEmail", "e3", "nowhere"), false);
	assert.match((await call(A, "deleteEmail", "e3")).error, /Trash or Drafts/);
	assert.equal((await ok(A, "trashOrDelete", "e3")).action, "trashed");
	assert.equal((await ok(A, "getEmail", "e3")).folder_id, "trash");
	assert.equal((await ok(A, "trashOrDelete", "e3")).action, "deleted");
	assert.equal(await ok(A, "trashOrDelete", "e3"), null);
	assert.equal(await ok(A, "getEmail", "e3"), null);
});

test("threading and send limits", async () => {
	assert.equal(await ok(A, "findThreadBySubject", "RE: invoice october", "ann@example.net"), "e1");
	assert.equal(await ok(A, "findThreadBySubject", "Invoice October", "zed@example.net"), null);
	assert.equal(await ok(A, "findThreadBySubject", "Re: Invoice October", "zed@example.net"), null);
	assert.equal(await ok(A, "findThreadByMessageIds", ["unknown@example.net", "e2@example.net"]), "e1");
	assert.equal(await ok(A, "findThreadByMessageIds", ["unknown@example.net"]), null);
	assert.equal((await ok(A, "takeSendBudget", "person", 1)).ok, true);
});

test("scheduled send", async () => {
	const sendAt = new Date(Date.now() + 3_600_000).toISOString();
	const scheduled = await ok(A, "scheduleSend", { sendAt, mode: "new", email: { to: "bob@example.org", from: A, subject: "Later", html: "<p>Later</p>" } });
	assert.equal(scheduled.sendAt, sendAt);
	assert.deepEqual(
		await ok(A, "scheduleSend", { sendAt, mode: "reply", originalId: "missing", email: { to: "bob@example.org", from: A, subject: "Re", html: "x" } }),
		{ error: "Original email not found", status: 404 },
	);
	assert.deepEqual(await ok(A, "listScheduled"), [{ emailId: scheduled.id, sendAt, attempts: 0, error: null }]);
	assert.deepEqual(await ok(B, "listScheduled"), []);
	assert.equal(await ok(A, "cancelScheduled", scheduled.id), true);
	assert.deepEqual(await ok(A, "listScheduled"), []);
	assert.deepEqual((await ok(A, "getEmails", { folder: "draft" })).map((e) => e.subject).sort(), ["Later", "Re: Lunch"], "the draft stays");
});

test("the combined list, facets, labels, bulk and undo", async () => {
	assert.deepEqual(ids(await ok("all", "queryMail", { ...all, view: "inbox" })), ["e1", "e4"]);
	const everything = await ok("all", "queryMail", all);
	assert.equal(everything.total, 3);
	assert.deepEqual(ids(await ok("all", "queryMail", { ...all, q: "invoice sort:date" })), ["e2"], "a thread shows its latest match");
	const facets = await ok("all", "queryFacets", all);
	assert.deepEqual(facets.address, [{ value: A, count: 2 }, { value: B, count: 1 }]);
	assert.deepEqual(await ok("all", "folderViews"), []);
	assert.deepEqual(await ok("all", "trashCount"), { messages: 0, conversations: 0 });

	assert.equal((await ok("all", "createLabel", { name: "Money", color: "#c8372d" })).label.id, "money");
	assert.match((await ok("all", "createLabel", { name: "money" })).error, /exists/, "an input error comes back as a value");
	assert.equal((await ok("all", "updateLabel", "money", { color: "#d9822b" })).label.color, "#d9822b");
	assert.deepEqual(await ok("all", "markLabelsAuto", ["money", "missing"]), { flagged: ["money"] });
	const key = await ok("all", "threadKeyOf", A, "e1");
	assert.equal(key, `${A}\u001fe1`);
	assert.equal((await ok("all", "threadKeysMatching", { ...all, address: [A] }, 10)).length, 2);

	const label = await ok("all", "bulk", { threadKeys: [key], view: "all" }, { type: "label_add", labelId: "money" });
	assert.equal(label.affected, 3, "the message, its sent reply and the reply draft all get the label");
	assert.equal((await ok("all", "listLabels")).find((l) => l.id === "money").count, 1);
	assert.deepEqual(ids(await ok("all", "queryMail", { ...all, label: ["money"] })), ["e2"]);

	const archive = await ok("all", "bulk", { threadKeys: [key], view: "inbox" }, { type: "archive" });
	assert.deepEqual([archive.affected, archive.failed], [1, []]);
	assert.equal((await ok(A, "getEmail", "e1")).folder_id, "archive");
	assert.deepEqual(await ok("all", "undo", archive.undoId), { affected: 1, failed: [] });
	assert.equal((await ok(A, "getEmail", "e1")).folder_id, "inbox");
	assert.equal(await ok("all", "undo", archive.undoId), null, "undo runs once");

	assert.deepEqual(await ok("all", "bulk", { filter: all, asOf: new Date().toISOString(), expectedCount: 99 }, { type: "read" }), { conflict: 3 });
	const read = await ok("all", "bulk", { filter: { ...all, address: [B] }, asOf: new Date().toISOString(), expectedCount: 1 }, { type: "read" });
	assert.equal(read.affected, 1);
	assert.equal((await ok(B, "getEmail", "e4")).read, true);

	assert.deepEqual(await ok("all", "deleteLabel", "money"), { deleted: true, affected: 3, failed: [] });
	assert.equal(await ok("all", "deleteLabel", "money"), null);
	assert.deepEqual(await ok("all", "listLabels"), []);
});

test("Empty Trash deletes only Trash mail and its files", async () => {
	await ok(B, "createEmail", "inbox", email("junk", { recipient: B }), [
		{ id: "att2", email_id: "junk", filename: "x.pdf", mimetype: "application/pdf", size: 3, content_id: null, disposition: "attachment" },
	]);
	await bucket.put("attachments/junk/att2/x.pdf", "pdf");
	assert.equal((await ok(B, "trashOrDelete", "junk")).action, "trashed");
	assert.deepEqual(await ok("all", "trashCount"), { messages: 1, conversations: 1 });
	assert.deepEqual(await ok("all", "emptyTrash", 5), { conflict: 1 });
	assert.ok(await ok(B, "getEmail", "junk"), "a refused Empty Trash deletes nothing");
	assert.deepEqual(await ok("all", "emptyTrash", 1), { deleted: 1, failed: [] });
	assert.deepEqual(await ok("all", "trashCount"), { messages: 0, conversations: 0 });
	assert.equal(await bucket.head("attachments/junk/att2/x.pdf"), null);
	assert.ok(await ok(B, "getEmail", "e4"));
	assert.ok(await ok(A, "getEmail", "e5"), "drafts stay");
});

test("folder import turns a custom folder into a label", async () => {
	// Custom folders predate labels; the store doesn't create them.
	await ok("-", "_sql", `INSERT INTO folders (mailbox_id, id, name) VALUES ('${A}', 'receipts', 'Receipts')`);
	await ok(A, "createEmail", "receipts", email("r1", { subject: "Receipt 1" }), []);
	await ok(A, "createEmail", "receipts", email("r2", { subject: "Receipt 2" }), []);
	assert.deepEqual(await ok(A, "folderImportCounts"), { folders: [{ folderId: "receipts", name: "Receipts", count: 2 }], imported: false });
	assert.deepEqual(await ok("all", "folderViews"), [{ view: "folder:receipts", count: 2 }]);
	assert.deepEqual(await ok(A, "folderEmailIds", "receipts"), ["r1", "r2"]);
	await ok("all", "createLabel", { name: "Receipts", id: "receipts" });
	assert.deepEqual(await ok(A, "importFolder", "receipts", "receipts"), { labeled: 2, archived: 2 });
	assert.deepEqual(await ok(A, "importFolder", "receipts", "receipts"), { labeled: 0, archived: 0 });
	assert.match((await call(A, "importFolder", "inbox", "receipts")).error, /System folders/);
	await ok(A, "markFoldersImported");
	assert.equal(await ok(A, "moveEmail", "r1", "receipts"), false, "moves into custom folders stop");
	assert.equal(await ok(A, "moveEmail", "r1", "inbox"), true);
	assert.deepEqual(await ok(A, "folderImportCounts"), { folders: [{ folderId: "receipts", name: "Receipts", count: 0 }], imported: true });
});

test("a body over 512 KB lives in R2 and reads back the same", async () => {
	const big = `<p>${"x".repeat(600 * 1024)}</p>`;
	await ok(A, "createEmail", "trash", email("big1", { body: big }), []);
	assert.equal((await ok(A, "getEmail", "big1")).body, big);
	assert.ok(await bucket.head("bodies/big1.html"), "the body is in R2");
	await ok(A, "deleteEmail", "big1");
	assert.equal(await bucket.head("bodies/big1.html"), null, "deleting the message deletes its body");
});

test("suggestions and saved searches", async () => {
	const out = await ok("all", "suggest", { ...all, view: "anywhere" }, "invoice from:an", 15);
	assert.equal(out.completions[0].value, "ann@example.net");
	assert.ok(out.count > 0);
	const { saved } = await ok("all", "createSavedSearch", { query: "from:ann" });
	assert.equal(saved.name, "from:ann");
	assert.match((await ok("all", "createSavedSearch", { query: "from:ann" })).error, /already saved/, "an input error comes back as a value");
	const [listed] = await ok("all", "listSavedSearches", { tzOffset: 0 });
	assert.ok(listed.count > 0);
	assert.equal((await ok("all", "updateSavedSearch", saved.id, { name: "Ann" })).saved.name, "Ann");
	assert.equal(await ok("all", "deleteSavedSearch", saved.id), true);
	assert.deepEqual(await ok("all", "listSavedSearches"), []);
});
