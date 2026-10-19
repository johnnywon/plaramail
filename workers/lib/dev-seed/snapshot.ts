// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// A demo's hourly reset without writing the inbox again. Writing 100 messages
// with their search rows costs a few hundred milliseconds of Worker CPU, far
// past the Workers Free plan's 10 ms. So after a full write the reset copies the
// sample rows into demo_snapshot_* tables, and every later reset puts them back
// in one D1 batch: D1 does the copying, the Worker only sends the statements.
//
// The sample messages stay, so their word and substring index rows stay. Only
// what visitors made goes, and their changes to sample rows are overwritten
// from the copy. A sample message a visitor deleted (saving an edited draft
// replaces it; emptying Trash deletes) comes back from the copy with its index
// rows, and its files come back from copies kept in R2. Only a new story week,
// or a copy that can't be read, makes the caller write the inbox in full.

import { recordsSql } from "../../store";
import type { Statement } from "../../store/sql";
import type { Env } from "../../types";
import { htmlToText } from "../message-meta";
import { foldLettersSql as f } from "../search-fold";

/** Tables the copy holds, parents before children. */
const COPIED = ["labels", "messages", "attachments", "message_labels", "label_auto", "draft_notes", "saved_searches"] as const;
/** Tables a reset empties: visitors' undo history, jobs and the activity log, which holds what they typed into Redraft. */
const CLEARED = ["undo", "bulk_job", "agent_activity", "auto_draft_runs", "scheduled_sends"] as const;
/** R2 prefixes the sample inbox writes. Anything else there was made by a visitor. */
const R2_PREFIXES = ["attachments/", "bodies/"] as const;
const META = "demo_snapshot_meta";
/** Where the copy keeps the sample files, so a deleted one can be put back. */
const FILE_COPIES = "demo/snapshot/";
const snap = (table: string) => `demo_snapshot_${table}`;

export interface Restored {
	messages: number;
	labels: number;
	reindexed: number;
	removedFiles: number;
}

async function r2Keys(env: Env): Promise<string[]> {
	const keys: string[] = [];
	for (const prefix of R2_PREFIXES) {
		let cursor: string | undefined;
		do {
			const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
			keys.push(...page.objects.map((o) => o.key));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	}
	return keys;
}

/** Copy the inbox as it is now. `key` names the story version the copy belongs to. */
export async function takeSnapshot(env: Env, key: string, now = Date.now()): Promise<void> {
	const sql = recordsSql(env);
	// Generated columns can't be written, so a restore names the others.
	const columns = (await sql.all<{ name: string; hidden: number }>("PRAGMA table_xinfo(messages)"))
		.filter((c) => Number(c.hidden) === 0 && c.name !== "id" && c.name !== "email_id")
		.map((c) => c.name);
	const files = await r2Keys(env);
	for (let cursor: string | undefined, first = true; first || cursor; first = false) {
		const page = await env.BUCKET.list({ prefix: FILE_COPIES, cursor, limit: 1000 });
		if (page.objects.length > 0) await env.BUCKET.delete(page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	}
	for (const f of files) {
		const obj = await env.BUCKET.get(f);
		if (obj) await env.BUCKET.put(FILE_COPIES + f, obj.body, { httpMetadata: obj.httpMetadata });
	}
	// The word index is contentless, so the copy keeps each message's indexed body text to write it again.
	const texts: { id: number; t: string }[] = [];
	for (const row of await sql.all<{ id: number; body: string | null; body_key: string | null }>("SELECT id, body, body_key FROM messages")) {
		const body = row.body ?? (row.body_key ? (await (await env.BUCKET.get(row.body_key))?.text()) ?? "" : "");
		texts.push({ id: Number(row.id), t: htmlToText(body) });
	}
	const statements: Statement[] = COPIED.flatMap((t) => [
		{ sql: `DROP TABLE IF EXISTS ${snap(t)}` },
		{ sql: `CREATE TABLE ${snap(t)} AS SELECT * FROM ${t}` },
	]);
	statements.push(
		{ sql: `DROP TABLE IF EXISTS ${snap("text")}` },
		{ sql: `CREATE TABLE ${snap("text")} (id INTEGER PRIMARY KEY, body_text TEXT NOT NULL)` },
		{ sql: `INSERT INTO ${snap("text")} (id, body_text) SELECT json_extract(value, '$.id'), json_extract(value, '$.t') FROM json_each(?)`, params: [JSON.stringify(texts)] },
		{ sql: `CREATE TABLE IF NOT EXISTS ${snap("reindex")} (id INTEGER PRIMARY KEY)` },
	);
	statements.push(
		{ sql: `CREATE TABLE IF NOT EXISTS ${META} (k TEXT PRIMARY KEY, v TEXT NOT NULL)` },
		{ sql: `DELETE FROM ${META}` },
		{ sql: `INSERT INTO ${META} (k, v) VALUES ('key', ?), ('taken_at', ?), ('columns', ?), ('files', ?)`, params: [key, String(now), JSON.stringify(columns), JSON.stringify(files)] },
	);
	await sql.batch(statements);
}

/**
 * Put the copied inbox back. Returns null when the copy is missing, belongs to
 * another story version, or a sample file can't be put back.
 * `shiftDates` moves the sample dates forward by the time since the copy.
 */
export async function restoreSnapshot(env: Env, key: string, opts: { now?: number; shiftDates?: boolean; maxAgeMs?: number } = {}): Promise<Restored | null> {
	const sql = recordsSql(env);
	const now = opts.now ?? Date.now();
	let meta: Record<string, string>;
	try {
		meta = Object.fromEntries((await sql.all<{ k: string; v: string }>(`SELECT k, v FROM ${META}`)).map((r) => [r.k, r.v]));
	} catch {
		return null; // No copy yet.
	}
	const takenAt = Number(meta.taken_at);
	if (meta.key !== key || !Number.isFinite(takenAt)) return null;
	if (opts.maxAgeMs !== undefined && now - takenAt > opts.maxAgeMs) return null;

	// Sample files a visitor's delete took with it come back from the copies.
	const files = new Set<string>(JSON.parse(meta.files ?? "[]"));
	const live = await r2Keys(env);
	const liveSet = new Set(live);
	for (const f of files) {
		if (liveSet.has(f)) continue;
		const copy = await env.BUCKET.get(FILE_COPIES + f);
		if (!copy) return null;
		await env.BUCKET.put(f, copy.body, { httpMetadata: copy.httpMetadata });
	}

	const columns: string[] = JSON.parse(meta.columns ?? "[]");
	const assign = `(${columns.join(", ")}) = (${columns.map((c) => `s.${c}`).join(", ")})`;
	const names = `COALESCE((SELECT group_concat(a.filename, ' ') FROM attachments a WHERE a.email_id = m.email_id AND COALESCE(a.disposition, 'attachment') != 'inline'), '')`;
	const reindexed = `(SELECT id FROM ${snap("reindex")})`;
	const statements: Statement[] = [
		// Sample messages whose index rows need writing: ones a visitor deleted, and ones whose indexed text a visitor changed.
		// Worked out inside the batch, so a delete during the reset can't slip past it.
		{ sql: `DELETE FROM ${snap("reindex")}` },
		{
			sql: `INSERT INTO ${snap("reindex")} (id) SELECT s.id FROM ${snap("messages")} s LEFT JOIN messages m ON m.email_id = s.email_id
				WHERE m.id IS NULL OR m.subject IS NOT s.subject OR m.body IS NOT s.body OR m.body_key IS NOT s.body_key OR m.recipients IS NOT s.recipients`,
		},
		// What visitors made. The delete triggers take their index rows with them.
		{ sql: `DELETE FROM messages WHERE email_id NOT IN (SELECT email_id FROM ${snap("messages")})` },
		// Sample messages a visitor deleted come back with their ids, so labels and index rows line up.
		{ sql: `INSERT INTO messages (id, email_id, ${columns.join(", ")}) SELECT id, email_id, ${columns.join(", ")} FROM ${snap("messages")} WHERE email_id NOT IN (SELECT email_id FROM messages)` },
		{ sql: `UPDATE messages SET ${assign} FROM ${snap("messages")} AS s WHERE messages.email_id = s.email_id` },
		{ sql: `DELETE FROM message_labels` },
		{ sql: `DELETE FROM label_auto` },
		{ sql: `DELETE FROM draft_notes` },
		{ sql: `DELETE FROM saved_searches` },
		{ sql: `DELETE FROM attachments WHERE id NOT IN (SELECT id FROM ${snap("attachments")})` },
		{ sql: `INSERT OR IGNORE INTO attachments SELECT * FROM ${snap("attachments")}` },
		{ sql: `DELETE FROM labels WHERE id NOT IN (SELECT id FROM ${snap("labels")})` },
		// Label names are unique and checked row by row, so a visitor's swap of two sample names would collide. Park them first.
		{ sql: `UPDATE labels SET name = 'demo-reset:' || id WHERE id IN (SELECT id FROM ${snap("labels")})` },
		{ sql: `UPDATE labels SET (name, color, position) = (s.name, s.color, s.position) FROM ${snap("labels")} AS s WHERE labels.id = s.id` },
		{ sql: `INSERT OR IGNORE INTO labels SELECT * FROM ${snap("labels")}` },
		{ sql: `INSERT INTO message_labels SELECT * FROM ${snap("message_labels")}` },
		{ sql: `INSERT INTO label_auto SELECT * FROM ${snap("label_auto")}` },
		{ sql: `INSERT INTO draft_notes SELECT * FROM ${snap("draft_notes")}` },
		{ sql: `INSERT INTO saved_searches SELECT * FROM ${snap("saved_searches")}` },
		...CLEARED.map((t) => ({ sql: `DELETE FROM ${t}` })),
		// Index rows for those messages, written in four statements however many there are.
		{ sql: `DELETE FROM messages_fts WHERE rowid IN ${reindexed}` },
		{ sql: `DELETE FROM messages_trigram WHERE rowid IN ${reindexed}` },
		{
			sql: `INSERT INTO messages_fts (rowid, subject, sender_name, sender_addr, recipients, body_text, attachment_names)
				SELECT m.id, ${f("m.subject")}, ${f("m.sender_name")}, ${f("m.sender_addr")}, ${f("m.recipients")}, ${f("t.body_text")}, ${f(names)}
				FROM messages m JOIN ${snap("text")} t ON t.id = m.id WHERE m.id IN ${reindexed}`,
		},
		{
			sql: `INSERT INTO messages_trigram (rowid, subject, sender_addr, recipients, attachment_names)
				SELECT m.id, ${f("m.subject")}, ${f("m.sender_addr")}, ${f("m.recipients")}, ${f(names)} FROM messages m WHERE m.id IN ${reindexed}`,
		},
	];
	if (opts.shiftDates) {
		statements.push({
			sql: `UPDATE messages SET date = strftime('%Y-%m-%dT%H:%M:%fZ', julianday(date) + ? / 86400000.0)`,
			params: [now - takenAt],
		});
	}
	statements.push({
		sql: `SELECT (SELECT COUNT(*) FROM ${snap("messages")}) AS copied, (SELECT COUNT(*) FROM ${snap("labels")}) AS labels, (SELECT COUNT(*) FROM ${snap("reindex")}) AS reindexed`,
	});
	const results = await sql.batch(statements);
	const counts = results[results.length - 1][0];

	const extra = live.filter((k) => !files.has(k) && !k.startsWith(FILE_COPIES));
	for (let i = 0; i < extra.length; i += 1000) await env.BUCKET.delete(extra.slice(i, i + 1000));
	return { messages: Number(counts.copied), labels: Number(counts.labels), reindexed: Number(counts.reindexed), removedFiles: extra.length };
}
