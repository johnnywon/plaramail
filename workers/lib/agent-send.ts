// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Send mode (WON-534): what an agent in Send does with the reply it wrote, and
 * what runs when a person approves a reply that was held.
 *
 * The rules (docs/console-0.9.md):
 * - Send is open only from SEND_VERSION (shared/agent.ts, SEND_OPEN).
 * - A reply goes only to the sender of the message the agent took: one
 *   recipient, that sender, no Cc or Bcc. Anything else stays a draft.
 * - The daily limit (25 by default) and two a day to one sender. Only sends
 *   count, so a held reply counts when it is approved.
 * - Hold for approval (workers/lib/approvals.ts) is on by default for an
 *   agent's first 7 days in Send. A held reply waits in Console > Approvals
 *   as a draft; approving it checks the agent and its limits again.
 * - The safety checks run before this: the injection scan on the mail and the
 *   draft check on the reply (workers/agent/index.ts).
 * A reply that can't go out stays in Drafts with the reason on its run.
 */
import type { QueueItem } from "../../shared/approvals";
import type { DraftOutcome } from "../agent/runs";
import type { Sql } from "../store/sql";
import { type Agent, agentSendsToday, getAgent, SEND_ENABLED } from "./agents";
import { enqueue, holdsAgent } from "./approvals";

/** The draft fields the send rules read. */
export interface AgentDraft {
	recipient: string | null;
	cc?: string | null;
	bcc?: string | null;
	subject?: string | null;
}

export interface AgentSendDeps {
	sql: Sql;
	getDraft: (mailboxId: string, draftId: string) => Promise<AgentDraft | null>;
	/** Sends the draft as the agent: toolSendDraft. `{ error }` when it refused. */
	sendDraft: (mailboxId: string, draftId: string) => Promise<Record<string, unknown>>;
	/** SEND_ENABLED unless a test says otherwise. */
	enabled?: boolean;
	now?: number;
}

/** The message the agent took: where it is and who sent it. */
export interface SendTarget {
	mailboxId: string;
	emailId: string;
	sender: string;
}

/** What an approved held reply runs with. */
export interface HeldReply {
	mailboxId: string;
	draftId: string;
	emailId: string;
	sender: string;
}

const addresses = (value: string | null | undefined) =>
	(value ?? "").split(",").map((a) => (/<([^>]+)>/.exec(a)?.[1] ?? a).trim().toLowerCase()).filter(Boolean);

/** Why the draft can't go out as an agent's reply, or null when it goes only to the sender. */
export function notOnlyToSender(draft: AgentDraft, sender: string): string | null {
	const to = addresses(draft.recipient);
	if (addresses(draft.cc).length || addresses(draft.bcc).length) return "it has Cc or Bcc; an agent replies only to the sender";
	if (to.length !== 1 || to[0] !== sender.trim().toLowerCase()) return "it isn't addressed to the sender alone; an agent replies only to the sender";
	return null;
}

/** Why the agent may not send to this sender now, or null when it may. */
async function overLimit(sql: Sql, agent: Agent, sender: string, now: number): Promise<string | null> {
	const sends = await agentSendsToday(sql, agent.id, sender, now);
	if (sends.total >= agent.dailyLimit) return `daily limit of ${agent.dailyLimit} reached`;
	if (sends.toSender >= agent.perSenderLimit) return `replied to this sender ${sends.toSender} times today`;
	return null;
}

/**
 * An agent in Send with the reply it drafted: send it, hold it for approval,
 * or keep it as a draft and say why.
 */
export async function sendAsAgent(deps: AgentSendDeps, agent: Agent, draftId: string, target: SendTarget): Promise<DraftOutcome> {
	const now = deps.now ?? Date.now();
	const kept = (reason: string): DraftOutcome => ({ status: "drafted", draftId, agentId: agent.id, reason });
	if (!(deps.enabled ?? SEND_ENABLED)) return kept("Send is not open in this version; kept as a draft");
	const limit = await overLimit(deps.sql, agent, target.sender, now);
	if (limit) return kept(`${limit}; kept as a draft`);
	const draft = await deps.getDraft(target.mailboxId, draftId);
	if (!draft) return kept("not sent: Draft not found");
	const stray = notOnlyToSender(draft, target.sender);
	if (stray) return kept(`not sent: ${stray}`);
	if (await holdsAgent(deps.sql, agent, now)) {
		const payload: HeldReply = { mailboxId: target.mailboxId, draftId, emailId: target.emailId, sender: target.sender.toLowerCase() };
		await enqueue(deps.sql, {
			kind: "send", actor: "agent", sourceId: agent.id, sourceName: agent.name, tool: "send_draft", mailboxId: target.mailboxId,
			summary: `to ${target.sender} · ${draft.subject || "(no subject)"}`, payload,
			dedupeKey: `agent:${agent.id}:draft:${target.mailboxId}:${draftId}`,
		}, now);
		return kept("held for approval in Console > Approvals");
	}
	const result = await deps.sendDraft(target.mailboxId, draftId);
	if (typeof result.error === "string") return kept(`not sent: ${result.error}`);
	return { status: "sent", draftId: null, agentId: agent.id };
}

/**
 * Approve a held agent reply: the agent must still exist and be in Send, the
 * reply still only to the sender, and within today's limits. Then it is sent
 * and its run is marked sent, so it counts toward the limits from now.
 */
export async function runHeldReply(deps: AgentSendDeps, item: Pick<QueueItem, "sourceId">, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const now = deps.now ?? Date.now();
	const held: HeldReply = {
		mailboxId: String(args.mailboxId ?? ""), draftId: String(args.draftId ?? ""),
		emailId: String(args.emailId ?? ""), sender: String(args.sender ?? ""),
	};
	if (!(deps.enabled ?? SEND_ENABLED)) return { error: "Send is not open in this version" };
	const agent = await getAgent(deps.sql, item.sourceId);
	if (!agent) return { error: "The agent was deleted" };
	// The stored mode: getAgent reads Send as Draft while Send is closed, and the check above already covers that.
	const stored = await deps.sql.first(`SELECT mode FROM agents WHERE id = ?`, agent.id);
	if (stored?.mode !== "send" || !agent.enabled) return { error: "The agent is no longer in Send" };
	if (!held.sender) return { error: "The held reply has no sender" };
	const limit = await overLimit(deps.sql, agent, held.sender, now);
	if (limit) return { error: `Not sent: ${limit}` };
	const draft = await deps.getDraft(held.mailboxId, held.draftId);
	if (!draft) return { error: "Draft not found" };
	const stray = notOnlyToSender(draft, held.sender);
	if (stray) return { error: `Not sent: ${stray}` };
	const result = await deps.sendDraft(held.mailboxId, held.draftId);
	if (typeof result.error === "string") return result;
	await deps.sql.run(
		`UPDATE auto_draft_runs SET state = 'sent', draft_id = NULL, reason = NULL, updated_at = ? WHERE email_id = ? AND agent_id = ? AND draft_id = ?`,
		new Date(now).toISOString(), held.emailId, agent.id, held.draftId,
	);
	return result;
}
