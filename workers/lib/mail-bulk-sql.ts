// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Planning for bulk actions, undo and label definitions. A plan decides
 * which messages change and records their prior state; the store applies
 * the ops (workers/store/d1/ops.ts).
 */

import { DEFAULT_LABEL_COLOR, isLabelColor } from "../../shared/label-colors";
import { type MailFilter, type Query, filterWhere, sqlStep } from "./mail-index-sql";

export const MAX_OP_IDS = 100;
export const UNDO_TTL_MS = 60 * 60 * 1000;
export const MOVE_FOLDERS = ["inbox", "archive", "spam", "trash"] as const;

export type BulkAction =
	| { type: "archive" | "trash" | "restore" | "read" | "unread" | "star" | "unstar" }
	| { type: "move"; folder: (typeof MOVE_FOLDERS)[number] }
	| { type: "label_add" | "label_remove"; labelId: string };

export type BulkOp =
	| { mailboxId: string; kind: "move"; emailIds: string[]; to: string; from: string }
	| { mailboxId: string; kind: "flags"; emailIds: string[]; patch: { read?: boolean; starred?: boolean } }
	| { mailboxId: string; kind: "labels"; emailIds: string[]; add: string[]; remove: string[] }
	/** Deletes from Trash, or from `folderId` (Spam, for retention). */
	| { mailboxId: string; kind: "purge"; emailIds: string[]; folderId?: string };

/** What a bulk job runs: a user bulk action, or Empty Trash. */
export type JobAction = BulkAction | { type: "empty_trash" };

/** Prior state of one changed row: enough to reverse exactly that change. */
export interface UndoEntry {
	mailbox_id: string;
	email_id: string;
	/** Moves: the state before, and the state the action moved it to. */
	state?: string;
	to?: string;
	unread?: boolean;
	starred?: boolean;
	label?: { id: string; had: boolean };
}

export interface UndoPayload {
	action: BulkAction;
	entries: UndoEntry[];
}

export class BulkConflictError extends Error {
	override name = "BulkConflictError";
	constructor(readonly count: number) {
		super(`The list changed: ${count} conversations match now`);
	}
}

const MOVE_TARGET: Partial<Record<BulkAction["type"], string>> = { archive: "archive", trash: "trash", restore: "inbox" };

/**
 * The state a thread move takes messages from. Unread, Starred and All mail
 * act on the Inbox part of a thread; Sent and Drafts only when they are the view.
 */
export function sourceState(view: string): string {
	if (view === "drafts") return "draft";
	if (view === "unread" || view === "starred" || view === "all") return "inbox";
	return view;
}

/** Mailbox folder id for a `state` value. */
export function stateToFolder(state: string): string {
	return state.startsWith("folder:") ? state.slice(7) : state;
}

function moveTarget(action: BulkAction): string | null {
	if (action.type === "move") return action.folder;
	return MOVE_TARGET[action.type] ?? null;
}

/**
 * Conversations a filter matches, counting only messages dated at or before
 * `asOf` so mail that arrived after the user looked is left alone. Throws
 * BulkConflictError when the count differs from what the user saw.
 */
/** Thread keys of conversations matching a filter, newest first, at most `limit`. */
export function* matchingThreadKeysQuery(filter: MailFilter, limit: number, now = Date.now()): Query<string[]> {
	const w = filterWhere(filter, now);
	return (yield sqlStep(
		`SELECT m.thread_key AS k, MAX(m.date) AS d FROM messages m WHERE ${w.sql} GROUP BY m.thread_key ORDER BY d DESC LIMIT ?`,
		...w.params,
		limit,
	)).map((r) => String(r.k));
}

export function* resolveFilterTargetQuery(filter: MailFilter, asOf: string, expectedCount: number, now = Date.now()): Query<string[]> {
	const w = filterWhere(filter, now);
	const keys = (yield sqlStep(
		`SELECT DISTINCT m.thread_key AS k FROM messages m WHERE ${w.sql} AND m.date <= ?`,
		...w.params,
		asOf,
	)).map((r) => String(r.k));
	if (keys.length !== expectedCount) throw new BulkConflictError(keys.length);
	return keys;
}

interface PlanRow {
	id: number;
	mailbox_id: string;
	email_id: string;
	thread_key: string;
	state: string;
	date: string;
	unread: boolean;
	starred: boolean;
	has_label: boolean;
}

function groupOps<T extends BulkOp>(make: (mailboxId: string, ids: string[], key: string) => T, rows: { mailbox_id: string; email_id: string; key: string }[]): T[] {
	const groups = new Map<string, { mailboxId: string; key: string; ids: string[] }>();
	for (const row of rows) {
		const k = `${row.mailbox_id}\u0000${row.key}`;
		const group = groups.get(k) ?? { mailboxId: row.mailbox_id, key: row.key, ids: [] };
		group.ids.push(row.email_id);
		groups.set(k, group);
	}
	const ops: T[] = [];
	for (const group of groups.values()) {
		for (let i = 0; i < group.ids.length; i += MAX_OP_IDS) {
			ops.push(make(group.mailboxId, group.ids.slice(i, i + MAX_OP_IDS), group.key));
		}
	}
	return ops;
}

/** Ops that apply an action to these threads, and the undo entries that reverse them. */
export function* planBulkQuery(threadKeys: string[], view: string, action: BulkAction): Query<{ ops: BulkOp[]; entries: UndoEntry[] }> {
	if (threadKeys.length === 0) return { ops: [], entries: [] };
	const labelId = action.type === "label_add" || action.type === "label_remove" ? action.labelId : "";
	const rows: PlanRow[] = (yield sqlStep(
		`SELECT m.id, m.mailbox_id, m.email_id, m.thread_key, m.state, m.date, m.unread, m.starred,
			EXISTS (SELECT 1 FROM message_labels l WHERE l.message = m.id AND l.label_id = ?) AS has_label
		FROM messages m
		WHERE m.deleted = 0 AND m.thread_key IN (SELECT value FROM json_each(?))
		ORDER BY m.thread_key, m.date DESC, m.id DESC`,
		labelId,
		JSON.stringify([...new Set(threadKeys)]),
	)).map((r) => ({
		id: Number(r.id),
		mailbox_id: String(r.mailbox_id),
		email_id: String(r.email_id),
		thread_key: String(r.thread_key),
		state: String(r.state),
		date: String(r.date),
		unread: !!r.unread,
		starred: !!r.starred,
		has_label: !!r.has_label,
	}));

	const target = moveTarget(action);
	if (target !== null) {
		const from = sourceState(view);
		if (from === target) return { ops: [], entries: [] };
		const chosen = rows.filter((r) => r.state === from);
		const entries = chosen.map((r) => ({ mailbox_id: r.mailbox_id, email_id: r.email_id, state: r.state, to: target }));
		const ops = groupOps(
			(mailboxId, emailIds) => ({ mailboxId, kind: "move" as const, emailIds, to: target, from: stateToFolder(from) }),
			chosen.map((r) => ({ ...r, key: "" })),
		);
		return { ops, entries };
	}

	let chosen: PlanRow[];
	switch (action.type) {
		case "read": chosen = rows.filter((r) => r.unread); break;
		case "unread": chosen = rows.filter((r) => !r.unread); break;
		case "star": {
			const latest = new Map<string, PlanRow>();
			for (const r of rows) if (r.state !== "draft" && !latest.has(r.thread_key)) latest.set(r.thread_key, r);
			chosen = [...latest.values()].filter((r) => !r.starred);
			break;
		}
		case "unstar": chosen = rows.filter((r) => r.starred); break;
		case "label_add": chosen = rows.filter((r) => !r.has_label); break;
		case "label_remove": chosen = rows.filter((r) => r.has_label); break;
		default: chosen = [];
	}

	const keyed = chosen.map((r) => ({ ...r, key: "" }));
	if (action.type === "label_add" || action.type === "label_remove") {
		const add = action.type === "label_add";
		return {
			ops: groupOps((mailboxId, emailIds) => ({
				mailboxId, kind: "labels" as const, emailIds, add: add ? [action.labelId] : [], remove: add ? [] : [action.labelId],
			}), keyed),
			entries: chosen.map((r) => ({ mailbox_id: r.mailbox_id, email_id: r.email_id, label: { id: action.labelId, had: r.has_label } })),
		};
	}
	const patch = action.type === "read" ? { read: true }
		: action.type === "unread" ? { read: false }
		: action.type === "star" ? { starred: true }
		: { starred: false };
	const flagEntry = (r: PlanRow): UndoEntry => "read" in patch
		? { mailbox_id: r.mailbox_id, email_id: r.email_id, unread: r.unread }
		: { mailbox_id: r.mailbox_id, email_id: r.email_id, starred: r.starred };
	return {
		ops: groupOps((mailboxId, emailIds) => ({ mailboxId, kind: "flags" as const, emailIds, patch }), keyed),
		entries: chosen.map(flagEntry),
	};
}

/** Ops that put every recorded row back the way it was before the action. */
export function planUndo(payload: UndoPayload): BulkOp[] {
	const ops: BulkOp[] = [];
	const rows = payload.entries;
	ops.push(...groupOps((mailboxId, emailIds, key) => {
		const [to, from] = key.split("\u0000");
		return { mailboxId, kind: "move" as const, emailIds, to, from };
	}, rows.filter((e) => e.state !== undefined && e.to !== undefined)
		.map((e) => ({ ...e, key: `${stateToFolder(e.state!)}\u0000${stateToFolder(e.to!)}` }))));
	ops.push(...groupOps((mailboxId, emailIds, key) => ({ mailboxId, kind: "flags" as const, emailIds, patch: { read: key === "read" } }),
		rows.filter((e) => e.unread !== undefined).map((e) => ({ ...e, key: e.unread ? "unread" : "read" }))));
	ops.push(...groupOps((mailboxId, emailIds, key) => ({ mailboxId, kind: "flags" as const, emailIds, patch: { starred: key === "starred" } }),
		rows.filter((e) => e.starred !== undefined).map((e) => ({ ...e, key: e.starred ? "starred" : "plain" }))));
	ops.push(...groupOps((mailboxId, emailIds, key) => {
		const [had, id] = [key.slice(0, 1), key.slice(1)];
		return { mailboxId, kind: "labels" as const, emailIds, add: had === "1" ? [id] : [], remove: had === "1" ? [] : [id] };
	}, rows.filter((e) => e.label).map((e) => ({ ...e, key: `${e.label!.had ? "1" : "0"}${e.label!.id}` }))));
	return ops;
}

// ── Empty Trash ────────────────────────────────────────────────────

/** Messages and conversations in Trash across every mailbox. */
export function* trashCountQuery(): Query<{ messages: number; conversations: number }> {
	const row = (yield sqlStep(`SELECT COUNT(*) AS m, COUNT(DISTINCT thread_key) AS c FROM messages WHERE state = 'trash' AND deleted = 0`))[0];
	return { messages: Number(row.m), conversations: Number(row.c) };
}

/**
 * Purge ops for every message in Trash. Throws BulkConflictError when the
 * count differs from the one the user confirmed.
 */
export function* planEmptyTrashQuery(expectedCount: number): Query<BulkOp[]> {
	const rows = (yield sqlStep(`SELECT mailbox_id, email_id FROM messages WHERE state = 'trash' AND deleted = 0 ORDER BY mailbox_id, email_id`))
		.map((r) => ({ mailbox_id: String(r.mailbox_id), email_id: String(r.email_id), key: "" }));
	if (rows.length !== expectedCount) throw new BulkConflictError(rows.length);
	return groupOps((mailboxId, emailIds) => ({ mailboxId, kind: "purge" as const, emailIds }), rows);
}

// ── Trash and Spam retention (WON-212) ────────────────────────────

/** Messages purged per cron run, so a first run over a large Trash stays within the Worker's limits. */
export const RETENTION_BATCH = 500;

/**
 * Purge ops for messages that have been in Trash or Spam for more than `days`
 * days, counted from when they moved there (migration 0010) or, for mail that
 * arrived in Spam, from their date.
 */
export function* planRetentionPurgeQuery(days: number, now = Date.now()): Query<BulkOp[]> {
	const before = new Date(now - days * 86_400_000).toISOString();
	const rows = (yield sqlStep(
		`SELECT mailbox_id, email_id, folder_id FROM messages WHERE state IN ('trash', 'spam') AND deleted = 0
		AND COALESCE(folder_changed_at, date) < ? ORDER BY mailbox_id, folder_id, email_id LIMIT ?`,
		before, RETENTION_BATCH,
	)).map((r) => ({ mailbox_id: String(r.mailbox_id), email_id: String(r.email_id), key: String(r.folder_id) }));
	return groupOps((mailboxId, emailIds, folderId) => ({ mailboxId, kind: "purge" as const, emailIds, folderId }), rows);
}

export function opSize(ops: BulkOp[]): number {
	return ops.reduce((n, op) => n + op.emailIds.length, 0);
}

// ── Undo records ───────────────────────────────────────────────────

export function* pruneUndoQuery(now = Date.now()): Query<void> {
	(yield sqlStep(`DELETE FROM undo WHERE created_at < ?`, new Date(now - UNDO_TTL_MS).toISOString()));
}

export function* saveUndoQuery(id: string, payload: UndoPayload, now = Date.now()): Query<void> {
	(yield* pruneUndoQuery(now));
	(yield sqlStep(`INSERT INTO undo (id, created_at, payload) VALUES (?, ?, ?)`, id, new Date(now).toISOString(), JSON.stringify(payload)));
}

/** The undo record, once. Missing or older than an hour returns null. */
export function* takeUndoQuery(id: string, now = Date.now()): Query<UndoPayload | null> {
	(yield* pruneUndoQuery(now));
	const row = (yield sqlStep(`DELETE FROM undo WHERE id = ? RETURNING payload`, id))[0];
	return row ? (JSON.parse(String(row.payload)) as UndoPayload) : null;
}

// ── Bulk jobs (over 500 messages) ──────────────────────────────────

export interface BulkJob {
	id: string;
	action: JobAction;
	total: number;
	done: number;
	affected: number;
	failed: { mailboxId: string; error: string }[];
	undoId: string;
	finishedAt: string | null;
}

export function* createBulkJobQuery(id: string, action: JobAction, ops: BulkOp[], undoId: string, now = Date.now()): Query<void> {
	(yield sqlStep(
		`INSERT INTO bulk_job (id, created_at, action, ops, total, undo_id) VALUES (?, ?, ?, ?, ?, ?)`,
		id, new Date(now).toISOString(), JSON.stringify(action), JSON.stringify(ops), ops.length, undoId,
	));
}

/** The oldest unfinished job and its next ops. */
export function* nextBulkOpsQuery(limit: number): Query<{ id: string; position: number; ops: BulkOp[] } | null> {
	const row = (yield sqlStep(`SELECT id, ops, position FROM bulk_job WHERE finished_at IS NULL ORDER BY created_at LIMIT 1`))[0];
	if (!row) return null;
	const position = Number(row.position);
	return { id: String(row.id), position, ops: (JSON.parse(String(row.ops)) as BulkOp[]).slice(position, position + limit) };
}

export function* saveBulkProgressQuery(id: string, step: { ops: number; affected: number; failed: { mailboxId: string; error: string }[] }, now = Date.now()): Query<void> {
	const row = (yield sqlStep(`SELECT position, total, failed FROM bulk_job WHERE id = ?`, id))[0];
	if (!row) return;
	const position = Number(row.position) + step.ops;
	const failed = [...(JSON.parse(String(row.failed)) as unknown[]), ...step.failed];
	(yield sqlStep(
		`UPDATE bulk_job SET position = ?, affected = affected + ?, failed = ?, finished_at = ? WHERE id = ?`,
		position, step.affected, JSON.stringify(failed), position >= Number(row.total) ? new Date(now).toISOString() : null, id,
	));
}

export function* getBulkJobQuery(id: string): Query<BulkJob | null> {
	const row = (yield sqlStep(`SELECT * FROM bulk_job WHERE id = ?`, id))[0];
	if (!row) return null;
	return {
		id: String(row.id),
		action: JSON.parse(String(row.action)),
		total: Number(row.total),
		done: Number(row.position),
		affected: Number(row.affected),
		failed: JSON.parse(String(row.failed)),
		undoId: String(row.undo_id),
		finishedAt: (row.finished_at as string | null) ?? null,
	};
}

/** Finished jobs older than the undo window are dropped. */
export function* pruneBulkJobsQuery(now = Date.now()): Query<void> {
	(yield sqlStep(`DELETE FROM bulk_job WHERE finished_at IS NOT NULL AND finished_at < ?`, new Date(now - UNDO_TTL_MS).toISOString()));
}

// ── Labels ─────────────────────────────────────────────────────────

export interface Label {
	id: string;
	name: string;
	color: string;
	position: number;
}

export class LabelError extends Error {
	override name = "LabelError";
}

const MAX_LABEL_NAME = 60;

export function labelSlug(name: string, taken: Set<string>): string {
	const base = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "label";
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

function cleanName(name: unknown): string {
	const value = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
	if (!value) throw new LabelError("Label name is required");
	if (value.length > MAX_LABEL_NAME) throw new LabelError(`Label name is longer than ${MAX_LABEL_NAME} characters`);
	return value;
}

function cleanColor(color: unknown): string {
	if (color === undefined || color === null || color === "") return DEFAULT_LABEL_COLOR;
	if (typeof color !== "string" || !isLabelColor(color)) throw new LabelError("Pick a colour from the palette");
	return color.toLowerCase();
}

export function* allLabelsQuery(): Query<Label[]> {
	return (yield sqlStep(`SELECT id, name, color, position FROM labels ORDER BY position, name COLLATE NOCASE`)).map((r) => ({
		id: String(r.id), name: String(r.name), color: String(r.color), position: Number(r.position),
	}));
}

/** Ids of labels an agent has applied. */
function* autoLabelIdsQuery(): Query<Set<string>> {
	return new Set((yield sqlStep(`SELECT label_id FROM label_auto`)).map((r) => String(r.label_id)));
}

/**
 * Labels with the number of conversations that carry each, outside Trash and
 * Spam. `auto` is true once an agent has applied the label.
 */
export function* listLabelsQuery(): Query<(Label & { count: number; auto: boolean })[]> {
	const counts = new Map((yield sqlStep(
		`SELECT l.label_id AS id, COUNT(DISTINCT m.thread_key) AS n FROM message_labels l
		JOIN messages m ON m.id = l.message WHERE m.deleted = 0 AND m.state NOT IN ('trash', 'spam')
		GROUP BY l.label_id`,
	)).map((r) => [String(r.id), Number(r.n)]));
	const auto = (yield* autoLabelIdsQuery());
	return (yield* allLabelsQuery()).map((label) => ({ ...label, count: counts.get(label.id) ?? 0, auto: auto.has(label.id) }));
}

/** Flag labels as agent-applied. Unknown ids are skipped. Returns the ids newly flagged. */
export function* markLabelsAutoQuery(ids: string[], now = new Date().toISOString()): Query<string[]> {
	const known = new Set((yield* allLabelsQuery()).map((l) => l.id));
	const flagged: string[] = [];
	for (const id of new Set(ids)) {
		if (!known.has(id)) continue;
		const inserted = (yield sqlStep(`INSERT OR IGNORE INTO label_auto (label_id, applied_at) VALUES (?, ?) RETURNING label_id`, id, now));
		if (inserted.length > 0) flagged.push(id);
		else (yield sqlStep(`UPDATE label_auto SET applied_at = ? WHERE label_id = ?`, now, id));
	}
	return flagged;
}

export function* findLabelByNameQuery(name: string): Query<Label | null> {
	return (yield* allLabelsQuery()).find((l) => l.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}

export function* createLabelQuery(input: { name: unknown; color?: unknown; id?: string }): Query<Label> {
	const name = cleanName(input.name);
	const color = cleanColor(input.color);
	const existing = (yield* allLabelsQuery());
	if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase())) throw new LabelError(`A label named "${name}" exists`);
	const taken = new Set(existing.map((l) => l.id));
	const id = input.id && !taken.has(input.id) ? input.id : labelSlug(name, taken);
	const position = existing.reduce((max, l) => Math.max(max, l.position + 1), 0);
	(yield sqlStep(`INSERT INTO labels (id, name, color, position) VALUES (?, ?, ?, ?)`, id, name, color, position));
	return { id, name, color, position };
}

export function* updateLabelQuery(id: string, input: { name?: unknown; color?: unknown }): Query<Label | null> {
	const current = (yield* allLabelsQuery()).find((l) => l.id === id);
	if (!current) return null;
	const name = input.name === undefined ? current.name : cleanName(input.name);
	const color = input.color === undefined ? current.color : cleanColor(input.color);
	if ((yield* allLabelsQuery()).some((l) => l.id !== id && l.name.toLowerCase() === name.toLowerCase())) {
		throw new LabelError(`A label named "${name}" exists`);
	}
	(yield sqlStep(`UPDATE labels SET name = ?, color = ? WHERE id = ?`, name, color, id));
	return { ...current, name, color };
}

/** Thread keys holding a label in any state, for removing it before the definition goes. */
export function* labelThreadKeysQuery(id: string): Query<string[]> {
	return (yield sqlStep(
		`SELECT DISTINCT m.thread_key AS k FROM message_labels l JOIN messages m ON m.id = l.message
		WHERE l.label_id = ? AND m.deleted = 0`,
		id,
	)).map((r) => String(r.k));
}

export function* deleteLabelRowsQuery(id: string): Query<boolean> {
	(yield sqlStep(`DELETE FROM message_labels WHERE label_id = ?`, id));
	(yield sqlStep(`DELETE FROM label_auto WHERE label_id = ?`, id));
	return (yield sqlStep(`DELETE FROM labels WHERE id = ? RETURNING id`, id)).length > 0;
}

export function* threadKeyOfQuery(mailboxId: string, emailId: string): Query<string | null> {
	const row = (yield sqlStep(`SELECT thread_key FROM messages WHERE mailbox_id = ? AND email_id = ? AND deleted = 0`, mailboxId.toLowerCase(), emailId))[0];
	return row ? String(row.thread_key) : null;
}
