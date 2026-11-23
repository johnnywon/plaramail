import assert from "node:assert/strict";
import { statements } from "./schema.mjs";
import { D1_SCHEMA } from "./d1-schema.mjs";
import { openDb } from "./sqlite.mjs";

// Seeded mail on the D1 schema, for the search tests.

const SCHEMA = D1_SCHEMA;
export const NOW = Date.parse("2026-10-11T12:00:00Z");
export const A = "a@example.com";
export const B = "b@example.org";
const iso = (hours) => new Date(NOW - hours * 3_600_000).toISOString();

// One row per message. `conv` groups a conversation; results are compared by it.
export const MESSAGES = [
	{ id: 1, mailbox: A, folder: "inbox", conv: "t1", hours: 1, from: "ann@example.org", name: "Ann Lee", to: A, cc: "boss@example.net", subject: "Invoice October", body: "your invoice is attached, wire transfer details", read: 0, size: 50_000, attachment: ["invoice.pdf", "application/pdf"] },
	{ id: 2, mailbox: A, folder: "sent", conv: "t1", hours: 0.5, from: A, name: "", to: "ann@example.org", subject: "Re: Invoice October", body: "thanks, paid by wire", read: 1, size: 1000 },
	{ id: 3, mailbox: A, folder: "inbox", conv: "t2", hours: 30, from: "news@example.net", name: "News", to: A, subject: "Weekly digest", body: "this week in mail", read: 1, starred: 1, size: 1000, list: "<news.example.net>", unsubscribe: "https://example.net/u", link: true },
	{ id: 4, mailbox: B, folder: "inbox", conv: "t3", hours: 2, from: "ann@example.org", name: "Ann", to: B, subject: "Lunch", body: "lunch on friday", read: 0, size: 6 * 1024 * 1024, attachment: ["photo.jpg", "image/jpeg"] },
	{ id: 5, mailbox: B, folder: "receipts", conv: "t4", hours: 50 * 24, from: "billing@example.net", name: "Billing", to: B, subject: "Receipt 2041", body: "receipt for your invoice", read: 1, size: 1000, label: "receipts" },
	{ id: 6, mailbox: B, folder: "trash", conv: "t5", hours: 3, from: "spam@example.net", name: "", to: B, subject: "Old offer", body: "limited offer transfer", read: 1, size: 1000 },
	{ id: 7, mailbox: A, folder: "draft", conv: "t2", hours: 0.2, from: A, name: "", to: "news@example.net", subject: "Re: Weekly digest", body: "unsubscribe me", read: 1, size: 1000, scheduled: true },
];

export function d1Db() {
	const db = openDb();
	for (const s of statements(SCHEMA)) db.exec(s);
	db.exec(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, A);
	db.exec(`INSERT INTO mailboxes (id, created_at) VALUES (?, 'x')`, B);
	for (const m of [A, B]) {
		for (const f of ["inbox", "sent", "draft", "archive", "spam", "trash"]) db.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, ?, ?)`, m, f, f);
	}
	db.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, 'receipts', 'Receipts')`, B);
	db.exec(`INSERT INTO labels (id, name, color) VALUES ('receipts', 'Receipts', '#000')`);
	for (const m of MESSAGES) {
		const recipients = [m.to, m.cc].filter(Boolean).join(", ");
		db.exec(
			`INSERT INTO messages (id, email_id, mailbox_id, folder_id, conversation_id, date, subject, subject_norm, sender_addr, sender_name, sender_domain,
				recipient, cc, recipients, snippet, body, size, read, starred, has_attachment, list_id, unsubscribe, has_link)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			m.id, `e${m.id}`, m.mailbox, m.folder, m.conv, iso(m.hours), m.subject, m.subject.toLowerCase(), m.from, m.name, m.from.split("@")[1],
			m.to, m.cc ?? null, recipients, m.body, `<p>${m.body}</p>`, m.size, m.read, m.starred ?? 0, m.attachment ? 1 : 0, m.list ?? null, m.unsubscribe ?? null, m.link ? 1 : 0,
		);
		db.exec(
			`INSERT INTO messages_fts (rowid, subject, sender_name, sender_addr, recipients, body_text, attachment_names) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			m.id, m.subject, m.name, m.from, recipients, m.body, m.attachment?.[0] ?? "",
		);
		if (m.attachment) db.exec(`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES (?, ?, ?, ?, 10)`, `a${m.id}`, `e${m.id}`, ...m.attachment);
		if (m.label) db.exec(`INSERT INTO message_labels (message, label_id) VALUES (?, ?)`, m.id, m.label);
		if (m.scheduled) db.exec(`INSERT INTO scheduled_sends (email_id, mailbox_id, send_at, payload) VALUES (?, ?, ?, '{}')`, `e${m.id}`, m.mailbox, iso(-1));
	}
	return db;
}

export const DB = d1Db();

/** Run SQL, refusing any statement with more than one MATCH. */
export function guarded(exec) {
	return (sql, ...args) => {
		const matches = sql.match(/\bMATCH\b/g)?.length ?? 0;
		assert.ok(matches <= 1, `a statement with ${matches} MATCHes:\n${sql}`);
		return exec(sql, ...args);
	};
}

