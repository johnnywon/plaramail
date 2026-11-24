// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Holding calls for approval and running them once approved (WON-532). The
 * queue is in workers/lib/approvals.ts. A held call is checked enough to be
 * worth approving (the draft exists, the key and attachments are valid), then
 * queued. Approve runs the same tool with the same arguments, through the same
 * checks and limits, so a reply whose conversation moved on is still refused.
 */
import { isBulk, QUEUE_TTL_MS, type QueueItem } from "../../shared/approvals";
import { Folders } from "../../shared/folders";
import { mailStore, recordsSql } from "../store";
import type { Sql } from "../store/sql";
import type { Env } from "../types";
import { logged } from "./activity";
import { runHeldReply } from "./agent-send";
import { agentSendDeps } from "./agent-send-env";
import { enqueue, holdsMcp, messagesIn, type RunQueued } from "./approvals";
import { decodeAttachments, fail, type McpAttachment, MCP_SEND_KEY_PATTERN, toolReplyToEmail, toolSendEmail } from "./mcp-send";
import type { EmailFull } from "./schemas";
import { type BulkHold, type MailSearch, toolLabelConversation, toolLabelMatching, toolSendDraft, toolStarConversation } from "./tools";

/** The MCP client making a call: its grant's client id and registered name. */
export interface McpCaller {
	clientId: string;
	clientName: string | null;
}

export type HeldSendTool = "send_draft" | "reply_to_email" | "send_email";
export type HeldBulkTool = "label_matching" | "label_conversation" | "star_conversation";

const HOURS = QUEUE_TTL_MS / 3_600_000;

/** What a client gets back for a held call. */
function queued(item: QueueItem, what: "send" | "change") {
	return {
		status: "queued" as const,
		approvalId: item.id,
		expiresAt: item.expiresAt,
		message: `Held for approval in Console > Approvals. The ${what} happens if a person approves it within ${HOURS} hours, and is dropped otherwise. Don't call again to retry it.`,
	};
}

const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Queue an MCP client's send when its Hold for approval is on. Null when it is
 * off and the send goes ahead now. A send that would be refused anyway is
 * refused now, not queued.
 */
export async function holdMcpSend(env: Env, sql: Sql, caller: McpCaller, tool: HeldSendTool, args: Record<string, unknown>) {
	if (!(await holdsMcp(sql, caller.clientId))) return null;
	const mailboxId = String(args.mailboxId ?? "").toLowerCase();
	if (!(await mailStore(env).mailboxes.exists(mailboxId))) return fail("not_found", `Mailbox "${mailboxId}" not found. Use list_mailboxes to see available mailboxes.`);
	let summary: string;
	let dedupeKey: string;
	if (tool === "send_draft") {
		const draftId = String(args.draftId ?? "");
		const draft = (await mailStore(env).mailbox(mailboxId).getEmail(draftId)) as EmailFull | null;
		if (!draft) return fail("not_found", "Draft not found");
		if (draft.folder_id !== Folders.DRAFT) return fail("invalid_input", "Cannot send: email is not a draft");
		if (!draft.recipient?.trim()) return fail("invalid_input", "Cannot send: the draft has no recipient");
		summary = `to ${draft.recipient} · ${draft.subject || "(no subject)"}`;
		dedupeKey = `mcp:${caller.clientId}:draft:${mailboxId}:${draftId}`;
	} else {
		const key = String(args.idempotencyKey ?? "");
		if (!MCP_SEND_KEY_PATTERN.test(key)) return fail("invalid_input", "idempotencyKey must be 8 to 80 letters, digits, or . _ : -");
		const files = decodeAttachments(args.attachments as McpAttachment[] | undefined);
		if (!files.ok) return fail("invalid_input", files.error);
		if (tool === "reply_to_email") {
			const original = (await mailStore(env).mailbox(mailboxId).getEmail(String(args.emailId ?? ""))) as EmailFull | null;
			if (!original) return fail("not_found", "Email not found");
			const base = original.subject?.trim() || "(no subject)";
			summary = `to ${list(args.expectedRecipients).join(", ")} · ${/^re:/i.test(base) ? base : `Re: ${base}`}`;
		} else {
			summary = `to ${[...list(args.to), ...list(args.cc)].join(", ")} · ${String(args.subject ?? "")}`;
		}
		dedupeKey = `mcp:${caller.clientId}:key:${key}`;
	}
	const { item } = await enqueue(sql, {
		kind: "send", actor: "mcp", sourceId: caller.clientId, sourceName: caller.clientName, tool, mailboxId, summary,
		payload: args, dedupeKey,
	});
	return queued(item, "send");
}

/** What a label change does, for its queue line: "add Receipts · archive". */
function changeText(tool: HeldBulkTool, args: Record<string, unknown>): string {
	if (tool === "star_conversation") return "unstar the conversation";
	const parts: string[] = [];
	if (list(args.add).length) parts.push(`add ${list(args.add).join(", ")}`);
	if (list(args.remove).length) parts.push(`remove ${list(args.remove).join(", ")}`);
	if (args.archive === true) parts.push("archive");
	if (tool === "label_matching" && typeof args.query === "string" && args.query.trim()) parts.push(`matching "${args.query.trim()}"`);
	return parts.join(" · ") || tool;
}

/**
 * A BulkHold for an MCP client's call: when its Hold for approval is on and the
 * call covers more than 25 messages, the call is queued instead of made.
 */
export function mcpBulkHold(sql: Sql, caller: McpCaller, tool: HeldBulkTool, args: Record<string, unknown>): BulkHold {
	return async (threadKeys) => {
		if (!(await holdsMcp(sql, caller.clientId))) return null;
		const messages = await messagesIn(sql, threadKeys);
		if (!isBulk(messages)) return null;
		const conversations = threadKeys.length;
		const { item } = await enqueue(sql, {
			kind: "bulk", actor: "mcp", sourceId: caller.clientId, sourceName: caller.clientName, tool,
			mailboxId: typeof args.mailboxId === "string" ? args.mailboxId : null,
			summary: `${changeText(tool, args)} · ${messages} messages in ${conversations} ${conversations === 1 ? "conversation" : "conversations"}`,
			messages, payload: args,
		});
		return { ...queued(item, "change"), messages, conversations };
	};
}

/**
 * Run an approved call: the tool, with the arguments it was queued with, logged
 * under the agent or client that made it. A send takes its place in the daily
 * limit now. Unknown tools fail.
 */
export function runQueued(env: Env): RunQueued {
	const sql = recordsSql(env);
	return async (item, args) => {
		const who = { actor: item.actor === "mcp" ? ("mcp" as const) : ("auto-draft" as const), client: item.sourceName };
		const actor = item.actor === "mcp" ? "mcp" : "agent";
		const mailboxId = String(args.mailboxId ?? item.mailboxId ?? "");
		const call = async (): Promise<Record<string, unknown>> => {
			switch (item.tool) {
				case "send_draft":
					// An agent's held reply is checked against the agent and its limits again (workers/lib/agent-send.ts).
					if (item.actor === "agent") return runHeldReply(agentSendDeps(env), item, args);
					return toolSendDraft(env, mailboxId, String(args.draftId ?? ""), actor);
				case "reply_to_email":
					return toolReplyToEmail(env, mailboxId, item.sourceId, {
						emailId: String(args.emailId ?? ""), expectedRecipients: list(args.expectedRecipients), text: String(args.text ?? ""),
						attachments: args.attachments as McpAttachment[] | undefined, idempotencyKey: String(args.idempotencyKey ?? ""),
					});
				case "send_email":
					return toolSendEmail(env, mailboxId, item.sourceId, {
						to: list(args.to), cc: list(args.cc), subject: String(args.subject ?? ""), text: String(args.text ?? ""),
						attachments: args.attachments as McpAttachment[] | undefined, idempotencyKey: String(args.idempotencyKey ?? ""),
					});
				case "label_matching": {
					const { add, remove, archive, ...search } = args;
					return toolLabelMatching(env, search as MailSearch, { add: list(add), remove: list(remove), archive: archive === true });
				}
				case "label_conversation":
					return toolLabelConversation(env, mailboxId, String(args.emailId ?? ""), { add: list(args.add), remove: list(args.remove), archive: args.archive === true });
				case "star_conversation":
					return toolStarConversation(env, mailboxId, String(args.emailId ?? ""), args.starred === true);
				default:
					return { error: `Can't run ${item.tool}` };
			}
		};
		return logged(sql, who, item.tool, args, call);
	};
}
