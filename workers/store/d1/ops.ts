// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Apply planned bulk ops (mail-bulk-sql.ts) on D1. Every op is one statement
 * on `messages`, scoped to its mailbox. A failing mailbox is reported and the
 * rest still run.
 */
import { Folders } from "../../../shared/folders";
import type { BulkOp } from "../../lib/mail-bulk-sql";
import type { Sql } from "../sql";
import type { BulkFailure } from "../types";
import { SYSTEM_FOLDERS } from "./rows";

export interface PurgedFile {
	emailId: string;
	key: string;
}

export interface OpsResult {
	affected: number;
	failed: BulkFailure[];
	/** R2 keys of purged mail (attachments and large bodies), for the caller to delete. */
	purged: string[];
}

const ids = (emailIds: string[]) => JSON.stringify([...new Set(emailIds)]);
const IN_IDS = `email_id IN (SELECT value FROM json_each(?))`;

async function moveOp(sql: Sql, op: Extract<BulkOp, { kind: "move" }>): Promise<number> {
	const folder = await sql.first(
		`SELECT f.id, m.folders_imported FROM folders f JOIN mailboxes m ON m.id = f.mailbox_id WHERE f.mailbox_id = ? AND f.id = ?`,
		op.mailboxId, op.to,
	);
	if (!folder) throw new Error(`Folder not found: ${op.to}`);
	if (!SYSTEM_FOLDERS.includes(op.to) && folder.folders_imported) {
		throw new Error("Moves go to system folders only; custom folders are labels now");
	}
	const rows = await sql.all(
		`UPDATE messages SET folder_id = ? WHERE mailbox_id = ? AND ${IN_IDS} AND folder_id = ? AND folder_id != ? RETURNING email_id`,
		op.to, op.mailboxId, ids(op.emailIds), op.from, op.to,
	);
	return rows.length;
}

async function flagsOp(sql: Sql, op: Extract<BulkOp, { kind: "flags" }>): Promise<number> {
	const changed = new Set<string>();
	for (const key of ["read", "starred"] as const) {
		const value = op.patch[key];
		if (value === undefined) continue;
		const flag = value ? 1 : 0;
		for (const row of await sql.all(
			`UPDATE messages SET ${key} = ? WHERE mailbox_id = ? AND ${IN_IDS} AND ${key} != ? RETURNING email_id`,
			flag, op.mailboxId, ids(op.emailIds), flag,
		)) changed.add(String(row.email_id));
	}
	return changed.size;
}

async function labelsOp(sql: Sql, op: Extract<BulkOp, { kind: "labels" }>): Promise<number> {
	const changed = new Set<number>();
	const scope = `SELECT id FROM messages WHERE mailbox_id = ? AND ${IN_IDS}`;
	for (const label of op.remove) {
		for (const row of await sql.all(
			`DELETE FROM message_labels WHERE label_id = ? AND message IN (${scope}) RETURNING message`,
			label, op.mailboxId, ids(op.emailIds),
		)) changed.add(Number(row.message));
	}
	for (const label of op.add) {
		for (const row of await sql.all(
			`INSERT OR IGNORE INTO message_labels (message, label_id) SELECT id, ? FROM messages WHERE mailbox_id = ? AND ${IN_IDS} RETURNING message`,
			label, op.mailboxId, ids(op.emailIds),
		)) changed.add(Number(row.message));
	}
	return changed.size;
}

async function purgeOp(sql: Sql, op: Extract<BulkOp, { kind: "purge" }>, purged: string[]): Promise<number> {
	const json = ids(op.emailIds);
	const folder = op.folderId ?? Folders.TRASH;
	const [files, deleted] = await sql.batch([
		{
			sql: `SELECT 'attachments/' || a.email_id || '/' || a.id || '/' || a.filename AS key FROM attachments a
				JOIN messages m ON m.email_id = a.email_id WHERE m.mailbox_id = ? AND m.folder_id = ? AND m.${IN_IDS}
				UNION ALL SELECT body_key FROM messages WHERE mailbox_id = ? AND folder_id = ? AND ${IN_IDS} AND body_key IS NOT NULL`,
			params: [op.mailboxId, folder, json, op.mailboxId, folder, json],
		},
		{
			sql: `DELETE FROM messages WHERE mailbox_id = ? AND folder_id = ? AND ${IN_IDS} RETURNING email_id`,
			params: [op.mailboxId, folder, json],
		},
	]);
	purged.push(...files.map((r) => String(r.key)));
	return deleted.length;
}

export async function applyOps(sql: Sql, ops: BulkOp[]): Promise<OpsResult> {
	let affected = 0;
	const failed = new Map<string, string>();
	const purged: string[] = [];
	for (const op of ops) {
		if (failed.has(op.mailboxId)) continue;
		try {
			affected += op.kind === "move" ? await moveOp(sql, op)
				: op.kind === "flags" ? await flagsOp(sql, op)
				: op.kind === "labels" ? await labelsOp(sql, op)
				: await purgeOp(sql, op, purged);
		} catch (e) {
			failed.set(op.mailboxId, (e as Error).message);
		}
	}
	return { affected, failed: [...failed].map(([mailboxId, error]) => ({ mailboxId, error })), purged };
}
