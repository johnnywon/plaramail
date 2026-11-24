// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The approval queue (WON-532), in D1 (migration 0017). An agent or MCP
 * client with Hold for approval on queues its sends and bulk changes here
 * instead of making them. A person approves or drops each one in Console >
 * Approvals. Approve runs the call then, so a send counts toward the daily
 * limit when it is approved, not when it is queued. An item left 24 hours
 * is dropped and logged.
 *
 * What a queued call runs is in workers/lib/approval-run.ts.
 */
import { agentHoldDefault, type HoldKind, QUEUE_TTL_MS, type QueueItem, type QueueKind } from "../../shared/approvals";
import type { Sql } from "../store/sql";
import { logActivity } from "./activity";

export type { QueueItem };

const ITEM_COLUMNS = "id, kind, actor, source_id, source_name, tool, mailbox_id, summary, messages, state, result, created_at, expires_at, decided_at";

const toItem = (r: Record<string, unknown>): QueueItem => ({
	id: String(r.id),
	kind: String(r.kind) as QueueKind,
	actor: String(r.actor) as HoldKind,
	sourceId: String(r.source_id),
	sourceName: r.source_name == null ? null : String(r.source_name),
	tool: String(r.tool),
	mailboxId: r.mailbox_id == null ? null : String(r.mailbox_id),
	summary: String(r.summary),
	messages: r.messages == null ? null : Number(r.messages),
	state: String(r.state) as QueueItem["state"],
	result: r.result == null ? null : String(r.result),
	createdAt: String(r.created_at),
	expiresAt: String(r.expires_at),
	decidedAt: r.decided_at == null ? null : String(r.decided_at),
});

// ── Hold for approval switches ─────────────────────────────────────

/** The switch as someone set it, or null when it was never set and the default applies. */
async function heldSetting(sql: Sql, kind: HoldKind, id: string): Promise<boolean | null> {
	const row = await sql.first(`SELECT hold FROM approval_holds WHERE kind = ? AND subject_id = ?`, kind, id);
	return row ? Number(row.hold) === 1 : null;
}

export async function setHold(sql: Sql, kind: HoldKind, id: string, hold: boolean, now = Date.now()): Promise<void> {
	await sql.run(
		`INSERT INTO approval_holds (kind, subject_id, hold, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (kind, subject_id) DO UPDATE SET hold = excluded.hold, updated_at = excluded.updated_at`,
		kind, id, hold ? 1 : 0, new Date(now).toISOString(),
	);
}

/** Whether an MCP client's sends and bulk changes wait for approval. Off unless someone turned it on. */
export async function holdsMcp(sql: Sql, clientId: string): Promise<boolean> {
	return (await heldSetting(sql, "mcp", clientId)) ?? false;
}

/** Whether an agent's sends and bulk changes wait for approval: the switch, else on for its first 7 days in Send. */
export async function holdsAgent(sql: Sql, agent: { id: string; mode: string; sendSince: string | null }, now = Date.now()): Promise<boolean> {
	return (await heldSetting(sql, "agent", agent.id)) ?? agentHoldDefault(agent, now);
}

/** Every switch someone set, by kind and id. */
export async function listHolds(sql: Sql): Promise<Record<HoldKind, Record<string, boolean>>> {
	const out: Record<HoldKind, Record<string, boolean>> = { agent: {}, mcp: {} };
	for (const r of await sql.all(`SELECT kind, subject_id, hold FROM approval_holds ORDER BY kind, subject_id`)) {
		const kind = String(r.kind) as HoldKind;
		if (kind in out) out[kind][String(r.subject_id)] = Number(r.hold) === 1;
	}
	return out;
}

// ── The queue ──────────────────────────────────────────────────────

export interface EnqueueInput {
	kind: QueueKind;
	actor: HoldKind;
	sourceId: string;
	sourceName?: string | null;
	tool: string;
	mailboxId?: string | null;
	summary: string;
	messages?: number | null;
	/** The call's arguments, run again on approval. */
	payload: unknown;
	/** A retry of the same call (same send key or draft) finds the waiting item instead of queueing again. */
	dedupeKey?: string | null;
}

/** Queue a call. A retry of one still waiting returns that item with `existing: true`. */
export async function enqueue(sql: Sql, input: EnqueueInput, now = Date.now()): Promise<{ item: QueueItem; existing: boolean }> {
	if (input.dedupeKey) {
		const row = await sql.first(`SELECT ${ITEM_COLUMNS} FROM approval_queue WHERE dedupe_key = ?`, input.dedupeKey);
		if (row) return { item: toItem(row), existing: true };
	}
	const rows = await sql.all(
		`INSERT INTO approval_queue (id, kind, actor, source_id, source_name, tool, mailbox_id, summary, messages, payload, dedupe_key, state, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)
		ON CONFLICT (dedupe_key) DO NOTHING
		RETURNING ${ITEM_COLUMNS}`,
		crypto.randomUUID(), input.kind, input.actor, input.sourceId, input.sourceName ?? null, input.tool,
		input.mailboxId?.toLowerCase() ?? null, input.summary.slice(0, 300), input.messages ?? null,
		JSON.stringify(input.payload ?? {}), input.dedupeKey ?? null,
		new Date(now).toISOString(), new Date(now + QUEUE_TTL_MS).toISOString(),
	);
	if (rows.length) return { item: toItem(rows[0]), existing: false };
	// Lost a race with the same call: return the one that won.
	const row = await sql.first(`SELECT ${ITEM_COLUMNS} FROM approval_queue WHERE dedupe_key = ?`, input.dedupeKey ?? "");
	if (!row) throw new Error("Could not queue the call");
	return { item: toItem(row), existing: true };
}

const EXPIRED = "Expired after 24 hours";

/** Drop every waiting item past its 24 hours and log each. Returns how many. */
export async function expireQueue(sql: Sql, now = Date.now()): Promise<number> {
	const at = new Date(now).toISOString();
	const rows = await sql.all(
		`UPDATE approval_queue SET state = 'dropped', result = ?, decided_at = ?, dedupe_key = NULL, payload = '{}'
		WHERE state = 'waiting' AND expires_at <= ? RETURNING ${ITEM_COLUMNS}`,
		EXPIRED, at, at,
	);
	for (const r of rows) {
		const item = toItem(r);
		await logActivity(sql, {
			actor: item.actor === "mcp" ? "mcp" : "auto-draft", client: item.sourceName, tool: "drop_queued",
			mailboxId: item.mailboxId, target: item.id, summary: `${item.summary} · ${EXPIRED}`, ok: true,
		}, now);
	}
	return rows.length;
}

/** Waiting items, oldest first, and the latest decided ones. Items past their 24 hours are dropped first. */
export async function listQueue(sql: Sql, now = Date.now(), recentLimit = 20): Promise<{ waiting: QueueItem[]; recent: QueueItem[] }> {
	await expireQueue(sql, now);
	const waiting = await sql.all(`SELECT ${ITEM_COLUMNS} FROM approval_queue WHERE state IN ('waiting', 'running') ORDER BY created_at, id LIMIT 200`);
	const recent = await sql.all(
		`SELECT ${ITEM_COLUMNS} FROM approval_queue WHERE state NOT IN ('waiting', 'running') ORDER BY decided_at DESC, id LIMIT ?`,
		Math.min(Math.max(recentLimit, 1), 100),
	);
	return { waiting: waiting.map(toItem), recent: recent.map(toItem) };
}

/** Runs a queued call: the tool's own result, `{ error }` when it refused. */
export type RunQueued = (item: QueueItem, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** A short word for what an approved call did. */
function outcome(result: Record<string, unknown>): string {
	if (typeof result.status === "string") return result.status;
	return "done";
}

/**
 * Approve or drop a waiting item, once. Approve claims it before running, so a
 * double click runs the call one time. 404 when there is no such item, 409
 * when it was already decided or has expired.
 */
export async function decide(
	sql: Sql,
	id: string,
	decision: "approve" | "drop",
	run: RunQueued,
	now = Date.now(),
): Promise<{ item: QueueItem } | { error: string; status: 404 | 409 }> {
	await expireQueue(sql, now);
	const at = new Date(now).toISOString();
	if (decision === "drop") {
		const row = (await sql.all(
			`UPDATE approval_queue SET state = 'dropped', result = 'Dropped', decided_at = ?, dedupe_key = NULL, payload = '{}'
			WHERE id = ? AND state = 'waiting' RETURNING ${ITEM_COLUMNS}`,
			at, id,
		))[0];
		if (!row) return refusal(sql, id);
		const item = toItem(row);
		await logActivity(sql, {
			actor: "person", client: item.sourceName, tool: "drop_queued", mailboxId: item.mailboxId, target: item.id,
			summary: `${item.summary} · Dropped`, ok: true,
		}, now);
		return { item };
	}

	const claimed = (await sql.all(
		`UPDATE approval_queue SET state = 'running', decided_at = ? WHERE id = ? AND state = 'waiting' RETURNING payload, ${ITEM_COLUMNS}`,
		at, id,
	))[0];
	if (!claimed) return refusal(sql, id);
	const item = toItem(claimed);
	let payload: Record<string, unknown> = {};
	try {
		payload = JSON.parse(String(claimed.payload ?? "{}"));
	} catch { /* an unreadable payload fails below */ }
	let state: "approved" | "failed";
	let result: string;
	try {
		const out = await run(item, payload);
		const error = typeof out.error === "string" ? out.error : null;
		state = error ? "failed" : "approved";
		result = error ?? outcome(out);
	} catch (e) {
		state = "failed";
		result = (e as Error).message || "Failed";
	}
	const row = (await sql.all(
		`UPDATE approval_queue SET state = ?, result = ?, dedupe_key = NULL, payload = '{}' WHERE id = ? RETURNING ${ITEM_COLUMNS}`,
		state, result.slice(0, 500), id,
	))[0];
	return { item: toItem(row) };
}

async function refusal(sql: Sql, id: string): Promise<{ error: string; status: 404 | 409 }> {
	const row = await sql.first(`SELECT state, result FROM approval_queue WHERE id = ?`, id);
	if (!row) return { error: "Not found", status: 404 };
	return { error: row.result === EXPIRED ? EXPIRED : "Already decided", status: 409 };
}

// ── Bulk size ──────────────────────────────────────────────────────

/** Messages in these conversations: what one bulk call moves, labels or marks. */
export async function messagesIn(sql: Sql, threadKeys: readonly string[]): Promise<number> {
	if (threadKeys.length === 0) return 0;
	const row = await sql.first(
		`SELECT COUNT(*) AS n FROM messages WHERE deleted = 0 AND thread_key IN (SELECT value FROM json_each(?))`,
		JSON.stringify([...new Set(threadKeys)]),
	);
	return Number(row?.n ?? 0);
}
