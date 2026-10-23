// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Action agents: an agent that stars, labels, archives or marks read instead
 * of replying (docs/console-0.9.md, "Action agents").
 *
 * - An action agent with rules acts as soon as they pass, with no model call
 *   (actFirst). One with no rules gets a tool in the drafting run and the
 *   model says whether its job fits (workers/agent/auto-draft.ts).
 * - Each agent acts on a message once: agent_actions has one row per agent
 *   and message, so a retried run does nothing the second time.
 * - Watch records what it would do. On does it, inside the agent's daily limit.
 * - Every action is in Console > Activity, and a done action has Undo for
 *   UNDO_DAYS: unstar, remove the label, back to the inbox, mark unread.
 * - Action agents don't compete: every one that fits acts, and none stops
 *   the reply agent that takes the message.
 */
import type { Unmatched } from "../../shared/prefs";
import { mailStore, recordsSql } from "../store";
import type { Sql } from "../store/sql";
import type { Env } from "../types";
import { logActivity } from "./activity";
import { type Agent, type AgentAction, type InboundMail, type InboundPlan, isAction, matchAgents, planInbound } from "./agents";
import { toolLabelConversation, toolMarkEmailRead, toolStarConversation } from "./tools";

/** The drafting run's tool for each action. */
export const ACTION_TOOLS: Record<AgentAction, string> = {
	star: "star_email",
	label: "label_email",
	archive: "archive_email",
	mark_read: "mark_read",
};

/** Undo is offered this long after an action. */
export const UNDO_DAYS = 30;

export type ActionState = "watched" | "done" | "undone" | "limited" | "failed";

/** The mail changes actions make, and their reverse when `on` is false. Each returns `{ error }` when it fails. */
export interface MailOps {
	star(mailboxId: string, emailId: string, on: boolean): Promise<unknown>;
	label(mailboxId: string, emailId: string, labelId: string, on: boolean): Promise<unknown>;
	archive(mailboxId: string, emailId: string, on: boolean): Promise<unknown>;
	read(mailboxId: string, emailId: string, on: boolean): Promise<unknown>;
}

/** The ops on a deployment's mail. Star, label and archive act on the conversation, as the app does; mark read on the message. */
export function mailOps(env: Env): MailOps {
	return {
		star: (m, e, on) => toolStarConversation(env, m, e, on),
		label: (m, e, labelId, on) => toolLabelConversation(env, m, e, on ? { add: [labelId] } : { remove: [labelId] }),
		archive: async (m, e, on) => {
			const index = mailStore(env).all();
			const threadKey = await index.threadKeyOf(m, e);
			if (!threadKey) return { error: "Email not found" };
			const result = on
				? await index.bulk({ threadKeys: [threadKey], view: "inbox" }, { type: "archive" })
				: await index.bulk({ threadKeys: [threadKey], view: "archive" }, { type: "move", folder: "inbox" });
			const failure = "failed" in result ? result.failed?.[0] : undefined;
			return failure ? { error: failure.error } : { status: on ? "archived" : "moved to inbox" };
		},
		read: (m, e, on) => toolMarkEmailRead(env, m, e, on),
	};
}

/** The deps for a deployment: its records database, its mail and its label names. */
export function envActionDeps(env: Env): ActionDeps {
	return {
		sql: recordsSql(env),
		ops: mailOps(env),
		labelName: async (labelId) => (await mailStore(env).all().listLabels()).find((l) => l.id === labelId)?.name ?? null,
	};
}

/** What an action is called in the log: "star", "add label Invoices". `label` is the label's name, when known. */
export function actionText(does: AgentAction, label?: string | null): string {
	switch (does) {
		case "star": return "star";
		case "label": return label ? `add label ${label}` : "add a label";
		case "archive": return "archive";
		case "mark_read": return "mark read";
	}
}

const DONE: Record<AgentAction, string> = { star: "starred", label: "labelled", archive: "archived", mark_read: "marked read" };
const UNDONE: Record<AgentAction, string> = { star: "unstarred", label: "label removed", archive: "moved back to the inbox", mark_read: "marked unread" };

function run(ops: MailOps, does: AgentAction, mailboxId: string, emailId: string, labelId: string | null, on: boolean): Promise<unknown> {
	switch (does) {
		case "star": return ops.star(mailboxId, emailId, on);
		case "label": return ops.label(mailboxId, emailId, labelId ?? "", on);
		case "archive": return ops.archive(mailboxId, emailId, on);
		case "mark_read": return ops.read(mailboxId, emailId, on);
	}
}

const errorOf = (result: unknown) => {
	const error = result && typeof result === "object" ? (result as { error?: unknown }).error : null;
	return typeof error === "string" && error ? error : null;
};

/** Done actions by this agent in the last 24 hours. */
export async function actionsToday(sql: Sql, agentId: string, now = Date.now()): Promise<number> {
	const row = await sql.first(
		`SELECT COUNT(*) AS n FROM agent_actions WHERE agent_id = ? AND state IN ('done', 'undone') AND created_at >= ?`,
		agentId, new Date(now - 86_400_000).toISOString(),
	);
	return Number(row?.n ?? 0);
}

export interface ActionResult {
	agent: string;
	/** "repeat": the agent already acted on this message. */
	state: ActionState | "repeat";
	id: string | null;
	error?: string;
}

export interface ActionDeps {
	sql: Sql;
	ops: MailOps;
	/** Label names by id, for the log. */
	labelName?: (labelId: string) => Promise<string | null>;
	now?: number;
}

/**
 * One action agent on one message. Watch records what it would do; On does
 * it unless the daily limit is reached. A second call for the same agent and
 * message does nothing. Failures are recorded, not thrown.
 */
export async function runAgentAction(deps: ActionDeps, agent: Agent, mail: { mailboxId: string; emailId: string }): Promise<ActionResult> {
	if (!isAction(agent.does) || (agent.mode !== "watch" && agent.mode !== "on")) return { agent: agent.name, state: "failed", id: null, error: "not an action agent" };
	const does = agent.does;
	const now = deps.now ?? Date.now();
	const mailboxId = mail.mailboxId.toLowerCase();
	const limited = agent.mode === "on" && await actionsToday(deps.sql, agent.id, now) >= agent.dailyLimit;
	const state: ActionState = agent.mode === "watch" ? "watched" : limited ? "limited" : "failed";
	const id = crypto.randomUUID();
	// Claim the message for this agent first: a second run finds the row and stops.
	const claimed = await deps.sql.all(
		`INSERT INTO agent_actions (id, agent_id, agent_name, mailbox_id, email_id, does, label_id, state, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (agent_id, email_id) DO NOTHING RETURNING id`,
		id, agent.id, agent.name, mailboxId, mail.emailId, does, agent.labelId, state, new Date(now).toISOString(),
	);
	if (claimed.length === 0) return { agent: agent.name, state: "repeat", id: null };

	const label = does === "label" && agent.labelId ? (await deps.labelName?.(agent.labelId).catch(() => null)) ?? null : null;
	const what = actionText(does, label);
	const log = (summary: string, ok: boolean, actionId: string | null = null) => logActivity(deps.sql, {
		actor: "auto-draft", tool: ACTION_TOOLS[does], mailboxId, target: mail.emailId, summary: `${agent.name} · ${summary}`, ok, actionId,
	}, now);

	if (state === "watched") {
		await log(`Would ${what}`, true);
		return { agent: agent.name, state, id };
	}
	if (state === "limited") {
		const reason = `daily limit of ${agent.dailyLimit} reached`;
		await deps.sql.run(`UPDATE agent_actions SET reason = ? WHERE id = ?`, reason, id);
		await log(`did not ${what}, ${reason}`, false);
		return { agent: agent.name, state, id, error: reason };
	}
	let error: string | null;
	try {
		error = errorOf(await run(deps.ops, does, mailboxId, mail.emailId, agent.labelId, true));
	} catch (e) {
		error = (e as Error).message || "failed";
	}
	await deps.sql.run(`UPDATE agent_actions SET state = ?, reason = ? WHERE id = ?`, error ? "failed" : "done", error, id);
	await log(error ? `did not ${what}, ${error}` : label ? `${DONE[does]} ${label}` : DONE[does], !error, error ? null : id);
	return error ? { agent: agent.name, state: "failed", id, error } : { agent: agent.name, state: "done", id };
}

export interface FirstPass {
	plan: InboundPlan;
	/** What the action agents with rules did. */
	acted: ActionResult[];
	/** Whether the message still needs the model: a reply agent took it, an action agent without rules waits on it, or unmatched mail gets a draft. */
	needsModel: boolean;
}

/**
 * Before any model call: match the agents' rules, and let every action agent
 * whose rules passed act. Says whether the model still has work to do.
 */
export async function actFirst(
	deps: ActionDeps,
	agents: readonly Agent[],
	unmatched: Unmatched,
	mail: InboundMail & { emailId: string },
): Promise<FirstPass> {
	const plan = planInbound(matchAgents(agents, mail));
	const acted: ActionResult[] = [];
	for (const agent of plan.act) acted.push(await runAgentAction(deps, agent, mail));
	// An action never stops a reply: with no reply agent, unmatched mail still gets the fallback draft when prefs say so.
	return { plan, acted, needsModel: plan.reply.length > 0 || plan.ask.length > 0 || unmatched !== "leave" };
}

/** One line for the run's reason: what the action agents did. */
export function actedText(acted: readonly ActionResult[]): string {
	const lines = acted.filter((a) => a.state !== "repeat").map((a) => `${a.agent} ${a.state === "watched" ? "watched" : a.state === "done" ? "acted" : a.state}`);
	return lines.join(", ");
}

export interface ActionRow {
	id: string;
	agentId: string;
	agentName: string;
	mailboxId: string;
	emailId: string;
	does: AgentAction;
	labelId: string | null;
	state: ActionState;
	reason: string | null;
	createdAt: string;
	undoneAt: string | null;
}

const toRow = (r: Record<string, unknown>): ActionRow => ({
	id: String(r.id), agentId: String(r.agent_id), agentName: String(r.agent_name), mailboxId: String(r.mailbox_id), emailId: String(r.email_id),
	does: String(r.does) as AgentAction, labelId: r.label_id == null ? null : String(r.label_id), state: String(r.state) as ActionState,
	reason: r.reason == null ? null : String(r.reason), createdAt: String(r.created_at), undoneAt: r.undone_at == null ? null : String(r.undone_at),
});

const ROW = "id, agent_id, agent_name, mailbox_id, email_id, does, label_id, state, reason, created_at, undone_at";

/** One agent's latest actions, newest first, for its page in the Console. */
export async function listAgentActions(sql: Sql, agentId: string, limit = 50): Promise<ActionRow[]> {
	return (await sql.all(`SELECT ${ROW} FROM agent_actions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`, agentId, Math.min(Math.max(limit, 1), 200))).map(toRow);
}

/** Whether an action can still be undone. */
export const undoable = (row: Pick<ActionRow, "state" | "createdAt">, now = Date.now()) =>
	row.state === "done" && Date.parse(row.createdAt) >= now - UNDO_DAYS * 86_400_000;

/**
 * Reverse a done action: unstar, remove the label, move back to the inbox or
 * mark unread. Logged in Console > Activity as the person's undo.
 */
export async function undoAgentAction(deps: ActionDeps, id: string): Promise<{ ok: true; action: ActionRow } | { error: string; status: 404 | 409 | 500 }> {
	const now = deps.now ?? Date.now();
	const found = await deps.sql.first(`SELECT ${ROW} FROM agent_actions WHERE id = ?`, id);
	if (!found) return { error: "Action not found", status: 404 };
	const row = toRow(found);
	if (row.state === "undone") return { error: "Already undone", status: 409 };
	if (!undoable(row, now)) return { error: row.state === "done" ? `Undo is offered for ${UNDO_DAYS} days` : "Nothing to undo", status: 409 };
	let error: string | null;
	try {
		error = errorOf(await run(deps.ops, row.does, row.mailboxId, row.emailId, row.labelId, false));
	} catch (e) {
		error = (e as Error).message || "failed";
	}
	await logActivity(deps.sql, {
		actor: "person", tool: "undo_action", mailboxId: row.mailboxId, target: row.emailId,
		summary: `${row.agentName} · ${error ? `not undone, ${error}` : UNDONE[row.does]}`, ok: !error, actionId: row.id,
	}, now);
	if (error) return { error, status: 500 };
	const undoneAt = new Date(now).toISOString();
	await deps.sql.run(`UPDATE agent_actions SET state = 'undone', undone_at = ? WHERE id = ? AND state = 'done'`, undoneAt, id);
	return { ok: true, action: { ...row, state: "undone", undoneAt } };
}
