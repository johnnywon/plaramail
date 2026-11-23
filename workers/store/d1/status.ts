// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Message counts per address for the Storage page. Unread counts the Inbox only. */
import type { Sql } from "../sql";

export interface MailboxCounts {
	mailboxId: string;
	/** Messages per state: inbox, sent, draft, archive, spam, trash, or folder:<id>. */
	states: Record<string, number>;
	unread: number;
	starred: number;
	total: number;
	inboxConversations: number;
}

/** `bytes`: every message's size, body plus attachments, wherever it is kept (D1 or R2). */
export async function d1StorageStatus(sql: Sql, mailboxIds: string[]): Promise<{ messages: number; bytes: number; mailboxes: MailboxCounts[] }> {
	const [byState, conversations, total] = await sql.batch([
		{
			sql: `SELECT mailbox_id, state, COUNT(*) AS n, SUM(CASE WHEN unread = 1 AND state = 'inbox' THEN 1 ELSE 0 END) AS unread,
				SUM(starred) AS starred FROM messages GROUP BY mailbox_id, state`,
		},
		{ sql: `SELECT mailbox_id, COUNT(DISTINCT thread_key) AS n FROM messages WHERE state = 'inbox' GROUP BY mailbox_id` },
		{ sql: `SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM messages` },
	]);
	const counts = new Map<string, MailboxCounts>(mailboxIds.map((mailboxId) => [
		mailboxId, { mailboxId, states: {}, unread: 0, starred: 0, total: 0, inboxConversations: 0 },
	]));
	for (const row of byState) {
		const e = counts.get(String(row.mailbox_id));
		if (!e) continue;
		e.states[String(row.state)] = Number(row.n);
		e.unread += Number(row.unread);
		e.starred += Number(row.starred);
		e.total += Number(row.n);
	}
	for (const row of conversations) {
		const e = counts.get(String(row.mailbox_id));
		if (e) e.inboxConversations = Number(row.n);
	}
	return { messages: Number(total[0]?.n ?? 0), bytes: Number(total[0]?.bytes ?? 0), mailboxes: [...counts.values()] };
}
