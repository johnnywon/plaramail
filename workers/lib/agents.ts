// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Agents: each one does one job on the addresses it watches. New inbound
 * mail is narrowed by each agent's rules (no model call), then the model
 * reads the jobs of the agents that passed and picks one or none
 * (workers/agent/index.ts). The agent's mode decides what happens to its
 * reply: Watch records it, Draft keeps the draft, Send sends it.
 *
 * An action agent stars, labels, archives or marks read instead of replying
 * (workers/lib/agent-actions.ts). Its ladder is Watch, then On. When it has
 * rules, it acts as soon as they pass, with no model call.
 *
 * People write agents in Console > Agents; nothing from incoming mail
 * reaches them. Send waits for SEND_VERSION (SEND_ENABLED): an agent earns it with
 * Test on past mail and a record of drafts sent unchanged.
 */
import { SEND_VERSION } from "../../shared/agent";
import { z } from "zod";
import { RUN_STALE_MS } from "../agent/runs";
import type { Sql } from "../store/sql";
import { htmlToText } from "./message-meta";

/** watch, draft and send are for reply agents; watch and on for action agents. */
export const AGENT_MODES = ["watch", "draft", "send", "on"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** What an agent does with mail it takes. One per agent. */
export const AGENT_DOES = ["reply", "star", "label", "archive", "mark_read"] as const;
export type AgentDoes = (typeof AGENT_DOES)[number];
export type AgentAction = Exclude<AgentDoes, "reply">;
export const isAction = (does: AgentDoes): does is AgentAction => does !== "reply";

/** The modes an agent that does `does` can be in, lowest first. */
export const modesFor = (does: AgentDoes): readonly AgentMode[] => (isAction(does) ? ["watch", "on"] : ["watch", "draft", "send"]);

/** A new action agent's daily limit. A reply agent's is 25. */
export const ACTION_DAILY_LIMIT = 100;

/** Off until SEND_VERSION. While off, the API refuses Send and an agent stored in Send works as Draft. */
export const SEND_ENABLED = false;
export { SEND_VERSION };
export const SEND_LATER = `Send arrives in ${SEND_VERSION}. Use Draft for now.`;

export const RULE_FIELDS = ["from", "subject", "body"] as const;
export const RULE_OPS = ["contains", "not_contains", "is", "domain"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export type RuleOp = (typeof RULE_OPS)[number];

export interface AgentRule {
	field: RuleField;
	op: RuleOp;
	value: string;
}

export interface Agent {
	id: string;
	name: string;
	job: string;
	/** Addresses it watches. Empty means every address. */
	addresses: string[];
	rules: AgentRule[];
	instructions: string;
	exampleReply: string;
	mode: AgentMode;
	does: AgentDoes;
	/** The label a Label agent adds. */
	labelId: string | null;
	enabled: boolean;
	position: number;
	dailyLimit: number;
	perSenderLimit: number;
	createdAt: string;
	updatedAt: string;
}

export const MAX_AGENTS = 50;

const Rule = z.object({
	field: z.enum(RULE_FIELDS),
	op: z.enum(RULE_OPS),
	value: z.string().trim().min(1).max(200),
});

export const AgentBody = z.object({
	name: z.string().trim().min(1, "Give the agent a name").max(60),
	job: z.string().trim().min(1, "Describe the agent's job").max(1000),
	addresses: z.array(z.string().trim().toLowerCase().email()).max(100).optional(),
	rules: z.array(Rule).max(10).optional(),
	instructions: z.string().max(4000).optional(),
	exampleReply: z.string().max(4000).optional(),
	mode: z.enum(AGENT_MODES).refine((m) => SEND_ENABLED || m !== "send", SEND_LATER).optional(),
	does: z.enum(AGENT_DOES).optional(),
	labelId: z.string().trim().min(1).max(100).nullable().optional(),
	enabled: z.boolean().optional(),
	dailyLimit: z.number().int().min(0).max(100).optional(),
	perSenderLimit: z.number().int().min(1).max(10).optional(),
});
export type AgentInput = z.infer<typeof AgentBody>;

const COLUMNS = "id, name, job, addresses, rules, instructions, example_reply, mode, does, label_id, enabled, position, daily_limit, per_sender_limit, created_at, updated_at";

function parseJson<T>(raw: unknown, fallback: T): T {
	try {
		const value = JSON.parse(String(raw ?? ""));
		return Array.isArray(value) ? (value as T) : fallback;
	} catch {
		return fallback;
	}
}

function storedDoes(raw: unknown): AgentDoes {
	return (AGENT_DOES as readonly string[]).includes(String(raw)) ? (String(raw) as AgentDoes) : "reply";
}

/** A mode the agent's Does doesn't have reads as Watch. */
function storedMode(raw: unknown, does: AgentDoes): AgentMode {
	const mode = (AGENT_MODES as readonly string[]).includes(String(raw)) ? (String(raw) as AgentMode) : "watch";
	if (!modesFor(does).includes(mode)) return "watch";
	return mode === "send" && !SEND_ENABLED ? "draft" : mode;
}

const toAgent = (r: Record<string, unknown>): Agent => ({
	id: String(r.id),
	name: String(r.name),
	job: String(r.job ?? ""),
	addresses: parseJson<string[]>(r.addresses, []).map((a) => String(a).toLowerCase()),
	rules: parseJson<unknown[]>(r.rules, []).flatMap((x) => {
		const parsed = Rule.safeParse(x);
		return parsed.success ? [parsed.data] : [];
	}),
	instructions: String(r.instructions ?? ""),
	exampleReply: String(r.example_reply ?? ""),
	mode: storedMode(r.mode, storedDoes(r.does)),
	does: storedDoes(r.does),
	labelId: r.label_id == null ? null : String(r.label_id),
	enabled: Number(r.enabled) === 1,
	position: Number(r.position ?? 0),
	dailyLimit: Number(r.daily_limit ?? 25),
	perSenderLimit: Number(r.per_sender_limit ?? 2),
	createdAt: String(r.created_at),
	updatedAt: String(r.updated_at),
});

export async function listAgents(sql: Sql): Promise<Agent[]> {
	return (await sql.all(`SELECT ${COLUMNS} FROM agents ORDER BY position, created_at`)).map(toAgent);
}

export async function getAgent(sql: Sql, id: string): Promise<Agent | null> {
	const row = await sql.first(`SELECT ${COLUMNS} FROM agents WHERE id = ?`, id);
	return row ? toAgent(row) : null;
}

const nameTaken = async (sql: Sql, name: string, except: string | null) =>
	!!(await sql.first(`SELECT id FROM agents WHERE lower(name) = lower(?) AND (?2 IS NULL OR id != ?2)`, name.trim(), except));

/** Why a Does, mode and label don't go together, or null when they do. */
function doesError(does: AgentDoes, mode: AgentMode, labelId: string | null | undefined): string | null {
	if (!modesFor(does).includes(mode)) return isAction(does) ? "An action agent is in Watch or On" : "On is for action agents. Use Watch or Draft.";
	if (does === "label" && !labelId) return "Pick the label it adds";
	return null;
}

/** A new agent goes to the bottom of the list. It starts in Watch unless asked otherwise. */
export async function createAgent(sql: Sql, input: AgentInput): Promise<{ agent: Agent } | { error: string }> {
	const does = input.does ?? "reply";
	const mode = input.mode ?? "watch";
	const invalid = doesError(does, mode, input.labelId);
	if (invalid) return { error: invalid };
	if (await nameTaken(sql, input.name, null)) return { error: "An agent with that name exists" };
	const now = new Date().toISOString();
	const rows = await sql.all(
		`INSERT INTO agents (id, name, job, addresses, rules, instructions, example_reply, mode, enabled, position, daily_limit, per_sender_limit, created_at, updated_at, does, label_id)
		SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, (SELECT COALESCE(MAX(position) + 1, 0) FROM agents), ?10, ?11, ?12, ?12, ?14, ?15
		WHERE (SELECT COUNT(*) FROM agents) < ?13
		RETURNING ${COLUMNS}`,
		crypto.randomUUID(), input.name.trim(), input.job.trim(), JSON.stringify(input.addresses ?? []), JSON.stringify(input.rules ?? []),
		input.instructions ?? "", input.exampleReply ?? "", mode, input.enabled === false ? 0 : 1,
		input.dailyLimit ?? (isAction(does) ? ACTION_DAILY_LIMIT : 25), input.perSenderLimit ?? 2, now, MAX_AGENTS,
		does, does === "label" ? input.labelId : null,
	);
	return rows.length ? { agent: toAgent(rows[0]) } : { error: `You can have up to ${MAX_AGENTS} agents` };
}

/**
 * Change an agent. A new Does starts it again in Watch unless a mode comes
 * with it: what it earned replying says nothing about archiving.
 */
export async function updateAgent(sql: Sql, id: string, input: Partial<AgentInput>): Promise<{ agent: Agent | null } | { error: string }> {
	if (input.does !== undefined || input.mode !== undefined || input.labelId !== undefined) {
		const current = await getAgent(sql, id);
		if (!current) return { agent: null };
		const does = input.does ?? current.does;
		const mode = input.mode ?? (does !== current.does ? "watch" : current.mode);
		const labelId = input.labelId !== undefined ? input.labelId : current.labelId;
		const invalid = doesError(does, mode, labelId);
		if (invalid) return { error: invalid };
		input = { ...input, does, mode, labelId: does === "label" ? labelId : null };
	}
	if (input.name !== undefined && await nameTaken(sql, input.name, id)) return { error: "An agent with that name exists" };
	const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
	const rows = await sql.all(
		`UPDATE agents SET name = COALESCE(?, name), job = COALESCE(?, job), addresses = COALESCE(?, addresses), rules = COALESCE(?, rules),
			instructions = COALESCE(?, instructions), example_reply = COALESCE(?, example_reply), mode = COALESCE(?, mode),
			enabled = COALESCE(?, enabled), daily_limit = COALESCE(?, daily_limit), per_sender_limit = COALESCE(?, per_sender_limit), updated_at = ?,
			does = COALESCE(?, does), label_id = CASE WHEN ? THEN ? ELSE label_id END
		WHERE id = ? RETURNING ${COLUMNS}`,
		input.name?.trim() ?? null, input.job?.trim() ?? null, json(input.addresses), json(input.rules),
		input.instructions ?? null, input.exampleReply ?? null, input.mode ?? null,
		input.enabled === undefined ? null : input.enabled ? 1 : 0, input.dailyLimit ?? null, input.perSenderLimit ?? null,
		new Date().toISOString(), input.does ?? null, input.labelId !== undefined ? 1 : 0, input.labelId ?? null, id,
	);
	return { agent: rows.length ? toAgent(rows[0]) : null };
}

export async function deleteAgent(sql: Sql, id: string): Promise<boolean> {
	return (await sql.run(`DELETE FROM agents WHERE id = ?`, id)).changes > 0;
}

/** Set the list order: the first id takes a message before the rest. Unknown ids are ignored. */
export async function orderAgents(sql: Sql, ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	await sql.batch(ids.slice(0, MAX_AGENTS).map((id, position) => ({ sql: `UPDATE agents SET position = ? WHERE id = ?`, params: [position, id] })));
}

export interface InboundMail {
	mailboxId: string;
	from: string;
	subject: string;
	body: string;
}

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/** Values are comma-separated alternatives: "meet, call" matches either. */
function testRule(rule: AgentRule, mail: InboundMail): boolean {
	const text = (rule.field === "from" ? mail.from : rule.field === "subject" ? mail.subject : mail.body).toLowerCase();
	const values = rule.value.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
	if (values.length === 0) return true;
	switch (rule.op) {
		case "contains": return values.some((v) => text.includes(v));
		case "not_contains": return values.every((v) => !text.includes(v));
		case "is": return values.some((v) => text.trim() === v);
		case "domain": return values.some((v) => domainOf(mail.from) === v.replace(/^@/, ""));
	}
}

/** The enabled agents that watch this address and whose rules all pass, in list order. */
export function matchAgents(agents: readonly Agent[], mail: InboundMail): Agent[] {
	const mailbox = mail.mailboxId.toLowerCase();
	return agents.filter((a) => a.enabled
		&& (a.addresses.length === 0 || a.addresses.includes(mailbox))
		&& a.rules.every((r) => testRule(r, mail)));
}

export interface InboundPlan {
	/** Reply agents whose rules passed, in list order. At most one replies. */
	reply: Agent[];
	/** Action agents with rules that passed: each acts with no model call. */
	act: Agent[];
	/** Action agents with no rules: the model says whether the job fits. */
	ask: Agent[];
}

/** Split the agents that matched a message by what happens next. */
export function planInbound(matched: readonly Agent[]): InboundPlan {
	const plan: InboundPlan = { reply: [], act: [], ask: [] };
	for (const a of matched) {
		if (!isAction(a.does)) plan.reply.push(a);
		else if (a.mode === "watch" || a.mode === "on") (a.rules.length > 0 ? plan.act : plan.ask).push(a);
	}
	return plan;
}

/** What the action agents the model decides on do, and the tool each calls. */
export function actionAgentPrompt(agents: readonly Agent[], tools: Record<AgentAction, string>): string {
	if (agents.length === 0) return "";
	const list = agents.map((a) => `### ${a.name}\nJob: ${a.job.trim()}\nTool: ${tools[a.does as AgentAction]}`).join("\n\n");
	return `## Action agents
These agents act on the new email instead of replying. For every one whose job fits, call its tool once with its name as agent. Leave the others alone. This does not change whether you reply.

${list}`;
}

/** The agents whose rules passed, in list order, for the drafting prompt: the model takes the first whose job fits, or none. */
export function agentPrompt(agents: readonly Agent[]): string {
	if (agents.length === 0) return "";
	const list = agents.map((a) => {
		const lines = [`### ${a.name}`, `Job: ${a.job.trim()}`];
		if (a.instructions.trim()) lines.push(`Instructions: ${a.instructions.trim()}`);
		if (a.exampleReply.trim()) lines.push(`Example reply:\n${a.exampleReply.trim()}`);
		return lines.join("\n");
	}).join("\n\n");
	return `## Agents
The operator hired these agents for mail like this, highest first. Take the first one whose job fits the new email and follow its instructions, or none if no job fits. Pass its name as draft_reply's agent and every agent whose job fits as fits, or leave both out.

${list}`;
}

/** The agent the model named, matched without case. */
export function findAgent(agents: readonly Agent[], name: string | null | undefined): Agent | null {
	const wanted = (name ?? "").trim().toLowerCase();
	return wanted ? agents.find((a) => a.name.toLowerCase() === wanted) ?? null : null;
}

/**
 * The agent that takes the message: the highest in the list among the one the
 * model named and the ones it said fit. The list order decides, not the model.
 */
export function firstFitting(agents: readonly Agent[], named: string | null | undefined, fits: readonly string[] = []): Agent | null {
	const wanted = new Set([named, ...fits].map((n) => (n ?? "").trim().toLowerCase()).filter(Boolean));
	return agents.find((a) => wanted.has(a.name.toLowerCase())) ?? null;
}

/** Sends by this agent in the last 24 hours, overall and to one sender. */
export async function agentSendsToday(sql: Sql, agentId: string, sender: string, now = Date.now()): Promise<{ total: number; toSender: number }> {
	const row = await sql.first(
		`SELECT COUNT(*) AS total, SUM(CASE WHEN sender = ? THEN 1 ELSE 0 END) AS to_sender FROM auto_draft_runs
		WHERE agent_id = ? AND state = 'sent' AND created_at >= ?`,
		sender.toLowerCase(), agentId, new Date(now - 86_400_000).toISOString(),
	);
	return { total: Number(row?.total ?? 0), toSender: Number(row?.to_sender ?? 0) };
}

export interface AgentStats {
	agentId: string;
	/** Runs in the last 7 days by state. An action agent's are its actions: watched, done, skipped (daily limit) and failed. */
	runs: Partial<Record<string, number>>;
	today: number;
	/** Runs queued or running that moved in the last RUN_STALE_MS: the agent is working now. */
	live: number;
}

/** Each agent's runs in the last 7 days, and today's count, for the Console. */
export async function agentStats(sql: Sql, now = Date.now()): Promise<AgentStats[]> {
	const rows = await sql.all(
		`SELECT agent_id, state, COUNT(*) AS n, SUM(CASE WHEN created_at >= ?2 THEN 1 ELSE 0 END) AS today,
			SUM(CASE WHEN state IN ('queued', 'running') AND COALESCE(updated_at, created_at) >= ?3 THEN 1 ELSE 0 END) AS live
		FROM auto_draft_runs WHERE agent_id IS NOT NULL AND created_at >= ?1 GROUP BY agent_id, state
		UNION ALL
		SELECT agent_id, CASE state WHEN 'undone' THEN 'done' WHEN 'limited' THEN 'skipped' ELSE state END AS state, COUNT(*) AS n,
			SUM(CASE WHEN created_at >= ?2 THEN 1 ELSE 0 END) AS today, 0 AS live
		FROM agent_actions WHERE created_at >= ?1 GROUP BY 1, 2`,
		new Date(now - 7 * 86_400_000).toISOString(), new Date(now - 86_400_000).toISOString(), new Date(now - RUN_STALE_MS).toISOString(),
	);
	const byAgent = new Map<string, AgentStats>();
	for (const r of rows) {
		const id = String(r.agent_id);
		const stats = byAgent.get(id) ?? { agentId: id, runs: {}, today: 0, live: 0 };
		stats.runs[String(r.state)] = (stats.runs[String(r.state)] ?? 0) + Number(r.n);
		stats.live += Number(r.live ?? 0);
		if (["watched", "drafted", "sent", "done"].includes(String(r.state))) stats.today += Number(r.today ?? 0);
		byAgent.set(id, stats);
	}
	return [...byAgent.values()];
}

export interface AgentDraft {
	emailId: string;
	mailboxId: string;
	threadId: string | null;
	subject: string;
	recipient: string;
	date: string;
	snippet: string;
	/** The reply as written, quoted original left out; the snippet when the body is stored elsewhere. */
	text: string;
	/** The agent's name when the draft was written, or null for a PlaraMail Agent draft. */
	agent: string | null;
}

/** A draft's reply as plain paragraphs, the quoted original left out. */
function draftText(html: string): string {
	return html
		.replace(/<blockquote[\s\S]*<\/blockquote>/i, "")
		.split(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/i)
		.map(htmlToText)
		.filter(Boolean)
		.join("\n")
		.slice(0, 4000);
}

/** Drafts agents wrote that are still waiting in Drafts, newest first, for Console > Review. */
export async function listAgentDrafts(sql: Sql, mailboxIds: readonly string[], limit = 50): Promise<AgentDraft[]> {
	if (mailboxIds.length === 0) return [];
	const rows = await sql.all(
		`SELECT m.email_id, m.mailbox_id, m.thread_id, m.subject, m.recipient, m.date, m.snippet, m.body, n.agent FROM draft_notes n
		JOIN messages m ON m.email_id = n.email_id
		WHERE n.origin = 'auto-draft' AND m.folder_id = 'draft' AND m.mailbox_id IN (SELECT value FROM json_each(?1))
		ORDER BY m.date DESC LIMIT ?2`,
		JSON.stringify(mailboxIds.map((m) => m.toLowerCase())), Math.min(Math.max(limit, 1), 100),
	);
	return rows.map((r) => ({
		emailId: String(r.email_id), mailboxId: String(r.mailbox_id), threadId: r.thread_id == null ? null : String(r.thread_id),
		subject: String(r.subject ?? ""), recipient: String(r.recipient ?? ""), date: String(r.date), snippet: String(r.snippet ?? ""),
		text: r.body == null ? String(r.snippet ?? "") : draftText(String(r.body)),
		agent: r.agent == null ? null : String(r.agent),
	}));
}
