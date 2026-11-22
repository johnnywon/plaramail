// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * What a bulk action does to a list row before the server answers. Returns
 * the patched row, or null when the row no longer belongs in the view.
 */

import { BULK_MAX_THREADS } from "../../shared/bulk";
import { type MailFilter, type MatchableRow, matchesFilter } from "./mail-filter";

export { BULK_MAX_THREADS };

export const MOVE_FOLDERS = ["inbox", "archive", "spam", "trash"] as const;
export type MoveFolder = (typeof MOVE_FOLDERS)[number];

export type BulkAction =
	| { type: "archive" | "trash" | "restore" | "read" | "unread" | "star" | "unstar" }
	| { type: "move"; folder: MoveFolder }
	| { type: "label_add" | "label_remove"; labelId: string };

const MOVE_TARGET: Record<string, string> = { archive: "archive", trash: "trash", restore: "inbox" };

/** Same rule as the server: moves take messages from this state. */
export function sourceState(view: string): string {
	if (view === "drafts") return "draft";
	if (view === "unread" || view === "starred" || view === "all") return "inbox";
	return view;
}

/** Move targets that change something from this view. */
export function moveTargets(view: string): MoveFolder[] {
	const from = sourceState(view);
	return MOVE_FOLDERS.filter((f) => f !== from);
}

/**
 * Read toggles: when every target is read it marks unread, otherwise read.
 * `all` carries the unread count when every matching conversation is targeted.
 */
export function readToggle(rows: readonly { thread_unread_count: number }[], all?: { unread: number }): BulkAction {
	const allRead = all ? all.unread === 0 : rows.length > 0 && rows.every((r) => r.thread_unread_count === 0);
	return { type: allRead ? "unread" : "read" };
}

/** Star toggles: when every target is starred it unstars, otherwise stars. */
export function starToggle(rows: readonly { starred: boolean }[]): BulkAction {
	return { type: rows.length > 0 && rows.every((r) => r.starred) ? "unstar" : "star" };
}

export function applyAction<T extends MatchableRow & { thread_unread_count: number }>(
	row: T,
	action: BulkAction,
	filter: MailFilter,
): T | null {
	let next: T = row;
	const target = action.type === "move" ? action.folder : MOVE_TARGET[action.type];
	if (target) {
		if (row.state === sourceState(filter.view) && row.state !== target) next = { ...row, state: target };
	} else if (action.type === "read" || action.type === "unread") {
		const unread = action.type === "unread";
		next = { ...row, unread, thread_unread_count: unread ? Math.max(row.thread_unread_count, 1) : 0 };
	} else if (action.type === "star" || action.type === "unstar") {
		next = { ...row, starred: action.type === "star" };
	} else if (action.type === "label_add") {
		next = row.labels.includes(action.labelId) ? row : { ...row, labels: [...row.labels, action.labelId].sort() };
	} else if (action.type === "label_remove") {
		next = { ...row, labels: row.labels.filter((l) => l !== action.labelId) };
	}
	return matchesFilter(next, filter) ? next : null;
}

type ThreadTarget = { threadKeys: string[]; view: string; filter?: string };
type BatchResult = { affected: number; undoId: string; failed?: { mailboxId: string; error: string }[] };

/** What a bulk action did, over every batch it took. */
export interface BulkOutcome {
	affected: number;
	undoIds: string[];
	failed: { mailboxId: string; error: string }[];
}

/**
 * Send a bulk action on selected conversations, in batches of at most
 * BULK_MAX_THREADS, one after another. Undo reverses every batch.
 */
export async function sendBulk(
	send: (target: ThreadTarget, action: BulkAction) => Promise<BatchResult>,
	target: ThreadTarget,
	action: BulkAction,
): Promise<BulkOutcome> {
	const out: BulkOutcome = { affected: 0, undoIds: [], failed: [] };
	for (let i = 0; i < target.threadKeys.length; i += BULK_MAX_THREADS) {
		const result = await send({ ...target, threadKeys: target.threadKeys.slice(i, i + BULK_MAX_THREADS) }, action);
		out.affected += result.affected;
		if (result.undoId) out.undoIds.push(result.undoId);
		out.failed.push(...(result.failed ?? []));
	}
	return out;
}
