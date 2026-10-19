// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Bounce notices (delivery status notifications, RFC 3464) that reach a
 * mailbox. A DSN is a multipart/report with report-type=delivery-status: a
 * part for people, a message/delivery-status part with one block per
 * recipient, and the returned message or its headers (text/rfc822-headers).
 *
 * The receive path calls `bounceLink`: when the returned headers name a
 * message this mailbox sent, the notice is stored as a reply to it, so it
 * joins the Sent message's conversation.
 *
 * Cloudflare Email Sending sets Return-Path to its own bounce processor, so
 * most asynchronous bounces for mail sent from here go there and not to the
 * mailbox. A DSN arrives here when the remote server sends it to the From
 * address, or for mail sent through another provider.
 */
import type { Attachment, Email } from "postal-mime";
import type { Sql } from "../store/sql";

export interface BounceRecipient {
	/** Final-Recipient, without its address type. */
	recipient: string;
	/** failed, delayed, delivered, relayed or expanded. */
	action: string;
	/** The enhanced status code, e.g. 5.1.1. */
	status: string;
	/** Diagnostic-Code, without its type, or null. */
	diagnostic: string | null;
}

export interface Bounce {
	recipients: BounceRecipient[];
	/** Message-ID of the returned message, without angle brackets. */
	originalMessageId: string | null;
	originalSubject: string | null;
	originalDate: string | null;
}

/** How far back a bounce without a matching Message-ID looks for the Sent message. */
export const BOUNCE_MATCH_WINDOW_MS = 7 * 86_400_000;

const DELIVERY_STATUS = /^message\/(global-)?delivery-status$/i;
const RETURNED_HEADERS = /^(text\/rfc822-headers|message\/rfc822|message\/global|message\/global-headers)$/i;

const decode = (content: Attachment["content"]) =>
	typeof content === "string" ? content : new TextDecoder().decode(content);

/** Header fields of a block of `Name: value` lines, unfolded. Keys are lowercase; the first of a repeated field wins. */
export function headerFields(text: string): Map<string, string> {
	const fields = new Map<string, string>();
	let last: string | null = null;
	for (const line of text.split(/\r?\n/)) {
		if (/^[ \t]/.test(line) && last) {
			fields.set(last, `${fields.get(last)} ${line.trim()}`);
			continue;
		}
		const m = line.match(/^([!-9;-~]+)\s*:\s*(.*)$/);
		if (!m) { last = null; continue; }
		last = m[1].toLowerCase();
		if (fields.has(last)) { last = null; continue; }
		fields.set(last, m[2].trim());
	}
	return fields;
}

/** `rfc822; jane@example.org` -> `jane@example.org`. */
const withoutType = (value: string | undefined) => (value ?? "").replace(/^[\w-]+\s*;\s*/, "").trim();

/** The per-recipient blocks of a message/delivery-status body. The first block is about the message. */
export function parseDeliveryStatus(text: string): BounceRecipient[] {
	const blocks = text.replace(/\r\n/g, "\n").split(/\n[ \t]*\n/).map(headerFields);
	const out: BounceRecipient[] = [];
	for (const fields of blocks) {
		const recipient = withoutType(fields.get("final-recipient") || fields.get("original-recipient")).replace(/^<|>$/g, "");
		if (!recipient) continue;
		out.push({
			recipient: recipient.toLowerCase(),
			action: (fields.get("action") ?? "").toLowerCase(),
			status: (fields.get("status") ?? "").split(/\s/)[0] ?? "",
			diagnostic: withoutType(fields.get("diagnostic-code")) || null,
		});
	}
	return out;
}

/** The header block of a returned message: everything up to the first blank line. */
function returnedHeaders(text: string) {
	const head = text.replace(/\r\n/g, "\n").split(/\n[ \t]*\n/)[0] ?? "";
	const fields = headerFields(head);
	const id = fields.get("message-id")?.match(/<([^>]+)>/)?.[1] ?? fields.get("message-id")?.trim();
	return { messageId: id || null, subject: fields.get("subject") ?? null, date: fields.get("date") ?? null };
}

/** The bounce in a parsed message, or null when it is not a delivery status notification. */
export function parseBounce(email: Pick<Email, "attachments" | "headers">): Bounce | null {
	const contentType = email.headers?.find((h) => h.key === "content-type")?.value ?? "";
	// Only a report at the top: a DSN forwarded inside another message is not a bounce of this mailbox's mail.
	if (!/^\s*multipart\/report\b/i.test(contentType)) return null;
	const status = email.attachments?.find((a) => DELIVERY_STATUS.test(a.mimeType));
	if (!status) return null;
	const returned = email.attachments?.find((a) => RETURNED_HEADERS.test(a.mimeType));
	const original = returned ? returnedHeaders(decode(returned.content)) : { messageId: null, subject: null, date: null };
	return {
		recipients: parseDeliveryStatus(decode(status.content)),
		originalMessageId: original.messageId,
		originalSubject: original.subject,
		originalDate: original.date,
	};
}

export interface BounceLink {
	/** The Sent message the notice is about. */
	emailId: string;
	threadId: string;
	/** Its Message-ID, for the notice's In-Reply-To. */
	messageId: string | null;
}

type SentRow = { email_id: unknown; thread_id: unknown; message_id: unknown };
const toLink = (row: SentRow | null): BounceLink | null =>
	row ? { emailId: String(row.email_id), threadId: String(row.thread_id || row.email_id), messageId: row.message_id == null ? null : String(row.message_id) } : null;

/**
 * The Sent message in `mailboxId` a bounce is about. Tried in order:
 * 1. a Sent message with the returned Message-ID;
 * 2. a send whose mail service id is that Message-ID (send_keys.provider_id);
 * 3. the newest Sent message in the last seven days with the returned subject
 *    and a failed recipient among its recipients. Email Sending writes its
 *    own Message-ID, so this is the match that usually applies.
 */
export async function findBouncedMessage(sql: Sql, mailboxId: string, bounce: Bounce, now = Date.now()): Promise<BounceLink | null> {
	const cols = `m.email_id, m.thread_id, m.message_id`;
	const id = bounce.originalMessageId;
	if (id) {
		const byId = await sql.first<SentRow>(
			`SELECT ${cols} FROM messages m WHERE m.mailbox_id = ? AND m.folder_id = 'sent' AND m.message_id = ? ORDER BY m.date DESC LIMIT 1`,
			mailboxId, id,
		);
		if (byId) return toLink(byId);
		const byProvider = await sql.first<SentRow>(
			`SELECT ${cols} FROM send_keys k JOIN messages m ON m.email_id = k.email_id
			WHERE k.mailbox_id = ? AND m.mailbox_id = ? AND m.folder_id = 'sent' AND k.provider_id IN (?, ?) LIMIT 1`,
			mailboxId, mailboxId, id, `<${id}>`,
		);
		if (byProvider) return toLink(byProvider);
	}
	const subject = bounce.originalSubject?.trim();
	const failed = bounce.recipients.filter((r) => r.action === "failed" || r.action === "delayed").map((r) => r.recipient);
	if (!subject || failed.length === 0) return null;
	const since = new Date(now - BOUNCE_MATCH_WINDOW_MS).toISOString();
	const bySubject = await sql.first<SentRow>(
		`SELECT ${cols} FROM messages m
		WHERE m.mailbox_id = ? AND m.folder_id = 'sent' AND m.subject = ? AND m.date >= ?
			AND (${failed.slice(0, 20).map(() => "instr(m.recipients, ?) > 0").join(" OR ")})
		ORDER BY m.date DESC LIMIT 1`,
		mailboxId, subject, since, ...failed.slice(0, 20),
	);
	return toLink(bySubject);
}

/** The bounce in an inbound message and the Sent message it is about, or null for other mail. */
export async function bounceLink(sql: Sql, mailboxId: string, email: Pick<Email, "attachments" | "headers">): Promise<{ bounce: Bounce; link: BounceLink | null } | null> {
	const bounce = parseBounce(email);
	if (!bounce) return null;
	return { bounce, link: await findBouncedMessage(sql, mailboxId, bounce) };
}
