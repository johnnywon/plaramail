// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Which thread an inbound message joins. Headers are written by the sender,
 * so a message joins a thread only through mail this mailbox already holds:
 *
 * 1. In-Reply-To or References names a Message-ID stored in this mailbox:
 *    the message joins that message's thread.
 * 2. No header hit, a reply prefix on the subject ("Re:"), and a thread in
 *    the last two days with the same subject where the sender took part
 *    (sent a message in it, or was written to from this mailbox).
 * 3. Otherwise the message starts its own thread.
 */

/** Prefixes stripped before comparing subjects. */
export const SUBJECT_PREFIX = /^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv|antw)\s*(?:\[\d+\])?\s*:\s*)+/i;
/** Prefixes that mark a reply. Forwards start a new thread. */
const REPLY_PREFIX = /^\s*(?:re|aw|sv|r[eé]f|antw)\s*(?:\[\d+\])?\s*:/i;
/** How far back a subject match may reach. */
export const SUBJECT_JOIN_WINDOW_MS = 2 * 86_400_000;
/** Most Message-IDs looked up per message, nearest first. D1 binds at most 100 parameters. */
export const MAX_REFERENCED_IDS = 50;

/** The Message-IDs in a References header. RFC 5322 does not require space between them. */
export function parseReferences(header: string): string[] {
	const bracketed = [...header.matchAll(/<([^<>]+)>/g)].map((m) => m[1].trim()).filter(Boolean);
	return bracketed.length > 0 ? bracketed : header.split(/[\s,]+/).filter(Boolean);
}

export function normalizeThreadSubject(subject: string): string {
	return subject.replace(SUBJECT_PREFIX, "").trim().toLowerCase();
}

export function hasReplyPrefix(subject: string): boolean {
	return REPLY_PREFIX.test(subject);
}

/** Message-IDs a message points at, nearest first: In-Reply-To, then References from last to first. */
export function referencedIds(inReplyTo: string | null | undefined, references: readonly string[]): string[] {
	const out: string[] = [];
	for (const id of [inReplyTo, ...[...references].reverse()]) {
		const v = id?.trim();
		if (v && !out.includes(v)) out.push(v);
		if (out.length >= MAX_REFERENCED_IDS) break;
	}
	return out;
}

/** The thread of the nearest referenced message found among `rows`. */
export function pickReferencedThread(
	ids: readonly string[],
	rows: readonly { message_id?: unknown; thread_id?: unknown }[],
): string | null {
	for (const id of ids) {
		const row = rows.find((r) => r.message_id === id && r.thread_id);
		if (row) return String(row.thread_id);
	}
	return null;
}

export interface SubjectRow {
	thread_id: unknown;
	subject: unknown;
	sender: unknown;
	recipient: unknown;
	folder_id: unknown;
	date: unknown;
}

const addresses = (value: unknown) =>
	String(value ?? "").toLowerCase().split(",").map((a) => a.trim()).filter(Boolean);

/**
 * The subject fallback. `rows` are recent messages in the mailbox, newest
 * first; the newest matching thread wins.
 */
export function pickSubjectThread(
	rows: readonly SubjectRow[],
	subject: string,
	sender: string | undefined,
	now: number = Date.now(),
): string | null {
	const from = sender?.trim().toLowerCase();
	const normalized = normalizeThreadSubject(subject);
	if (!from || !normalized || !hasReplyPrefix(subject)) return null;
	const since = now - SUBJECT_JOIN_WINDOW_MS;
	const recent = rows.filter((r) => r.thread_id && Date.parse(String(r.date)) >= since);
	const sameSubject = new Set(recent.filter((r) => normalizeThreadSubject(String(r.subject ?? "")) === normalized).map((r) => String(r.thread_id)));
	for (const row of recent) {
		const thread = String(row.thread_id);
		if (!sameSubject.has(thread)) continue;
		const tookPart = String(row.sender ?? "").trim().toLowerCase() === from
			|| (row.folder_id === "sent" && addresses(row.recipient).includes(from));
		if (tookPart) return thread;
	}
	return null;
}

type ThreadFinder = {
	findThreadByMessageIds(ids: string[]): Promise<string | null>;
	findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null>;
};

/** The thread id for an inbound message about to be stored. `messageId` is the new message's own id. */
export async function resolveThreadId(
	store: ThreadFinder,
	message: { messageId: string; inReplyTo: string | null; references: readonly string[]; subject: string; sender: string },
): Promise<string> {
	const ids = referencedIds(message.inReplyTo, message.references);
	if (ids.length > 0) {
		const hit = await store.findThreadByMessageIds(ids);
		if (hit) return hit;
	}
	if (hasReplyPrefix(message.subject)) {
		const hit = await store.findThreadBySubject(message.subject, message.sender);
		if (hit) return hit;
	}
	return message.messageId;
}
