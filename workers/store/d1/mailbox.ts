// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * One address's mail on D1. Every query is scoped to the mailbox.
 */
import type { DraftNotes } from "../../../shared/draft-notes";
import { Folders } from "../../../shared/folders";
import { deleteAttachmentFiles } from "../../lib/attachments";
import type { ScheduleMode, ScheduledPayload, ScheduledRow } from "../../lib/scheduled-send";
import type { SendEmailRequest } from "../../lib/send";
import { budgetError, type SendActor } from "../../lib/send-budget";
import { DEFAULT_AGENT_LIMITS, SEND_LIMITS } from "../../../shared/send-limits";
import { SEND_KEY_PENDING_STALE_MS, SEND_KEY_TTL_MS, type SendKeyClaim } from "../../lib/send-keys";
import {
	MAX_REFERENCED_IDS,
	SUBJECT_JOIN_WINDOW_MS,
	type SubjectRow,
	hasReplyPrefix,
	normalizeThreadSubject,
	pickReferencedThread,
	pickSubjectThread,
} from "../../lib/threading";
import type { Sql } from "../sql";
import {
	type AttachmentInput,
	BODY_INLINE_MAX,
	EMAIL_COLUMNS,
	type EmailInput,
	LIST_COLUMNS,
	SYSTEM_FOLDERS,
	bodyKey,
	conversationFor,
	conversationSql,
	insertStatements,
	normalizeSubject,
	toAttachmentRow,
	toEmailRow,
	toListRow,
	type AttachmentRow,
} from "./rows";
import { ensureMailboxStatements } from "./registry";

/** Folders whose mail may be hard-deleted. Everywhere else, Delete moves mail to Trash. */
const HARD_DELETE_FOLDERS: readonly string[] = [Folders.TRASH, Folders.DRAFT];
const SORT_COLUMNS: Record<string, string> = {
	id: "m.email_id", subject: "m.subject", sender: "m.sender_addr", recipient: "m.recipient",
	date: "m.date", read: "m.read", starred: "m.starred",
};


export class D1Mailbox {
	readonly #id: string;

	constructor(private readonly sql: Sql, private readonly bucket: R2Bucket, mailboxId: string) {
		this.#id = mailboxId.toLowerCase();
	}

	async #folderId(folder: string): Promise<string | null> {
		const row = await this.sql.first(`SELECT id FROM folders WHERE mailbox_id = ? AND (id = ? OR name = ?) LIMIT 1`, this.#id, folder, folder);
		return row ? String(row.id) : null;
	}

	async #body(row: Record<string, unknown>): Promise<string | null> {
		if (!row.body_key) return (row.body as string | null) ?? null;
		const object = await this.bucket.get(String(row.body_key));
		return object ? await object.text() : null;
	}

	async #attachments(emailIds: string[]) {
		if (emailIds.length === 0) return new Map<string, AttachmentRow[]>();
		const rows = await this.sql.all(
			`SELECT id, email_id, filename, mimetype, size, content_id, disposition FROM attachments WHERE email_id IN (SELECT value FROM json_each(?)) ORDER BY id`,
			JSON.stringify(emailIds),
		);
		const byEmail = new Map<string, AttachmentRow[]>();
		for (const row of rows.map(toAttachmentRow)) byEmail.set(row.email_id, [...(byEmail.get(row.email_id) ?? []), row]);
		return byEmail;
	}

	// ── Messages and threads ───────────────────────────────────────

	async getEmails(options: { folder?: string; thread_id?: string; page?: number; limit?: number; sortColumn?: string; sortDirection?: "ASC" | "DESC" } = {}) {
		const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
		const offset = ((options.page ?? 1) - 1) * limit;
		const where = [`m.mailbox_id = ?`];
		const params: unknown[] = [this.#id];
		if (options.folder) {
			where.push(`m.folder_id = (SELECT id FROM folders WHERE mailbox_id = ? AND (name = ? OR id = ?) LIMIT 1)`);
			params.push(this.#id, options.folder, options.folder);
		}
		if (options.thread_id) {
			where.push(`m.thread_id = ?`);
			params.push(options.thread_id);
		}
		const order = SORT_COLUMNS[options.sortColumn ?? "date"] ?? SORT_COLUMNS.date;
		const rows = await this.sql.all(
			`SELECT ${LIST_COLUMNS} FROM messages m WHERE ${where.join(" AND ")}
			ORDER BY ${order} ${options.sortDirection === "ASC" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`,
			...params, limit, offset,
		);
		return rows.map(toListRow);
	}

	async getEmail(id: string) {
		const row = await this.sql.first(`SELECT ${EMAIL_COLUMNS} FROM messages m WHERE m.mailbox_id = ? AND m.email_id = ?`, this.#id, id);
		if (!row) return null;
		const attachments = (await this.#attachments([id])).get(id) ?? [];
		const email = { ...toEmailRow(row, await this.#body(row)), attachments };
		if (email.folder_id !== Folders.DRAFT) return email;
		const notes = await this.getDraftNotes(id);
		return notes ? { ...email, draft_notes: notes } : email;
	}

	// ── Draft notes ────────────────────────────────────────────────

	/** How an agent made this draft. Null for drafts a person wrote. */
	async getDraftNotes(emailId: string): Promise<DraftNotes | null> {
		return (await this.#draftNotes([emailId])).get(emailId) ?? null;
	}

	async #draftNotes(emailIds: string[]): Promise<Map<string, DraftNotes>> {
		const notes = new Map<string, DraftNotes>();
		if (emailIds.length === 0) return notes;
		const rows = await this.sql.all(
			`SELECT n.email_id, n.origin, n.agent, n.instructions FROM draft_notes n JOIN messages m ON m.email_id = n.email_id
			WHERE m.mailbox_id = ? AND n.email_id IN (SELECT value FROM json_each(?))`,
			this.#id, JSON.stringify(emailIds),
		);
		for (const row of rows) {
			let instructions: string[] = [];
			try {
				const parsed = JSON.parse(String(row.instructions ?? "[]"));
				if (Array.isArray(parsed)) instructions = parsed.filter((v): v is string => typeof v === "string");
			} catch { /* keep none */ }
			notes.set(String(row.email_id), { origin: String(row.origin) as DraftNotes["origin"], agent: row.agent == null ? null : String(row.agent), instructions });
		}
		return notes;
	}

	async setDraftNotes(emailId: string, notes: DraftNotes): Promise<void> {
		await this.sql.run(
			`INSERT OR REPLACE INTO draft_notes (email_id, origin, agent, instructions, created_at)
			SELECT email_id, ?, ?, ?, ? FROM messages WHERE mailbox_id = ? AND email_id = ?`,
			notes.origin, notes.agent ?? null, JSON.stringify(notes.instructions), new Date().toISOString(), this.#id, emailId,
		);
	}

	async hasInboundMessageId(messageId: string): Promise<boolean> {
		return !!(await this.sql.first(
			`SELECT 1 FROM messages WHERE mailbox_id = ? AND message_id = ? AND folder_id NOT IN (?, ?) LIMIT 1`,
			this.#id, messageId, Folders.SENT, Folders.DRAFT,
		));
	}

	async getThreadEmails(threadId: string) {
		const rows = await this.sql.all(
			`SELECT ${EMAIL_COLUMNS} FROM messages m WHERE m.mailbox_id = ? AND m.thread_id = ? ORDER BY m.date ASC`,
			this.#id, threadId,
		);
		const attachments = await this.#attachments(rows.map((r) => String(r.id)));
		const notes = await this.#draftNotes(rows.filter((r) => r.folder_id === Folders.DRAFT).map((r) => String(r.id)));
		return Promise.all(rows.map(async (row) => {
			const email = { ...toEmailRow(row, await this.#body(row)), attachments: attachments.get(String(row.id)) ?? [] };
			const note = notes.get(String(row.id));
			return note ? { ...email, draft_notes: note } : email;
		}));
	}

	async createEmail(folder: string, email: EmailInput, attachments: AttachmentInput[]) {
		await this.sql.batch(ensureMailboxStatements(this.#id));
		const folderId = await this.#folderId(folder);
		if (!folderId) {
			throw new Error(`createEmail: folder "${folder}" not found. Ensure the folder exists before inserting an email.`);
		}
		const subjectNorm = normalizeSubject(email.subject || "");
		const same = folderId === Folders.DRAFT || email.thread_id || !subjectNorm
			? null
			: await this.sql.first(conversationSql(), this.#id, subjectNorm);
		const conversationId = conversationFor(email, folderId, subjectNorm, (same?.id as string | null | undefined) ?? null);
		const bodyInR2 = new TextEncoder().encode(email.body ?? "").length > BODY_INLINE_MAX;
		if (bodyInR2) await this.bucket.put(bodyKey(email.id), email.body, { httpMetadata: { contentType: "text/html" } });
		await this.sql.batch(insertStatements(this.#id, folderId, email, attachments, conversationId, { bodyInR2 }));
	}

	async updateEmail(id: string, { read, starred }: { read?: boolean; starred?: boolean }) {
		const sets: string[] = [];
		const params: unknown[] = [];
		if (read !== undefined) { sets.push("read = ?"); params.push(read ? 1 : 0); }
		if (starred !== undefined) { sets.push("starred = ?"); params.push(starred ? 1 : 0); }
		if (sets.length > 0) await this.sql.run(`UPDATE messages SET ${sets.join(", ")} WHERE mailbox_id = ? AND email_id = ?`, ...params, this.#id, id);
		return this.getEmail(id);
	}

	async markThreadRead(threadId: string) {
		const ids = (await this.sql.all(
			`UPDATE messages SET read = 1 WHERE mailbox_id = ? AND thread_id = ? AND read = 0 RETURNING email_id`,
			this.#id, threadId,
		)).map((r) => String(r.email_id));
		return { threadId, markedRead: true, ids };
	}

	/** Permanently delete an email. Only mail in Trash or Drafts can be deleted. */
	async deleteEmail(id: string) {
		const row = await this.sql.first(`SELECT folder_id, body_key FROM messages WHERE mailbox_id = ? AND email_id = ?`, this.#id, id);
		if (!row) return null;
		if (!HARD_DELETE_FOLDERS.includes(String(row.folder_id))) throw new Error("Only mail in Trash or Drafts can be deleted");
		const [attachments] = await this.sql.batch([
			{ sql: `SELECT id, filename FROM attachments WHERE email_id = ? ORDER BY id`, params: [id] },
			{ sql: `DELETE FROM messages WHERE mailbox_id = ? AND email_id = ?`, params: [this.#id, id] },
		]);
		if (row.body_key) await this.bucket.delete(String(row.body_key)).catch(() => {});
		return attachments.map((a) => ({ id: String(a.id), filename: String(a.filename) }));
	}

	async trashOrDelete(id: string): Promise<
		| { action: "trashed"; attachments: [] }
		| { action: "deleted"; attachments: { id: string; filename: string }[] }
		| null
	> {
		const row = await this.sql.first(`SELECT folder_id FROM messages WHERE mailbox_id = ? AND email_id = ?`, this.#id, id);
		if (!row) return null;
		if (HARD_DELETE_FOLDERS.includes(String(row.folder_id))) {
			const attachments = await this.deleteEmail(id);
			return attachments === null ? null : { action: "deleted", attachments };
		}
		await this.moveEmail(id, Folders.TRASH);
		return { action: "trashed", attachments: [] };
	}

	async moveEmail(id: string, folderId: string) {
		const folder = await this.sql.first(
			`SELECT f.id, m.folders_imported FROM folders f JOIN mailboxes m ON m.id = f.mailbox_id WHERE f.mailbox_id = ? AND f.id = ?`,
			this.#id, folderId,
		);
		if (!folder) return false;
		if (!SYSTEM_FOLDERS.includes(folderId) && folder.folders_imported) return false;
		await this.sql.run(`UPDATE messages SET folder_id = ? WHERE mailbox_id = ? AND email_id = ?`, folderId, this.#id, id);
		return true;
	}

	async getAttachment(id: string): Promise<AttachmentRow | null> {
		const row = await this.sql.first(
			`SELECT a.id, a.email_id, a.filename, a.mimetype, a.size, a.content_id, a.disposition FROM attachments a
			JOIN messages m ON m.email_id = a.email_id WHERE a.id = ? AND m.mailbox_id = ?`,
			id, this.#id,
		);
		return row ? toAttachmentRow(row) : null;
	}

	/** The thread of the nearest message in this mailbox whose Message-ID is one of `ids` (workers/lib/threading.ts). */
	async findThreadByMessageIds(ids: string[]): Promise<string | null> {
		const wanted = ids.slice(0, MAX_REFERENCED_IDS);
		if (wanted.length === 0) return null;
		const rows = await this.sql.all(
			`SELECT message_id, thread_id FROM messages
			WHERE mailbox_id = ? AND thread_id IS NOT NULL AND message_id IN (${wanted.map(() => "?").join(", ")})`,
			this.#id, ...wanted,
		);
		return pickReferencedThread(wanted, rows);
	}

	/** A recent thread a header-less reply belongs to (workers/lib/threading.ts). */
	async findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null> {
		if (!hasReplyPrefix(subject) || !normalizeThreadSubject(subject) || !senderAddress) return null;
		const rows = await this.sql.all(
			`SELECT thread_id, subject, LOWER(sender_addr) AS sender, LOWER(recipient) AS recipient, folder_id, date
			FROM messages
			WHERE mailbox_id = ? AND thread_id IS NOT NULL AND folder_id != 'draft' AND date >= ?
			ORDER BY date DESC LIMIT 500`,
			this.#id, new Date(Date.now() - SUBJECT_JOIN_WINDOW_MS).toISOString(),
		);
		return pickSubjectThread(rows as unknown as SubjectRow[], subject, senderAddress);
	}

	// ── Blocked senders ────────────────────────────────────────────

	/** Whether new mail from `address` goes straight to Trash. */
	async isBlockedSender(address: string): Promise<boolean> {
		const addr = address.trim().toLowerCase();
		if (!addr) return false;
		return !!(await this.sql.first(`SELECT 1 AS ok FROM blocked_senders WHERE mailbox_id = ? AND address = ?`, this.#id, addr));
	}

	/** Block a sender. Blocking one already blocked keeps the first date. */
	async blockSender(address: string): Promise<{ address: string; createdAt: string }> {
		const addr = address.trim().toLowerCase();
		await this.sql.batch([
			...ensureMailboxStatements(this.#id),
			{ sql: `INSERT OR IGNORE INTO blocked_senders (mailbox_id, address, created_at) VALUES (?, ?, ?)`, params: [this.#id, addr, new Date().toISOString()] },
		]);
		const row = await this.sql.first(`SELECT created_at FROM blocked_senders WHERE mailbox_id = ? AND address = ?`, this.#id, addr);
		return { address: addr, createdAt: String(row?.created_at ?? "") };
	}

	/** False when the sender was not blocked. */
	async unblockSender(address: string): Promise<boolean> {
		const rows = await this.sql.all(
			`DELETE FROM blocked_senders WHERE mailbox_id = ? AND address = ? RETURNING address`,
			this.#id, address.trim().toLowerCase(),
		);
		return rows.length > 0;
	}

	async listBlockedSenders(): Promise<{ address: string; createdAt: string }[]> {
		return (await this.sql.all(`SELECT address, created_at FROM blocked_senders WHERE mailbox_id = ? ORDER BY address`, this.#id))
			.map((r) => ({ address: String(r.address), createdAt: String(r.created_at) }));
	}

	// ── Folder import ──────────────────────────────────────────────

	async folderImportCounts() {
		const [folders, mailbox] = await this.sql.batch([
			{
				sql: `SELECT f.id AS folderId, f.name AS name, COUNT(m.id) AS count FROM folders f
					LEFT JOIN messages m ON m.mailbox_id = f.mailbox_id AND m.folder_id = f.id
					WHERE f.mailbox_id = ? AND f.id NOT IN (SELECT value FROM json_each(?))
					GROUP BY f.id, f.name ORDER BY f.id`,
				params: [this.#id, JSON.stringify(SYSTEM_FOLDERS)],
			},
			{ sql: `SELECT folders_imported FROM mailboxes WHERE id = ?`, params: [this.#id] },
		]);
		return {
			folders: folders.map((r) => ({ folderId: String(r.folderId), name: String(r.name), count: Number(r.count) })),
			imported: !!mailbox[0]?.folders_imported,
		};
	}

	async folderEmailIds(folderId: string) {
		return (await this.sql.all(`SELECT email_id FROM messages WHERE mailbox_id = ? AND folder_id = ? ORDER BY email_id`, this.#id, folderId))
			.map((r) => String(r.email_id));
	}

	/** Label the folder's mail, then move labeled mail still in the folder to Archive. Safe to run again. */
	async importFolder(folderId: string, labelId: string) {
		if (SYSTEM_FOLDERS.includes(folderId)) throw new Error("System folders are not imported");
		const [labeled, archived] = await this.sql.batch([
			{
				sql: `INSERT OR IGNORE INTO message_labels (message, label_id) SELECT id, ? FROM messages WHERE mailbox_id = ? AND folder_id = ? RETURNING message`,
				params: [labelId, this.#id, folderId],
			},
			{
				sql: `UPDATE messages SET folder_id = ? WHERE mailbox_id = ? AND folder_id = ?
					AND id IN (SELECT message FROM message_labels WHERE label_id = ?) RETURNING id`,
				params: [Folders.ARCHIVE, this.#id, folderId, labelId],
			},
		]);
		return { labeled: labeled.length, archived: archived.length };
	}

	async markFoldersImported() {
		await this.sql.run(`UPDATE mailboxes SET folders_imported = 1 WHERE id = ?`, this.#id);
		return { imported: true };
	}

	// ── Sending ────────────────────────────────────────────────────

	/**
	 * Count one send against the address's limits, or refuse it. The insert
	 * is conditional on the counts, so the check and the count are atomic.
	 */
	async takeSendBudget(actor: SendActor, recipients: number, agentDay: number = DEFAULT_AGENT_LIMITS.agentDay): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
		const now = Date.now();
		const hour = new Date(now - 3_600_000).toISOString();
		const day = new Date(now - 86_400_000).toISOString();
		const [, taken] = await this.sql.batch([
			{ sql: `DELETE FROM send_budget WHERE mailbox_id = ? AND at < ?`, params: [this.#id, day] },
			{
				sql: `INSERT INTO send_budget (mailbox_id, actor, recipients, at)
					SELECT ?1, ?2, ?3, ?4
					WHERE (SELECT COUNT(*) FROM send_budget WHERE mailbox_id = ?1 AND at >= ?5) < ?6
					AND (SELECT COUNT(*) FROM send_budget WHERE mailbox_id = ?1) < ?7
					AND (?2 = 'person' OR (SELECT COUNT(*) FROM send_budget WHERE mailbox_id = ?1 AND actor != 'person') < ?8)
					RETURNING id`,
				params: [this.#id, actor, recipients, new Date(now).toISOString(), hour, SEND_LIMITS.hour, SEND_LIMITS.day, agentDay],
			},
		]);
		if (taken.length > 0) return { ok: true, id: Number(taken[0].id) };
		const counts = await this.sql.first(
			`SELECT COALESCE(SUM(at >= ?), 0) AS hour, COUNT(*) AS day, COALESCE(SUM(actor != 'person'), 0) AS agentDay FROM send_budget WHERE mailbox_id = ?`,
			hour, this.#id,
		);
		return { ok: false, error: budgetError(actor, { hour: Number(counts?.hour ?? 0), day: Number(counts?.day ?? 0), agentDay: Number(counts?.agentDay ?? 0) }, agentDay) };
	}

	/** Give back a send that was never delivered. */
	async refundSendBudget(id: number): Promise<void> {
		await this.sql.run(`DELETE FROM send_budget WHERE mailbox_id = ? AND id = ?`, this.#id, id);
	}

	/**
	 * Claim a send attempt (send-keys.ts). New keys, keys whose last attempt
	 * failed, and pending attempts older than SEND_KEY_PENDING_STALE_MS (the
	 * caller died before delivery started) are claimed as pending; anything
	 * else reports its state. A reclaimed key starts a new SEND_KEY_TTL_MS.
	 */
	async claimSendKey(key: string, contentHash: string | null = null): Promise<SendKeyClaim> {
		const now = new Date().toISOString();
		const [, claimed] = await this.sql.batch([
			{ sql: `DELETE FROM send_keys WHERE created_at < ?`, params: [new Date(Date.now() - SEND_KEY_TTL_MS).toISOString()] },
			{
				sql: `INSERT INTO send_keys (mailbox_id, key, state, content_hash, created_at, updated_at) VALUES (?1, ?2, 'pending', ?3, ?4, ?4)
					ON CONFLICT (mailbox_id, key) DO UPDATE SET state = 'pending', content_hash = ?3, provider_id = NULL, error = NULL, created_at = ?4, updated_at = ?4
					WHERE send_keys.state = 'failed'
						OR (send_keys.state = 'pending' AND COALESCE(send_keys.updated_at, send_keys.created_at) < ?5)
					RETURNING state`,
				params: [this.#id, key, contentHash, now, new Date(Date.now() - SEND_KEY_PENDING_STALE_MS).toISOString()],
			},
		]);
		if (claimed.length > 0) return { state: "new" };
		const row = await this.sql.first(`SELECT state, email_id, content_hash, provider_id FROM send_keys WHERE mailbox_id = ? AND key = ?`, this.#id, key);
		if (!row) return this.claimSendKey(key, contentHash);
		if (contentHash && row.content_hash && row.content_hash !== contentHash) return { state: "conflict" };
		if (row.state === "sent") return { state: "sent", id: String(row.email_id) };
		return { state: row.state === "sending" ? "sending" : "pending", providerId: row.provider_id == null ? null : String(row.provider_id) };
	}

	/** A key whose send went out: the Sent copy's id and the content it sent. Null for any other state. */
	async sentSendKey(key: string): Promise<{ id: string; contentHash: string | null } | null> {
		const row = await this.sql.first(`SELECT email_id, content_hash FROM send_keys WHERE mailbox_id = ? AND key = ? AND state = 'sent'`, this.#id, key);
		return row ? { id: String(row.email_id), contentHash: row.content_hash == null ? null : String(row.content_hash) } : null;
	}

	/** pending -> sending. False when another caller already started this attempt. */
	async startSendKey(key: string): Promise<boolean> {
		const rows = await this.sql.all(
			`UPDATE send_keys SET state = 'sending', updated_at = ? WHERE mailbox_id = ? AND key = ? AND state = 'pending' RETURNING key`,
			new Date().toISOString(), this.#id, key,
		);
		return rows.length > 0;
	}

	/** The mail service's message ID, saved before the Sent copy. */
	async recordSendProvider(key: string, providerId: string | null, error: string | null = null): Promise<void> {
		await this.sql.run(
			`UPDATE send_keys SET provider_id = COALESCE(?, provider_id), error = ?, updated_at = ? WHERE mailbox_id = ? AND key = ?`,
			providerId, error, new Date().toISOString(), this.#id, key,
		);
	}

	async finishSendKey(key: string, emailId: string): Promise<void> {
		await this.sql.run(
			`UPDATE send_keys SET state = 'sent', email_id = ?, updated_at = ? WHERE mailbox_id = ? AND key = ?`,
			emailId, new Date().toISOString(), this.#id, key,
		);
	}

	/** The attempt failed before delivery; the key can be used again. */
	async failSendKey(key: string, error: string): Promise<void> {
		await this.sql.run(
			`UPDATE send_keys SET state = 'failed', error = ?, updated_at = ? WHERE mailbox_id = ? AND key = ? AND state IN ('pending', 'sending')`,
			error.slice(0, 1000), new Date().toISOString(), this.#id, key,
		);
	}

	// ── Scheduled send ─────────────────────────────────────────────
	//
	// The message waits as a draft; scheduled_sends holds the request. The cron
	// sends due rows (store/d1/scheduled.ts). Deleting the draft
	// drops its schedule by foreign key.

	async scheduleSend(input: {
		mailboxId?: string;
		sendAt: string;
		draftId?: string;
		mode: ScheduleMode;
		originalId?: string;
		email: SendEmailRequest;
	}): Promise<{ id: string; sendAt: string } | { error: string; status: 404 }> {
		const { email, mode, originalId } = input;
		let threadId: string | null = null;
		if (originalId && mode !== "new") {
			const raw = await this.getEmail(originalId);
			if (!raw) return { error: "Original email not found", status: 404 };
			const original = raw.folder_id === Folders.DRAFT && raw.in_reply_to ? (await this.getEmail(raw.in_reply_to)) ?? raw : raw;
			if (mode !== "forward") threadId = original.thread_id || original.id;
		}
		const join = (v?: string | string[]) => (v ? (Array.isArray(v) ? v.join(", ") : v).toLowerCase() : null);
		const id = crypto.randomUUID();
		const sendAt = new Date(input.sendAt).toISOString();
		await this.createEmail(Folders.DRAFT, {
			id, subject: email.subject || "", sender: this.#id,
			recipient: join(email.to) ?? "", cc: join(email.cc), bcc: join(email.bcc),
			date: new Date().toISOString(), body: email.html || email.text || "",
			in_reply_to: originalId || null, email_references: null,
			thread_id: threadId || originalId || id,
		}, []);
		const payload: ScheduledPayload = { mode, original_id: originalId, email };
		await this.sql.run(
			`INSERT OR REPLACE INTO scheduled_sends (email_id, mailbox_id, send_at, payload, attempts, error) VALUES (?, ?, ?, ?, 0, NULL)`,
			id, this.#id, sendAt, JSON.stringify(payload),
		);
		if (input.draftId && input.draftId !== id) {
			const old = await this.getEmail(input.draftId);
			if (old?.folder_id === Folders.DRAFT) {
				const attachments = await this.deleteEmail(input.draftId);
				if (attachments) await deleteAttachmentFiles(this.bucket, input.draftId, attachments);
			}
		}
		return { id, sendAt };
	}

	async listScheduled(): Promise<ScheduledRow[]> {
		return (await this.sql.all(
			`SELECT email_id, send_at, attempts, error FROM scheduled_sends WHERE mailbox_id = ? ORDER BY send_at, email_id`,
			this.#id,
		)).map((r) => ({ emailId: String(r.email_id), sendAt: String(r.send_at), attempts: Number(r.attempts), error: r.error == null ? null : String(r.error) }));
	}

	/** Drop the schedule only; the draft stays in Drafts. */
	async cancelScheduled(emailId: string): Promise<boolean> {
		return (await this.sql.all(`DELETE FROM scheduled_sends WHERE mailbox_id = ? AND email_id = ? RETURNING email_id`, this.#id, emailId)).length > 0;
	}
}
