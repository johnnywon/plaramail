import { D1_SCHEMA } from "./d1-schema.mjs";
import { statements } from "./schema.mjs";
import { openDb } from "./sqlite.mjs";

// Rows straight into the D1 schema, for tests of the list, facet, bulk and
// label SQL. Run the query generators over `exec` with runSync.

const SYSTEM = ["inbox", "sent", "draft", "archive", "spam", "trash"];

/** node:sqlite with every D1 migration applied. `exec` refuses what D1 refuses. */
export function d1Db() {
	const handle = openDb();
	for (const s of statements(D1_SCHEMA)) handle.exec(s);
	return handle;
}

function ensureFolder(exec, mailbox, folder) {
	exec(`INSERT OR IGNORE INTO mailboxes (id, created_at) VALUES (?, 'x')`, mailbox);
	for (const f of SYSTEM) exec(`INSERT OR IGNORE INTO folders (mailbox_id, id, name) VALUES (?, ?, ?)`, mailbox, f, f);
	exec(`INSERT OR IGNORE INTO folders (mailbox_id, id, name) VALUES (?, ?, ?)`, mailbox, folder, folder);
}

/** A message with sensible defaults. `state` is inbox, sent, draft, archive, spam, trash or folder:<id>. */
export function row(email_id, fields = {}) {
	return {
		email_id, conversation_id: email_id, message_id: `${email_id}@mail`, state: "inbox",
		date: "2026-10-09T10:00:00.000Z", sender_addr: "ann@example.org", sender_name: "Ann", sender_domain: "example.org",
		recipients: "me@example.com", subject: "Hello", subject_norm: "hello", snippet: "", unread: true, starred: false,
		has_attachment: false, list_id: null, unsubscribe: null, body_text: "", labels: [], ...fields,
	};
}

/** Store messages for one mailbox, with their word index rows and labels. Labels must exist. */
export function addMessages(exec, mailbox, rows) {
	for (const r of rows) {
		const folder = r.state.startsWith("folder:") ? r.state.slice("folder:".length) : r.state;
		ensureFolder(exec, mailbox, folder);
		const [{ id }] = exec(
			`INSERT INTO messages (email_id, mailbox_id, folder_id, conversation_id, message_id, date, subject, subject_norm,
				sender_addr, sender_name, sender_domain, recipient, recipients, snippet, body, read, starred, has_attachment, list_id, unsubscribe)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
			r.email_id, mailbox, folder, r.conversation_id, r.message_id, r.date, r.subject, r.subject_norm,
			r.sender_addr, r.sender_name, r.sender_domain, r.recipients, r.recipients, r.snippet, `<p>${r.body_text}</p>`,
			r.unread ? 0 : 1, r.starred ? 1 : 0, r.has_attachment ? 1 : 0, r.list_id, r.unsubscribe,
		);
		exec(
			`INSERT INTO messages_fts (rowid, subject, sender_name, sender_addr, recipients, body_text, attachment_names) VALUES (?, ?, ?, ?, ?, ?, '')`,
			id, r.subject, r.sender_name, r.sender_addr, r.recipients, r.body_text,
		);
		for (const label of r.labels) exec(`INSERT INTO message_labels (message, label_id) VALUES (?, ?)`, id, label);
	}
}
