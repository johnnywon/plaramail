import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";
import { statements } from "./helpers/schema.mjs";
import { openSql } from "./helpers/sql.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Attachment text on D1 (S6): which files count, the queue that new mail and
// migration 0003 fill, the cron batch with a fake R2 and toMarkdown, and
// search and snippets over the text afterwards.

const kind = await loadTs("workers/lib/attachment-kind.ts");
const at = await loadTs("workers/store/d1/attachment-text.ts");
const rows = await loadTs("workers/store/d1/rows.ts");
const idx = await loadTs("workers/lib/mail-index-sql.ts");
const eng = await loadTs("workers/lib/search-engine-sql.ts");

const A = "a@example.com";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const MB = 1024 * 1024;

const SAMPLES = [
	["report.pdf", "application/pdf", 1000, "attachment", "markdown"],
	["scan", "application/pdf; name=scan", 1000, null, "markdown"],
	["Budget.XLSX", "application/octet-stream", 1000, "attachment", "markdown"],
	["old.xls", "application/vnd.ms-excel", 1000, "attachment", "markdown"],
	["letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1000, "attachment", "markdown"],
	["notes.odt", "application/vnd.oasis.opendocument.text", 1000, "attachment", "markdown"],
	["notes.txt", "text/plain", 1000, "attachment", "plain"],
	["data.csv", "application/octet-stream", 1000, "attachment", "plain"],
	["readme.md", "text/markdown", 1000, "attachment", "plain"],
	["photo.jpg", "image/jpeg", 1000, "attachment", null],
	["logo.png", "image/png", 1000, "inline", null],
	["inline.pdf", "application/pdf", 1000, "inline", null],
	["huge.pdf", "application/pdf", 10 * MB + 1, "attachment", null],
	["edge.pdf", "application/pdf", 10 * MB, "attachment", "markdown"],
	["archive.zip", "application/zip", 1000, "attachment", null],
	["page.html", "text/html", 1000, "attachment", null],
	["pdf.exe", "application/x-msdownload", 1000, "attachment", null],
];

test("which attachments are searched", () => {
	for (const [filename, mimetype, size, disposition, expected] of SAMPLES) {
		assert.equal(kind.textKind({ filename, mimetype, size, disposition }), expected, filename);
	}
	assert.equal(kind.markdownName({ filename: "scan", mimetype: "application/pdf", size: 1 }), "scan.pdf");
	assert.equal(kind.markdownName({ filename: "Budget.XLSX", mimetype: "application/octet-stream", size: 1 }), "Budget.XLSX");
});

async function store(messages) {
	const { db, sql } = openSql();
	for (const s of statements(D1_SCHEMA)) await sql.run(s);
	await sql.run(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
	for (const f of ["inbox", "sent", "draft", "archive", "spam", "trash"]) await sql.run(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, ?, ?)`, A, f, f);
	for (const m of messages) {
		const email = { id: m.id, subject: m.subject, sender: "Ann <ann@example.org>", recipient: A, date: new Date(NOW - 86_400_000).toISOString(), body: m.body ?? "<p>See attached.</p>", thread_id: m.id };
		const attachments = (m.files ?? []).map((f) => ({ email_id: m.id, disposition: "attachment", size: 1000, mimetype: "application/pdf", ...f }));
		await sql.batch(rows.insertStatements(A, "inbox", email, attachments, m.id, { bodyInR2: false }));
	}
	return { db, sql };
}

test("migration 0003 queues older attachments by the same rule", async () => {
	const { sql } = openSql();
	const files = readdirMigrations();
	for (const s of statements(files.filter((f) => !f.name.startsWith("0003")).map((f) => f.text).join("\n"))) await sql.run(s);
	await sql.run(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
	await sql.run(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, 'inbox', 'inbox')`, A);
	await sql.run(`INSERT INTO messages (email_id, mailbox_id, folder_id, conversation_id, date) VALUES ('e1', ?, 'inbox', 'e1', 'd')`, A);
	for (const [i, [filename, mimetype, size, disposition]] of SAMPLES.entries()) {
		await sql.run(`INSERT INTO attachments (id, email_id, filename, mimetype, size, disposition) VALUES (?, 'e1', ?, ?, ?, ?)`, `a${i}`, filename, mimetype, size, disposition);
	}
	for (const s of statements(files.find((f) => f.name.startsWith("0003")).text)) await sql.run(s);
	const queued = new Set((await sql.all(`SELECT attachment_id FROM attachment_text WHERE state = 'pending'`)).map((r) => r.attachment_id));
	for (const [i, [filename, , , , expected]] of SAMPLES.entries()) assert.equal(queued.has(`a${i}`), expected !== null, filename);
});

function readdirMigrations() {
	return readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().map((name) => ({ name, text: readFileSync(`migrations/${name}`, "utf8") }));
}

test("new mail queues the files it can search", async () => {
	const { sql } = await store([{ id: "m1", subject: "Docs", files: [{ id: "f1", filename: "lease.pdf" }, { id: "f2", filename: "photo.jpg", mimetype: "image/jpeg" }, { id: "f3", filename: "logo.pdf", disposition: "inline" }] }]);
	assert.deepEqual(await sql.all(`SELECT attachment_id, state, text FROM attachment_text`), [{ attachment_id: "f1", state: "pending", text: null }]);
	await sql.run(`DELETE FROM messages WHERE email_id = 'm1'`);
	assert.equal((await sql.all(`SELECT * FROM attachment_text`)).length, 0, "the text leaves with its message");
});

/** A fake R2 and toMarkdown. */
function sources(files, convert) {
	const calls = [];
	return {
		calls,
		bucket: {
			async get(key) {
				if (!(key in files)) return null;
				const bytes = new TextEncoder().encode(files[key]);
				return { arrayBuffer: async () => bytes.buffer, text: async () => files[key] };
			},
		},
		async toMarkdown(name, blob) {
			calls.push(name);
			return convert(name, await blob.text());
		},
	};
}

const search = (sql, q) => idx.runAsync(eng.d1MailQuery(idx.emptyFilter({ view: "anywhere", q }), { now: NOW }), (s, ...p) => sql.all(s, ...p));
const ids = (page) => page.conversations.map((c) => c.email_id);

test("the cron converts queued files and the text becomes searchable", async () => {
	const { sql } = await store([
		{ id: "m1", subject: "Lease", body: "<p>Signed copy attached.</p>", files: [{ id: "f1", filename: "lease.pdf" }, { id: "f2", filename: "notes.txt", mimetype: "text/plain" }] },
		{ id: "m2", subject: "Broken", files: [{ id: "f3", filename: "broken.pdf" }] },
		{ id: "m3", subject: "Missing", files: [{ id: "f4", filename: "gone.pdf" }] },
	]);
	const src = sources(
		{
			"attachments/m1/f1/lease.pdf": "pdf bytes",
			"attachments/m1/f2/notes.txt": "Parking   space\r\n\r\n\r\nnumber 42 is   yours",
			"attachments/m2/f3/broken.pdf": "bad bytes",
		},
		(name) => (name === "broken.pdf" ? { error: "unsupported" } : { text: "# Lease\n\nThe tenant pays a security deposit of two months." }),
	);
	assert.deepEqual(ids(await search(sql, "deposit")), []);
	const counts = await at.extractAttachmentText(sql, src, NOW, 10);
	assert.deepEqual(counts, { done: 2, skipped: 1, failed: 1 });
	assert.deepEqual(src.calls.sort(), ["broken.pdf", "lease.pdf"], "text files don't go to toMarkdown");
	const state = Object.fromEntries((await sql.all(`SELECT attachment_id, state, text FROM attachment_text`)).map((r) => [r.attachment_id, [r.state, r.text]]));
	assert.deepEqual(state, {
		f1: ["done", "# Lease\n\nThe tenant pays a security deposit of two months."],
		f2: ["done", "Parking space\n\nnumber 42 is yours"],
		f3: ["failed", null],
		f4: ["skipped", null],
	});

	assert.deepEqual(ids(await search(sql, "deposit")), ["m1"]);
	assert.deepEqual(ids(await search(sql, "parking")), ["m1"]);
	assert.deepEqual(ids(await search(sql, "signed")), ["m1"], "the body is still indexed");
	assert.deepEqual(ids(await search(sql, "lease.pdf")), ["m1"], "and the file names");
	assert.deepEqual(ids(await search(sql, "subject:lease")), ["m1"]);
	const [hit] = (await search(sql, "deposit")).conversations;
	assert.match(hit.snippet_html, /^lease\.pdf: .*<mark>deposit<\/mark>/, "the snippet comes from the file");
	const [body] = (await search(sql, "signed")).conversations;
	assert.match(body.snippet_html, /<mark>Signed<\/mark>/);

	assert.deepEqual(await at.extractAttachmentText(sql, src, NOW, 10), { done: 0, skipped: 0, failed: 0 }, "nothing left");
});

test("a batch takes the newest first, and a stuck claim counts as failed", async () => {
	const { sql } = await store([{ id: "m1", subject: "Files", files: [1, 2, 3].map((n) => ({ id: `f${n}`, filename: `f${n}.txt`, mimetype: "text/plain" })) }]);
	await sql.run(`UPDATE attachment_text SET updated_at = CASE attachment_id WHEN 'f1' THEN '2026-01-01' WHEN 'f2' THEN '2026-02-01' ELSE '2026-03-01' END`);
	const src = sources({ "attachments/m1/f1/f1.txt": "one", "attachments/m1/f2/f2.txt": "two", "attachments/m1/f3/f3.txt": "three" }, () => ({ error: "x" }));
	assert.equal((await at.extractAttachmentText(sql, src, NOW, 2)).done, 2);
	assert.deepEqual((await sql.all(`SELECT attachment_id FROM attachment_text WHERE state = 'pending'`)).map((r) => r.attachment_id), ["f1"]);

	await sql.run(`UPDATE attachment_text SET state = 'working', updated_at = ? WHERE attachment_id = 'f1'`, new Date(NOW - at.CLAIM_STALE_MS - 1).toISOString());
	assert.equal((await at.extractAttachmentText(sql, src, NOW)).done, 0);
	assert.equal((await sql.first(`SELECT state FROM attachment_text WHERE attachment_id = 'f1'`)).state, "failed");
});

test("a thrown conversion fails that file and the batch goes on", async () => {
	const { sql } = await store([{ id: "m1", subject: "Two", files: [{ id: "f1", filename: "a.pdf" }, { id: "f2", filename: "b.pdf" }] }]);
	const src = sources({ "attachments/m1/f1/a.pdf": "x", "attachments/m1/f2/b.pdf": "y" }, (name) => {
		if (name === "a.pdf") throw new Error("AI down");
		return { text: "quarterly figures" };
	});
	assert.deepEqual(await at.extractAttachmentText(sql, src, NOW), { done: 1, skipped: 0, failed: 1 });
	assert.deepEqual(ids(await search(sql, "quarterly")), ["m1"]);
});

test("toMarkdown's framing isn't kept", () => {
	const pdf = "# tenancy.pdf\n## Metadata\n- PDFFormatVersion=1.4\n- IsLinearized=false\n\n## Contents\n### Page 1\nThe deposit is held.\n### Page 2\nSigned.";
	assert.equal(at.stripFraming(pdf, "tenancy.pdf"), "The deposit is held.\nSigned.");
	const sheet = "# budget.xlsx\n## Sheet1\n| a | b |\n|---|---|\n| 1 | 2 |";
	assert.equal(at.stripFraming(sheet, "budget.xlsx"), "## Sheet1\n| a | b |\n|---|---|\n| 1 | 2 |", "sheet names stay");
	assert.equal(at.stripFraming("# Lease\n\nText", "lease.pdf"), "# Lease\n\nText", "a heading in the document stays");
});

test("control characters in converted text become spaces", () => {
	assert.equal(at.tidy("Invoice PCAY\u00000002\nEIN 42\u00005227\u0007\t x"), "Invoice PCAY 0002\nEIN 42 5227 x");
});

test("a code inside attachment text is found as a substring", async () => {
	const { sql } = await store([
		{ id: "m1", subject: "Receipt", files: [{ id: "f1", filename: "r.pdf" }] },
		{ id: "m2", subject: "Other", body: "<p>nothing here</p>" },
	]);
	const src = sources({ "attachments/m1/f1/r.pdf": "x" }, () => ({ text: "Invoice number PCAYUMC40002, EIN 425227248" }));
	assert.deepEqual(ids(await search(sql, "UMC4")), [], "not before conversion");
	await at.extractAttachmentText(sql, src, NOW);
	assert.deepEqual(ids(await search(sql, "UMC4")), ["m1"], "inside PCAYUMC40002");
	assert.match((await search(sql, "UMC4")).conversations[0].snippet_html, /^r\.pdf: Invoice number PCAY<mark>UMC4<\/mark>0002/, "the snippet marks it inside the file's text");
	assert.deepEqual(ids(await search(sql, "5227248")), ["m1"]);
	assert.deepEqual(ids(await search(sql, "zzq")), []);
	await sql.run(`DELETE FROM messages WHERE email_id = 'm1'`);
	assert.equal((await sql.all(`SELECT rowid FROM attachment_trigram WHERE attachment_trigram MATCH '"UMC4"'`)).length, 0, "the row leaves with its message");
});

test("migration 0004 indexes text converted before it", async () => {
	const { sql } = openSql();
	const files = readdirMigrations();
	for (const s of statements(files.filter((f) => f.name < "0004").map((f) => f.text).join("\n"))) await sql.run(s);
	await sql.run(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
	await sql.run(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, 'inbox', 'inbox')`, A);
	await sql.run(`INSERT INTO messages (email_id, mailbox_id, folder_id, conversation_id, date) VALUES ('e1', ?, 'inbox', 'e1', 'd')`, A);
	for (const [id, text, state] of [["a1", "order XK7731Q", "done"], ["a2", "ref 99ZT", "done"], ["a3", null, "failed"]]) {
		await sql.run(`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES (?, 'e1', 'f.pdf', 'application/pdf', 1)`, id);
		await sql.run(`INSERT INTO attachment_text (attachment_id, state, text, updated_at) VALUES (?, ?, ?, 'x')`, id, state, text);
	}
	for (const s of statements(files.find((f) => f.name.startsWith("0004")).text)) await sql.run(s);
	const id = (await sql.first(`SELECT id FROM messages WHERE email_id = 'e1'`)).id;
	for (const q of ['"7731"', '"9ZT"']) assert.deepEqual(await sql.all(`SELECT rowid FROM attachment_trigram WHERE attachment_trigram MATCH ?`, q), [{ rowid: id }], q);
});

test("text is capped at 64 KB on a character boundary", () => {
	assert.equal(at.capText("abc", 10), "abc");
	assert.equal(at.capText("aé", 2), "a", "a split é is dropped");
	assert.equal(new TextEncoder().encode(at.capText("é".repeat(40_000))).length, at.ATTACHMENT_TEXT_MAX);
});

test("a message deleted before its row is rewritten isn't put back in the index", async () => {
	const { sql } = await store([{ id: "m1", subject: "Gone", files: [{ id: "f1", filename: "a.txt", mimetype: "text/plain" }] }]);
	const before = (await sql.first(`SELECT id FROM messages WHERE email_id = 'm1'`)).id;
	await sql.run(`DELETE FROM messages WHERE email_id = 'm1'`);
	assert.equal(await at.reindexMessage(sql, sources({}, () => ({ text: "" })).bucket, "m1"), false);
	await sql.batch([rows.ftsInsert("m1", { subject: "x", senderName: "", senderAddr: "", recipients: "", bodyText: "", attachmentNames: "" })]);
	assert.equal((await sql.all(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'x' AND rowid = ?`, before)).length, 0);
});

test("a body in R2 is read back when the row is rewritten", async () => {
	const { sql } = openSql();
	for (const s of statements(D1_SCHEMA)) await sql.run(s);
	await sql.run(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
	await sql.run(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, 'inbox', 'inbox')`, A);
	const email = { id: "m1", subject: "Big", sender: "ann@example.org", recipient: A, date: new Date(NOW).toISOString(), body: "<p>harbour</p>", thread_id: "m1" };
	await sql.batch(rows.insertStatements(A, "inbox", email, [{ id: "f1", email_id: "m1", filename: "a.txt", mimetype: "text/plain", size: 5 }], "m1", { bodyInR2: true }));
	const src = sources({ "bodies/m1.html": "<p>harbour</p>", "attachments/m1/f1/a.txt": "lighthouse" }, () => ({ error: "x" }));
	await at.extractAttachmentText(sql, src, NOW);
	assert.deepEqual(ids(await search(sql, "harbour")), ["m1"]);
	assert.deepEqual(ids(await search(sql, "lighthouse")), ["m1"]);
});
