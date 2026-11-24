// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * What came of the mail an agent took (shared/agent-work.ts). A drafted run's
 * outcome is read from the mail itself: the draft still in Drafts is waiting;
 * a send with the draft's `draft:<id>` key, or a reply sent in the thread
 * after the run, is sent, and edited when the promotion record says the
 * reply was changed (agent_events); otherwise it was discarded.
 */
import type { WorkOutcome, WorkRow } from "../../shared/agent-work";
import type { Sql } from "../store/sql";

const RUN_SQL = `
	SELECT r.email_id, r.mailbox_id, r.sender, r.state, r.reason, r.draft_id, r.agent_id, r.created_at,
		COALESCE(o.subject, '') AS subject,
		(SELECT 1 FROM messages d WHERE d.email_id = r.draft_id AND d.state = 'draft') AS draft_live,
		COALESCE(
			(SELECT k.email_id FROM send_keys k WHERE k.mailbox_id = r.mailbox_id AND k.key = 'draft:' || r.draft_id AND k.state = 'sent'),
			(SELECT s.email_id FROM messages s WHERE s.mailbox_id = r.mailbox_id AND s.state = 'sent' AND o.message_id IS NOT NULL
				AND s.in_reply_to = o.message_id AND s.date >= r.created_at ORDER BY s.date LIMIT 1)
		) AS sent_id
	FROM auto_draft_runs r LEFT JOIN messages o ON o.email_id = r.email_id`;

type Raw = Record<string, unknown>;

/** Sent messages a person changed before sending, of these. */
async function editedOf(sql: Sql, agentId: string, sentIds: string[]): Promise<Set<string>> {
	if (!sentIds.length) return new Set();
	const rows = await sql.all(
		`SELECT email_id FROM agent_events WHERE agent_id = ? AND kind = 'sent' AND edited = 1 AND email_id IN (${sentIds.map(() => "?").join(", ")})`,
		agentId, ...sentIds,
	);
	return new Set(rows.map((r) => String(r.email_id)));
}

function outcomeOf(r: Raw, edited: Set<string>): WorkOutcome {
	switch (String(r.state)) {
		case "drafted":
			if (r.sent_id != null) return edited.has(String(r.sent_id)) ? "edited" : "sent";
			return r.draft_live ? "waiting" : "discarded";
		case "sent": return "sent";
		case "watched": return "watched";
		case "failed": return "failed";
		case "queued":
		case "running": return "running";
		default: return "skipped";
	}
}

async function toRows(sql: Sql, agentId: string, rows: Raw[]): Promise<WorkRow[]> {
	const edited = await editedOf(sql, agentId, rows.map((r) => r.sent_id).filter((x): x is string => x != null).map(String));
	return rows.map((r) => ({
		emailId: String(r.email_id), mailboxId: String(r.mailbox_id), sender: String(r.sender), subject: String(r.subject ?? ""),
		outcome: outcomeOf(r, edited), reason: r.reason == null ? null : String(r.reason),
		draftId: r.draft_id == null ? null : String(r.draft_id), createdAt: String(r.created_at),
	}));
}

/** A reply agent's latest runs, newest first, with the subject and what came of each. */
export async function agentWork(sql: Sql, agentId: string, limit = 100): Promise<WorkRow[]> {
	const rows = await sql.all(`${RUN_SQL} WHERE r.agent_id = ? ORDER BY r.created_at DESC LIMIT ?`, agentId, Math.min(Math.max(limit, 1), 200));
	return toRows(sql, agentId, rows);
}

/**
 * What came of these messages when they arrived, for this agent: Test on past
 * mail's "Then". A message another agent took, or that no run covers, is none.
 */
export async function thenFor(sql: Sql, agentId: string, emailIds: readonly string[]): Promise<Map<string, WorkOutcome>> {
	const out = new Map<string, WorkOutcome>();
	for (let i = 0; i < emailIds.length; i += 50) {
		const ids = emailIds.slice(i, i + 50);
		if (!ids.length) continue;
		const marks = ids.map(() => "?").join(", ");
		const runs = await sql.all(`${RUN_SQL} WHERE r.email_id IN (${marks})`, ...ids);
		const mine = runs.filter((r) => String(r.agent_id) === agentId);
		for (const row of await toRows(sql, agentId, mine)) out.set(row.emailId, row.outcome);
		for (const r of runs) if (!out.has(String(r.email_id))) out.set(String(r.email_id), String(r.state) === "failed" ? "failed" : "none");
		const acts = await sql.all(`SELECT email_id, state FROM agent_actions WHERE agent_id = ? AND email_id IN (${marks})`, agentId, ...ids);
		for (const a of acts) {
			const s = String(a.state);
			out.set(String(a.email_id), s === "done" || s === "undone" ? "done" : s === "watched" ? "watched" : s === "failed" ? "failed" : "skipped");
		}
	}
	return out;
}
