// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The activity log: one row per tool call by the chat agent, auto-draft or
 * an MCP client, and per redraft a person asks for, in the agent_activity table. Console > Activity lists it.
 * The cron deletes rows older than the retention in prefs (90, 120 or 180
 * days). Logging never fails the call it records.
 */
import type { Sql } from "../store/sql";

/** `person` is a person in the app asking a model for something, such as a redraft. */
export type ActivityActor = "chat" | "auto-draft" | "mcp" | "person";
export type ActivityAction = "read" | "draft" | "send" | "delete" | "label" | "move" | "settings";

export const ACTIVITY_ACTORS: readonly ActivityActor[] = ["chat", "auto-draft", "mcp", "person"];
export const ACTIVITY_PAGE = 50;

/** Every tool the chat agent, auto-draft and MCP expose, by what it does. */
export const TOOL_ACTIONS: Record<string, ActivityAction> = {
	list_mailboxes: "read",
	list_emails: "read",
	get_email: "read",
	get_thread: "read",
	search_emails: "read",
	search_all_mail: "read",
	list_labels: "read",
	list_shortcuts: "read",
	draft_reply: "draft",
	draft_email: "draft",
	create_draft: "draft",
	update_draft: "draft",
	send_draft: "send",
	reply_to_email: "send",
	send_email: "send",
	discard_draft: "delete",
	delete_email: "delete",
	delete_label: "delete",
	create_label: "label",
	rename_label: "label",
	label_conversation: "label",
	label_matching: "label",
	star_conversation: "label",
	move_email: "move",
	mark_email_read: "move",
	set_shortcut: "settings",
	reset_shortcuts: "settings",
	redraft: "draft",
};

export interface ActivityEntry {
	actor: ActivityActor;
	client?: string | null;
	tool: string;
	mailboxId?: string | null;
	target?: string | null;
	summary?: string | null;
	ok: boolean;
}

export interface ActivityRow {
	id: number;
	at: string;
	mailboxId: string | null;
	actor: ActivityActor;
	client: string | null;
	action: ActivityAction;
	tool: string;
	target: string | null;
	summary: string | null;
	ok: boolean;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const clip = (v: string | null, n = 200) => (v && v.length > n ? `${v.slice(0, n - 1)}…` : v);

/**
 * What to log for one call: the address, the thing it acted on, and a short
 * summary from the arguments and the result. Reads log what was asked for,
 * not the mail they returned.
 */
export function describeCall(tool: string, args: Record<string, unknown>, result: unknown, bound: string | null = null) {
	const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
	const error = str(r.error);
	const target = str(args.emailId) ?? str(args.draftId) ?? str(args.originalEmailId) ?? str(args.threadId)
		?? str(args.label) ?? str(r.draftId) ?? str(r.newDraftId) ?? null;
	const parts: (string | null)[] = [];
	if (TOOL_ACTIONS[tool] === "draft" || TOOL_ACTIONS[tool] === "send") {
		const to = str(args.to) ?? str(r.to);
		const subject = str(args.subject) ?? str(r.subject);
		if (to) parts.push(`to ${to}`);
		if (subject) parts.push(subject);
	}
	if (str(args.instruction)) parts.push(`"${args.instruction}"`);
	if (str(args.query)) parts.push(`"${args.query}"`);
	if (str(args.folder) && TOOL_ACTIONS[tool] === "read") parts.push(String(args.folder));
	if (str(args.folderId)) parts.push(`to ${args.folderId}`);
	if (typeof args.read === "boolean") parts.push(args.read ? "read" : "unread");
	for (const key of ["add", "remove"] as const) {
		const list = Array.isArray(args[key]) ? (args[key] as unknown[]).filter((v) => typeof v === "string") : [];
		if (list.length) parts.push(`${key} ${list.join(", ")}`);
	}
	if (str(args.name)) parts.push(String(args.name));
	if (str(args.shortcut)) parts.push(String(args.shortcut));
	if (typeof r.status === "string" && r.status !== "draft_saved") parts.push(r.status);
	if (typeof r.count === "number") parts.push(`${r.count} matched`);
	if (error) parts.push(error);
	return {
		mailboxId: str(args.mailboxId)?.toLowerCase() ?? bound,
		target: clip(target, 300),
		summary: clip(parts.filter(Boolean).join(" · ") || null),
		ok: !error,
	};
}

export async function logActivity(sql: Sql, entry: ActivityEntry, now = Date.now()): Promise<void> {
	try {
		await sql.run(
			`INSERT INTO agent_activity (at, mailbox_id, actor, client, action, tool, target, summary, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			new Date(now).toISOString(), entry.mailboxId ?? null, entry.actor, clip(entry.client ?? null, 100),
			TOOL_ACTIONS[entry.tool] ?? "read", entry.tool, entry.target ?? null, entry.summary ?? null, entry.ok ? 1 : 0,
		);
	} catch (e) {
		console.error("activity log failed:", (e as Error).message);
	}
}

/** Run one tool call and log it. The call's own result or error passes through. */
export async function logged<T>(
	sql: Sql,
	who: { actor: ActivityActor; client?: string | null; bound?: string | null },
	tool: string,
	args: Record<string, unknown>,
	run: () => Promise<T>,
	view: (result: T) => unknown = (result) => result,
): Promise<T> {
	let result: T;
	try {
		result = await run();
	} catch (e) {
		await logActivity(sql, { ...who, tool, ...describeCall(tool, args, { error: (e as Error).message }, who.bound ?? null), ok: false });
		throw e;
	}
	await logActivity(sql, { ...who, tool, ...describeCall(tool, args, view(result), who.bound ?? null) });
	return result;
}

/** Newest first. `before` is the last id of the previous page; `failed` keeps only failed calls; `since` is an ISO time. */
export async function listActivity(
	sql: Sql,
	options: {
		mailboxId?: string | null; actor?: string | null; action?: string | null; before?: number | null; limit?: number;
		failed?: boolean; since?: string | null;
	} = {},
): Promise<{ entries: ActivityRow[]; next: number | null }> {
	const limit = Math.min(Math.max(options.limit ?? ACTIVITY_PAGE, 1), 200);
	const rows = await sql.all(
		`SELECT id, at, mailbox_id, actor, client, action, tool, target, summary, ok FROM agent_activity
		WHERE (?1 IS NULL OR mailbox_id = ?1) AND (?2 IS NULL OR actor = ?2) AND (?3 IS NULL OR action = ?3) AND (?4 IS NULL OR id < ?4)
			AND (?6 = 0 OR ok = 0) AND (?7 IS NULL OR at >= ?7)
		ORDER BY id DESC LIMIT ?5`,
		options.mailboxId?.toLowerCase() ?? null, options.actor ?? null, options.action ?? null, options.before ?? null, limit + 1,
		options.failed ? 1 : 0, options.since ?? null,
	);
	const entries = rows.slice(0, limit).map((r) => ({
		id: Number(r.id),
		at: String(r.at),
		mailboxId: r.mailbox_id == null ? null : String(r.mailbox_id),
		actor: String(r.actor) as ActivityActor,
		client: r.client == null ? null : String(r.client),
		action: String(r.action) as ActivityAction,
		tool: String(r.tool),
		target: r.target == null ? null : String(r.target),
		summary: r.summary == null ? null : String(r.summary),
		ok: Number(r.ok) === 1,
	}));
	return { entries, next: rows.length > limit ? entries[entries.length - 1].id : null };
}

export interface McpClientUsage {
	client: string | null;
	last: string;
	calls: number;
	today: number;
	errors: number;
}

export interface McpUsage {
	clients: McpClientUsage[];
	tools: Record<string, { calls: number; last: string }>;
	lastCall: string | null;
}

/** Who has called the MCP server and which tools they use, over the log's retention. */
export async function mcpUsage(sql: Sql, now = Date.now()): Promise<McpUsage> {
	const dayAgo = new Date(now - 86_400_000).toISOString();
	const clients = await sql.all(
		`SELECT client, MAX(at) AS last, COUNT(*) AS calls, SUM(at >= ?1) AS today, SUM(ok = 0) AS errors
		FROM agent_activity WHERE actor = 'mcp' GROUP BY client ORDER BY last DESC LIMIT 20`,
		dayAgo,
	);
	const tools = await sql.all(
		`SELECT tool, COUNT(*) AS calls, MAX(at) AS last FROM agent_activity WHERE actor = 'mcp' GROUP BY tool`,
	);
	return {
		clients: clients.map((r) => ({
			client: r.client == null ? null : String(r.client),
			last: String(r.last),
			calls: Number(r.calls),
			today: Number(r.today ?? 0),
			errors: Number(r.errors ?? 0),
		})),
		tools: Object.fromEntries(tools.map((r) => [String(r.tool), { calls: Number(r.calls), last: String(r.last) }])),
		lastCall: clients.length ? String(clients[0].last) : null,
	};
}

/** Delete rows older than the retention. Returns how many went. */
export async function pruneActivity(sql: Sql, days: number, now = Date.now()): Promise<number> {
	const cutoff = new Date(now - days * 86_400_000).toISOString();
	return (await sql.run(`DELETE FROM agent_activity WHERE at < ?`, cutoff)).changes;
}
