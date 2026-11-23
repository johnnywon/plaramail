// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { getReplyAddresses } from "../../app/lib/reply";
import { Folders } from "../../shared/folders";
import { mailStore } from "../store";
import type { Env } from "../types";
import { getFullThread, textToHtml } from "./email-helpers";
import type { EmailFull } from "./schemas";
import { sendMail, type SendEmailRequest, type SendMode, type SendResult } from "./send";
import { SEND_KEY_CONFLICT_ERROR, sendContentHash } from "./send-keys";

/**
 * Sending in one call from MCP: reply_to_email and send_email. Each send takes
 * an idempotency key, so a client that retries never sends twice, and goes
 * through sendMail with the MCP send limits. A reply only goes out if the email
 * is still the newest one received in its conversation and its reply address is
 * the one the client expects, so a client acting on an old read can't send to
 * the wrong person.
 */

export const MCP_ATTACHMENTS_MAX = 10;
export const MCP_ATTACHMENT_BYTES_MAX = 5 * 1024 * 1024;
/** The client's half of the key. Stored with the client's id in front. */
export const MCP_SEND_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;

export interface McpAttachment {
	filename: string;
	contentType: string;
	/** The file, base64 encoded. */
	contentBase64: string;
}

export type McpSendError = {
	error: string;
	code: "not_found" | "not_received" | "conversation_advanced" | "recipient_changed" | "invalid_input" | "send_limit" | "key_conflict" | "in_progress";
	retryable: boolean;
	[detail: string]: unknown;
};

export type McpSendResult =
	| { status: "sent" | "already_sent"; sentId: string; mailboxId: string; to: string; subject: string }
	| McpSendError;

export const fail = (code: McpSendError["code"], error: string, detail: Record<string, unknown> = {}): McpSendError =>
	({ error, code, retryable: false, ...detail });

/** Where a reply to this email goes: its Reply-To addresses, or its sender. Lowercase. */
export function replyTarget(email: { sender?: string | null; raw_headers?: string | null }): string[] {
	return getReplyAddresses({ sender: email.sender ?? "", raw_headers: email.raw_headers })
		.map((a) => a.trim().toLowerCase())
		.filter(Boolean);
}

/** The From for a send: the address, with its display name when one is set. */
export async function senderFor(env: Env, mailboxId: string): Promise<string | { email: string; name: string }> {
	const settings = (await mailStore(env).mailboxes.get(mailboxId)) ?? {};
	const name = typeof settings.fromName === "string" ? settings.fromName.trim() : "";
	return name && name.toLowerCase() !== mailboxId.toLowerCase() ? { email: mailboxId, name } : mailboxId;
}

/** Check and convert attachments for sendMail, or say what is wrong with them. */
export function decodeAttachments(list: McpAttachment[] | undefined):
	| { ok: true; attachments: { content: string; filename: string; type: string; disposition: "attachment" }[] }
	| { ok: false; error: string } {
	if (!list?.length) return { ok: true, attachments: [] };
	if (list.length > MCP_ATTACHMENTS_MAX) return { ok: false, error: `At most ${MCP_ATTACHMENTS_MAX} attachments` };
	let bytes = 0;
	const attachments: { content: string; filename: string; type: string; disposition: "attachment" }[] = [];
	for (const a of list) {
		const content = a.contentBase64.replace(/\s+/g, "");
		if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content) || content.length % 4 === 1) {
			return { ok: false, error: `${a.filename} is not valid base64` };
		}
		if (/[\r\n"]/.test(a.filename) || /[\r\n]/.test(a.contentType)) return { ok: false, error: `${a.filename} has a line break or quote in its name or type` };
		bytes += Math.floor((content.length * 3) / 4) - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0);
		attachments.push({ content, filename: a.filename, type: a.contentType || "application/octet-stream", disposition: "attachment" as const });
	}
	if (bytes > MCP_ATTACHMENT_BYTES_MAX) return { ok: false, error: `Attachments add up to more than ${MCP_ATTACHMENT_BYTES_MAX / 1024 / 1024} MB` };
	return { ok: true, attachments };
}

/** The stored key: the client's id (hashed, as CIMD ids are URLs) and the client's key. */
async function storedKey(clientId: string, key: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId)));
	const hex = [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `mcp:${hex}:${key}`;
}

function sendOutcome(result: SendResult, mailboxId: string, to: string[], subject: string): McpSendResult {
	if (result.ok) return { status: result.duplicate ? "already_sent" : "sent", sentId: result.id, mailboxId, to: to.join(", "), subject };
	return sendFailure(result);
}

/** The send-tool error for a send sendMail refused. */
export function sendFailure(result: Extract<SendResult, { ok: false }>): McpSendError {
	if (result.status === 429) return fail("send_limit", result.error);
	if (result.status === 404) return fail("not_found", result.error);
	if (result.status === 409) {
		return result.attempt
			? fail("in_progress", result.error, { attempt: result.attempt })
			: fail("key_conflict", result.error);
	}
	return fail("invalid_input", result.error);
}

export interface ReplyInput {
	emailId: string;
	expectedRecipients: string[];
	text: string;
	attachments?: McpAttachment[];
	idempotencyKey: string;
}

/** Reply to a received email now, in its conversation. */
export async function toolReplyToEmail(env: Env, mailboxId: string, clientId: string, input: ReplyInput): Promise<McpSendResult> {
	if (!MCP_SEND_KEY_PATTERN.test(input.idempotencyKey)) return fail("invalid_input", "idempotencyKey must be 8 to 80 letters, digits, or . _ : -");
	const stub = mailStore(env).mailbox(mailboxId);
	const original = (await stub.getEmail(input.emailId)) as EmailFull | null;
	if (!original) return fail("not_found", "Email not found");
	// Received: not in Sent or Drafts, and not from this address (a draft moved to Trash is still ours).
	const wasReceived = (m: { folder_id?: string | null; sender?: string | null }) =>
		m.folder_id !== Folders.SENT && m.folder_id !== Folders.DRAFT && (m.sender ?? "").trim().toLowerCase() !== mailboxId.toLowerCase();
	if (!wasReceived(original)) {
		return fail("not_received", "Reply to an email you received, not one you sent or drafted");
	}

	const target = replyTarget(original);
	const expected = input.expectedRecipients.map((a) => a.trim().toLowerCase()).filter(Boolean);
	if (!target.length) return fail("invalid_input", "This email has no address to reply to");
	if (expected.length !== target.length || !target.every((a) => expected.includes(a))) {
		return fail("recipient_changed", "expectedRecipients doesn't match where this reply would go. Copy replyTarget from get_email.", { replyTarget: target });
	}

	const files = decodeAttachments(input.attachments);
	if (!files.ok) return fail("invalid_input", files.error);
	const base = original.subject?.trim() || "";
	const subject = /^re:/i.test(base) ? base : `Re: ${base || "(no subject)"}`;
	const body: SendEmailRequest = {
		to: target,
		from: await senderFor(env, mailboxId),
		subject,
		html: textToHtml(input.text),
		text: input.text,
		...(files.attachments.length ? { attachments: files.attachments } : {}),
	};
	const mode: SendMode = { kind: "reply", originalId: original.id };
	const key = await storedKey(clientId, input.idempotencyKey);

	// A retry of a reply that went out answers with the first send, even if mail arrived since.
	const sent = await stub.sentSendKey(key);
	if (sent) {
		if (sent.contentHash && sent.contentHash !== (await sendContentHash([mode, body]))) return sendOutcome({ ok: false, status: 409, error: SEND_KEY_CONFLICT_ERROR }, mailboxId, target, subject);
		return sendOutcome({ ok: true, id: sent.id, duplicate: true }, mailboxId, target, subject);
	}

	// The newest email received in the conversation must be this one.
	if (original.thread_id) {
		const { messages } = await getFullThread(stub, original.thread_id);
		const received = messages.filter(wasReceived);
		const latest = received[received.length - 1];
		if (latest && latest.id !== original.id) {
			return fail("conversation_advanced", "A newer email arrived in this conversation. Read it, then reply to it instead.", { latestEmailId: latest.id });
		}
	}

	const result = await sendMail(env, mailboxId, stub, body, mode, { idempotencyKey: key, actor: "mcp" });
	return sendOutcome(result, mailboxId, target, subject);
}

export interface SendInput {
	to: string[];
	cc?: string[];
	subject: string;
	text: string;
	attachments?: McpAttachment[];
	idempotencyKey: string;
}

/** Send a new email now, starting a new conversation. */
export async function toolSendEmail(env: Env, mailboxId: string, clientId: string, input: SendInput): Promise<McpSendResult> {
	if (!MCP_SEND_KEY_PATTERN.test(input.idempotencyKey)) return fail("invalid_input", "idempotencyKey must be 8 to 80 letters, digits, or . _ : -");
	if (!(await mailStore(env).mailboxes.exists(mailboxId))) return fail("not_found", `Mailbox "${mailboxId}" not found. Use list_mailboxes to see available mailboxes.`);
	const files = decodeAttachments(input.attachments);
	if (!files.ok) return fail("invalid_input", files.error);
	const stub = mailStore(env).mailbox(mailboxId);
	const result = await sendMail(env, mailboxId, stub, {
		to: input.to,
		...(input.cc?.length ? { cc: input.cc } : {}),
		from: await senderFor(env, mailboxId),
		subject: input.subject,
		html: textToHtml(input.text),
		text: input.text,
		...(files.attachments.length ? { attachments: files.attachments } : {}),
	}, { kind: "new" }, { idempotencyKey: await storedKey(clientId, input.idempotencyKey), actor: "mcp" });
	return sendOutcome(result, mailboxId, input.to, input.subject);
}
