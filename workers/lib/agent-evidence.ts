// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The record behind an agent's move up a rung (WON-531, shared/agent-gates.ts):
 *
 * - Its live runs in the last 7 days (auto_draft_runs, agent_actions).
 * - Its latest Test run (agent_tests, workers/agent/test-run.ts), and whether it
 *   ran on the agent's setup as it is now (setupKey).
 * - The agent drafts a person sent, and whether each went as the agent wrote
 *   it. An agent draft keeps a fingerprint of its reply text in its notes
 *   (`written`), through edits and redrafts. When a person sends it (the send
 *   carries the `draft:<id>` idempotency key), the reply part of what was sent
 *   is fingerprinted the same way: the signature and the quoted original are
 *   left out, and whitespace and markup don't count. A redraft counts as an
 *   edit. Drafts written before this version have no fingerprint and aren't
 *   counted.
 * - Safety checks that stopped it in the last 7 days: the injection scan on
 *   mail its rules matched, and the draft check on a reply it wrote.
 */
import type { AgentEvidence } from "../../shared/agent-gates";
import { setupKey } from "../../shared/agent-test";
import { getAgent } from "./agents";
import type { DraftNotes } from "../../shared/draft-notes";
import type { Sql } from "../store/sql";
import { htmlToText } from "./message-meta";

/** The composer's signature block (app/lib/utils.ts, getSignatureBlock). */
const SIGNATURE_OPEN = `<div style="border-top: 1px solid #ccc; margin-top: 16px; padding-top: 12px;">`;

/** The reply part of a draft or a sent message: no quoted original, no signature, plain text with single spaces. */
export function replyText(html: string): string {
	let reply = String(html ?? "");
	const quote = reply.search(/<blockquote\b/i);
	if (quote >= 0) reply = reply.slice(0, quote);
	const signature = reply.lastIndexOf(SIGNATURE_OPEN);
	if (signature >= 0) reply = reply.slice(0, signature);
	return htmlToText(reply);
}

/** A fingerprint of the reply part, to tell whether a draft was sent as written. */
export async function replyFingerprint(html: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(replyText(html)));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The agent with this name, matched without case, as the draft's notes name it. */
async function agentIdNamed(sql: Sql, name: string): Promise<string | null> {
	const row = await sql.first(`SELECT id FROM agents WHERE lower(name) = lower(?)`, name.trim());
	return row ? String(row.id) : null;
}

/**
 * A person sent an agent draft: record whether it went as written. Returns what
 * was recorded, or null for a draft that isn't an agent's or has no fingerprint.
 * A send repeated with the same key records once.
 */
export async function recordDraftSent(sql: Sql, notes: DraftNotes | null, sentHtml: string, sentId: string, now = Date.now()): Promise<{ agentId: string; edited: boolean } | null> {
	if (!notes || notes.origin !== "auto-draft" || !notes.agent || !notes.written) return null;
	const agentId = await agentIdNamed(sql, notes.agent);
	if (!agentId) return null;
	const edited = (await replyFingerprint(sentHtml)) !== notes.written || notes.instructions.length > 0;
	await sql.run(
		`INSERT INTO agent_events (agent_id, kind, email_id, edited, at) VALUES (?, 'sent', ?, ?, ?) ON CONFLICT (agent_id, kind, email_id) DO NOTHING`,
		agentId, sentId, edited ? 1 : 0, new Date(now).toISOString(),
	);
	return { agentId, edited };
}

/** A safety check stopped this agent's mail or reply. One record per agent and message. */
export async function recordSafety(sql: Sql, agentIds: readonly string[], emailId: string, reason: string, now = Date.now()): Promise<void> {
	if (agentIds.length === 0) return;
	await sql.batch(agentIds.map((agentId) => ({
		sql: `INSERT INTO agent_events (agent_id, kind, email_id, reason, at) VALUES (?, 'safety', ?, ?, ?) ON CONFLICT (agent_id, kind, email_id) DO NOTHING`,
		params: [agentId, emailId, reason.slice(0, 300), new Date(now).toISOString()],
	})));
}

/** Same as recordSafety, for an agent the model named. */
export async function recordSafetyNamed(sql: Sql, name: string, emailId: string, reason: string, now = Date.now()): Promise<void> {
	const id = await agentIdNamed(sql, name);
	if (id) await recordSafety(sql, [id], emailId, reason, now);
}

/** Whether a skip reason is a safety check stopping the mail, as opposed to a read error or a missing address. */
export const isSafetyReason = (reason: string) => /injection|too long to scan/i.test(reason);

export async function deleteAgentEvents(sql: Sql, agentId: string): Promise<void> {
	await sql.run(`DELETE FROM agent_events WHERE agent_id = ?`, agentId);
}

/** Everything one agent's gates read. */
export async function agentEvidence(sql: Sql, agentId: string, now = Date.now()): Promise<AgentEvidence> {
	const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
	const [runs, actions, test, sent, safety] = await Promise.all([
		sql.all(`SELECT state, COUNT(*) AS n FROM auto_draft_runs WHERE agent_id = ? AND created_at >= ? GROUP BY state`, agentId, weekAgo),
		sql.all(`SELECT state, COUNT(*) AS n FROM agent_actions WHERE agent_id = ? AND created_at >= ? GROUP BY state`, agentId, weekAgo),
		sql.first(
			`SELECT t.id, t.state, t.started_at, t.finished_at, t.setup,
				(SELECT COUNT(*) FROM agent_test_results r WHERE r.test_id = t.id AND r.outcome NOT IN ('pending', 'running')) AS tested,
				(SELECT COUNT(*) FROM agent_test_results r WHERE r.test_id = t.id AND r.outcome = 'failed') AS failed
			FROM agent_tests t WHERE t.agent_id = ?`,
			agentId,
		),
		sql.first(`SELECT COUNT(*) AS sent, SUM(CASE WHEN edited = 0 THEN 1 ELSE 0 END) AS unedited FROM agent_events WHERE agent_id = ? AND kind = 'sent'`, agentId),
		sql.all(`SELECT at, reason FROM agent_events WHERE agent_id = ? AND kind = 'safety' AND at >= ? ORDER BY at DESC`, agentId, weekAgo),
	]);
	const agent = test ? await getAgent(sql, agentId) : null;
	const count = (rows: Record<string, unknown>[], states: string[]) => rows.filter((r) => states.includes(String(r.state))).reduce((n, r) => n + Number(r.n), 0);
	return {
		week: {
			matched: count(runs, ["watched", "drafted", "sent"]) + count(actions, ["watched", "done", "undone"]),
			failed: count(runs, ["failed"]) + count(actions, ["failed"]),
		},
		test: test ? {
			id: String(test.id), state: String(test.state) as "running" | "done" | "stopped", tested: Number(test.tested ?? 0), failed: Number(test.failed ?? 0),
			startedAt: String(test.started_at), finishedAt: test.finished_at == null ? null : String(test.finished_at),
			current: !!agent && test.setup != null && String(test.setup) === setupKey(agent),
		} : null,
		drafts: { sent: Number(sent?.sent ?? 0), unedited: Number(sent?.unedited ?? 0) },
		safety: { count: safety.length, latest: safety.slice(0, 5).map((r) => ({ at: String(r.at), reason: String(r.reason ?? "") })) },
	};
}
