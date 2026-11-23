import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { openSql } from "./helpers/sql.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// The D1 migrations on node:sqlite and on local D1.

const SCHEMA = D1_SCHEMA;
const SYSTEM_FOLDERS = ["inbox", "sent", "draft", "archive", "spam", "trash"];

/** Split migration SQL into statements, keeping CREATE TRIGGER … END; whole. */
function statements(text) {
	const out = [];
	let current = [];
	let inTrigger = false;
	for (const line of text.split("\n")) {
		if (!current.length && (!line.trim() || line.trim().startsWith("--"))) continue;
		current.push(line);
		if (/^\s*CREATE TRIGGER/i.test(line)) inTrigger = true;
		const done = inTrigger ? /^\s*END;\s*$/i.test(line) : /;\s*(--.*)?$/.test(line);
		if (done) {
			out.push(current.join("\n"));
			current = [];
			inTrigger = false;
		}
	}
	return out;
}

/** The same scenario against any `Sql`. */
async function scenario(sql) {
	const now = "2026-10-11T12:00:00.000Z";
	await sql.batch([
		{ sql: "INSERT INTO mailboxes (id, created_at) VALUES (?, ?), (?, ?)", params: ["a@example.com", now, "b@example.com", now] },
		...["a@example.com", "b@example.com"].flatMap((m) => [...SYSTEM_FOLDERS, "receipts"].map((f) => ({ sql: "INSERT INTO folders (mailbox_id, id, name, is_deletable) VALUES (?, ?, ?, ?)", params: [m, f, f, f === "receipts" ? 1 : 0] }))),
	]);
	const message = (id, mailbox, subject, body, folder = "inbox") => [
		{ sql: "INSERT INTO messages (id, email_id, mailbox_id, folder_id, conversation_id, date, subject, sender_addr, recipients) VALUES (?, ?, ?, ?, ?, ?, ?, 'ann@example.org', ?)", params: [id, `m${id}`, mailbox, folder, `t${id}`, now, subject, mailbox] },
		{ sql: "INSERT INTO messages_fts (rowid, subject, sender_addr, recipients, body_text) VALUES (?, ?, 'ann@example.org', ?, ?)", params: [id, subject, mailbox, body] },
		{ sql: "INSERT INTO messages_trigram (rowid, subject, sender_addr, recipients) VALUES (?, ?, 'ann@example.org', ?)", params: [id, subject, mailbox] },
	];
	await sql.batch([
		...message(1, "a@example.com", "Invoice INV-20417", "Your invoice for October"),
		...message(2, "a@example.com", "Lunch", "Lunch on Friday?", "receipts"),
		...message(3, "b@example.com", "Invoice INV-30001", "Another invoice"),
		{ sql: "INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES ('att1', 'm1', 'invoice.pdf', 'application/pdf', 10)" },
		{ sql: "INSERT INTO labels (id, name, color) VALUES ('l1', 'Receipts', 'green')" },
		{ sql: "INSERT INTO message_labels (message, label_id) VALUES (1, 'l1'), (3, 'l1')" },
	]);

	// Generated columns speak the index's language.
	assert.deepEqual(
		await sql.all("SELECT email_id, state, thread_key, unread, deleted FROM messages ORDER BY id"),
		[
			{ email_id: "m1", state: "inbox", thread_key: "a@example.com\u001ft1", unread: 1, deleted: 0 },
			{ email_id: "m2", state: "folder:receipts", thread_key: "a@example.com\u001ft2", unread: 1, deleted: 0 },
			{ email_id: "m3", state: "inbox", thread_key: "b@example.com\u001ft3", unread: 1, deleted: 0 },
		],
	);
	await sql.run("UPDATE messages SET read = 1 WHERE id = 1");
	assert.deepEqual(await sql.first("SELECT unread FROM messages WHERE id = 1"), { unread: 0 });

	const matches = async (q) => (await sql.all("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank", q)).map((r) => r.rowid);
	assert.deepEqual((await matches('"invoice"*')).sort(), [1, 3]);
	assert.deepEqual(await sql.all("SELECT rowid FROM messages_trigram WHERE messages_trigram MATCH ?", '"V-204"'), [{ rowid: 1 }]);
	assert.ok((await sql.all("SELECT term FROM messages_vocab WHERE term = 'invoice'")).length === 1);

	// A message must sit in one of its own mailbox's folders.
	await assert.rejects(sql.run("INSERT INTO messages (email_id, mailbox_id, folder_id, conversation_id, date) VALUES ('bad', 'a@example.com', 'nowhere', 't', ?)", now));

	// Deleting a message removes its search rows, attachments and labels.
	await sql.run("DELETE FROM messages WHERE email_id = 'm1'");
	assert.deepEqual(await matches('"invoice"*'), [3]);
	assert.deepEqual(await sql.all("SELECT rowid FROM messages_trigram WHERE messages_trigram MATCH ?", '"V-204"'), []);
	assert.deepEqual(await sql.all("SELECT id FROM attachments"), []);
	assert.deepEqual(await sql.all("SELECT message FROM message_labels"), [{ message: 3 }]);

	// Blocked senders are per address, one row per sender.
	await sql.run("INSERT INTO blocked_senders (mailbox_id, address, created_at) VALUES ('b@example.com', 'ann@example.org', ?)", now);
	await assert.rejects(sql.run("INSERT INTO blocked_senders (mailbox_id, address, created_at) VALUES ('b@example.com', 'ann@example.org', ?)", now));
	await assert.rejects(sql.run("INSERT INTO blocked_senders (mailbox_id, address, created_at) VALUES ('nobody@example.com', 'ann@example.org', ?)", now));

	// Deleting a mailbox cascades to its folders, messages, blocked senders and search rows.
	await sql.run("DELETE FROM mailboxes WHERE id = 'b@example.com'");
	assert.deepEqual(await sql.all("SELECT address FROM blocked_senders"), []);
	assert.deepEqual(await sql.all("SELECT email_id FROM messages"), [{ email_id: "m2" }]);
	assert.deepEqual(await matches('"invoice"*'), []);
	assert.deepEqual(await sql.all("SELECT count(*) AS n FROM folders WHERE mailbox_id = 'b@example.com'"), [{ n: 0 }]);
	assert.deepEqual(await sql.all("SELECT message FROM message_labels"), []);
}

test("the schema loads and behaves on node:sqlite", async () => {
	const { sql } = openSql();
	await sql.schema(SCHEMA);
	await scenario(sql);
});

let mf;

before(async () => {
	const bundle = await build({ entryPoints: ["tests/fixtures/sql-worker.ts"], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent" });
	mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", d1Databases: ["DB"] });
});

after(async () => {
	await mf?.dispose();
});

function d1Sql() {
	const call = async (op, ...args) => {
		const response = await mf.dispatchFetch("http://test/", { method: "POST", body: JSON.stringify({ op, args }) });
		const result = await response.json();
		if (result.error) throw new Error(result.error);
		return result.ok;
	};
	return {
		all: (text, ...params) => call("all", text, ...params),
		first: (text, ...params) => call("first", text, ...params),
		run: (text, ...params) => call("run", text, ...params),
		batch: (list) => call("batch", list),
	};
}

test("the schema loads and behaves on local D1", async () => {
	const sql = d1Sql();
	for (const statement of statements(SCHEMA)) await sql.run(statement);
	await sql.run("PRAGMA foreign_keys = ON");
	await scenario(sql);
});
