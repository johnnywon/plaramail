// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The one sending path: new mail, replies and forwards from the API routes,
 * and scheduled sends from the cron.
 */
import type { z } from "zod";
import { sendEmail, sendWasRejected } from "../email-sender";
import { storeAttachments } from "./attachments";
import {
	buildReferencesChain,
	buildThreadingHeaders,
	generateMessageId,
	resolveOriginalEmail,
	SenderValidationError,
	validateSender,
} from "./email-helpers";
import { hasHeaderLineBreaks } from "./schemas";
import { base64Bytes, messageBytes, messageSizeError } from "../../shared/message-size";
import type { EmailFull, SendEmailRequestSchema } from "./schemas";
import { readAgentLimits } from "./agent-limits";
import { countRecipients, isAgent, recipientLimitError, type SendActor } from "./send-budget";
import { type AgentLimits, DEFAULT_AGENT_LIMITS } from "../../shared/send-limits";
import {
	SEND_KEY_CONFLICT_ERROR,
	SEND_KEY_PENDING_ERROR,
	SEND_KEY_SENDING_ERROR,
	sendContentHash,
	type SendKeyClaim,
} from "./send-keys";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";

export type SendEmailRequest = z.infer<typeof SendEmailRequestSchema>;

export type SendMode =
	| { kind: "new" }
	| { kind: "reply"; originalId: string }
	| { kind: "forward"; originalId: string };

/** What sending needs from a mailbox (a `MailboxStore`). */
export interface SendStub {
	getEmail(id: string): Promise<unknown>;
	createEmail(folder: string, email: any, attachments: any[]): Promise<unknown>;
	markThreadRead(threadId: string): Promise<unknown>;
	moveEmail(id: string, folderId: string): Promise<unknown>;
	takeSendBudget(actor: SendActor, recipients: number, agentDay?: number): Promise<{ ok: true; id: number } | { ok: false; error: string }>;
	refundSendBudget(id: number): Promise<void>;
	claimSendKey(key: string, contentHash?: string | null): Promise<SendKeyClaim>;
	startSendKey(key: string): Promise<boolean>;
	recordSendProvider(key: string, providerId: string | null, error?: string | null): Promise<void>;
	finishSendKey(key: string, emailId: string): Promise<void>;
	failSendKey(key: string, error: string): Promise<void>;
}

/** An attempt that is still open, returned instead of sending again. */
export type OpenAttempt = { state: "pending" | "sending"; providerId: string | null };

export type SendResult =
	| { ok: true; id: string; duplicate?: true }
	| { ok: false; status: 400 | 404 | 409 | 429; error: string; attempt?: OpenAttempt };

export interface SendOptions {
	/**
	 * Hand delivery to the caller (e.g. waitUntil) after the Sent copy is
	 * stored. The attempt stays in sending until delivery settles; a delivery
	 * the mail service rejected refunds the budget, fails the key and moves the
	 * copy to Drafts. Without it, delivery runs first and a rejection throws
	 * before anything is stored, so the caller can retry.
	 *
	 * Any other delivery error may have come after the message was accepted, so
	 * the attempt stays in sending with the error saved and is not retried.
	 */
	defer?: (delivery: Promise<unknown>) => void;
	/**
	 * Send at most once per key (see send-keys.ts). A repeat with a key that
	 * already sent returns the first send's id with `duplicate: true`.
	 */
	idempotencyKey?: string;
	/** Who asked for the send, for the limits in send-budget.ts. Defaults to a person. */
	actor?: SendActor;
	/** Agent limits to apply instead of the saved ones (lib/agent-limits.ts). */
	limits?: AgentLimits;
}

const DEFERRED_LABEL: Record<SendMode["kind"], string> = { new: "email", reply: "reply", forward: "forward" };

const joinList = (value: string | string[]) => (Array.isArray(value) ? value.join(", ") : value);

export async function sendMail(
	env: Env,
	mailboxId: string,
	stub: SendStub,
	body: SendEmailRequest,
	mode: SendMode,
	options: SendOptions = {},
): Promise<SendResult> {
	const key = options.idempotencyKey;
	if (!key) return sendOnce(env, mailboxId, stub, body, mode, options, null, () => {});

	const claim = await stub.claimSendKey(key, await sendContentHash([mode, body]));
	if (claim.state === "sent") return { ok: true, id: claim.id, duplicate: true };
	if (claim.state === "conflict") return { ok: false, status: 409, error: SEND_KEY_CONFLICT_ERROR };
	if (claim.state !== "new") {
		return {
			ok: false, status: 409,
			error: claim.state === "sending" ? SEND_KEY_SENDING_ERROR : SEND_KEY_PENDING_ERROR,
			attempt: { state: claim.state, providerId: claim.providerId },
		};
	}

	// Once delivery may have happened the attempt stays in sending, even if storing the Sent copy fails.
	let delivered = false;
	try {
		const result = await sendOnce(env, mailboxId, stub, body, mode, options, key, () => { delivered = true; });
		if (result.ok) {
			// A deferred send finishes its key when delivery settles (sendOnce).
			if (!options.defer) await stub.finishSendKey(key, result.id);
		} else if (!result.attempt) await stub.failSendKey(key, result.error);
		return result;
	} catch (e) {
		if (!delivered) await stub.failSendKey(key, (e as Error).message || "Delivery failed");
		throw e;
	}
}

/** The original's attachments named by id, read from R2 as base64, or null when one is missing. */
async function forwardedAttachments(bucket: Env["BUCKET"], original: EmailFull, ids: string[]) {
	const out: NonNullable<SendEmailRequest["attachments"]> = [];
	for (const id of ids) {
		const att = original.attachments?.find((a) => a.id === id);
		if (!att) return null;
		const obj = await bucket.get(`attachments/${original.id}/${att.id}/${att.filename}`);
		if (!obj) return null;
		const bytes = new Uint8Array(await obj.arrayBuffer());
		let binary = "";
		for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		out.push({
			content: btoa(binary), filename: att.filename, type: att.mimetype || "application/octet-stream",
			disposition: "attachment",
		});
	}
	return out;
}

async function sendOnce(
	env: Env,
	mailboxId: string,
	stub: SendStub,
	body: SendEmailRequest,
	mode: SendMode,
	options: SendOptions,
	key: string | null,
	onDelivered: () => void,
): Promise<SendResult> {
	const { to, cc, bcc, from, subject, html, text } = body;
	let attachments = body.attachments;

	// Threading for this send.
	let inReplyTo: string | null = null;
	let references: string[] = [];
	let threadId: string | null = null;
	let markRead: string | null = null;
	if (mode.kind !== "new") {
		const rawOriginal = (await stub.getEmail(mode.originalId)) as EmailFull | null;
		if (!rawOriginal) return { ok: false, status: 404, error: "Original email not found" };
		const original = await resolveOriginalEmail(stub, rawOriginal);
		if (mode.kind === "forward" && body.forward_attachments?.length) {
			const copied = await forwardedAttachments(env.BUCKET, rawOriginal, body.forward_attachments);
			if (!copied) return { ok: false, status: 404, error: "An attachment of the forwarded email was not found" };
			attachments = [...copied, ...(attachments ?? [])];
		}
		if (mode.kind === "reply") {
			const chain = buildReferencesChain(original);
			inReplyTo = chain.originalMsgId;
			references = chain.references;
			threadId = chain.threadId;
			markRead = chain.threadId;
		}
	} else {
		inReplyTo = body.in_reply_to || null;
		references = body.references || [];
		threadId = body.thread_id || body.in_reply_to || null;
	}
	if (hasHeaderLineBreaks(subject, inReplyTo, ...references)) {
		return { ok: false, status: 400, error: "Email headers must not contain line breaks" };
	}
	const tooLarge = messageSizeError(messageBytes({ html, text, fileBytes: (attachments ?? []).map((a) => base64Bytes(a.content)) }));
	if (tooLarge) return { ok: false, status: 400, error: tooLarge };

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return { ok: false, status: 400, error: e.message };
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const actor = options.actor ?? "person";
	const recipients = countRecipients(to, cc, bcc);
	const limits = isAgent(actor) ? options.limits ?? (await readAgentLimits(env)) : DEFAULT_AGENT_LIMITS;
	const tooMany = recipientLimitError(actor, recipients, limits);
	if (tooMany) return { ok: false, status: 400, error: tooMany };
	const budget = await stub.takeSendBudget(actor, recipients, limits.agentDay);
	if (!budget.ok) return { ok: false, status: 429, error: budget.error };
	if (key && !(await stub.startSendKey(key))) {
		await stub.refundSendBudget(budget.id);
		return { ok: false, status: 409, error: SEND_KEY_PENDING_ERROR, attempt: { state: "sending", providerId: null } };
	}

	const deliver = () =>
		sendEmail(env.EMAIL, {
			to, cc, bcc, from, subject, html, text,
			attachments: attachments?.map((att) => ({
				content: att.content, filename: att.filename, type: att.type,
				disposition: att.disposition || "attachment", contentId: att.contentId,
			})),
			...(inReplyTo ? { headers: buildThreadingHeaders(inReplyTo, references) } : {}),
		});

	if (!options.defer) {
		let providerId: string;
		try {
			({ messageId: providerId } = await deliver());
		} catch (e) {
			if (sendWasRejected(e)) await stub.refundSendBudget(budget.id);
			else {
				onDelivered();
				if (key) await stub.recordSendProvider(key, null, (e as Error).message || "Delivery failed");
			}
			throw e;
		}
		onDelivered();
		if (key) await stub.recordSendProvider(key, providerId || null);
	}

	try {
		const attachmentData = await storeAttachments(env.BUCKET, messageId, attachments);
		const now = new Date().toISOString();
		await stub.createEmail(Folders.SENT, {
			id: messageId, subject, sender: fromEmail, recipient: toStr,
			cc: cc ? joinList(cc).toLowerCase() : null,
			bcc: bcc ? joinList(bcc).toLowerCase() : null,
			date: now, body: html || text || "",
			in_reply_to: inReplyTo,
			email_references: mode.kind === "reply" || (mode.kind === "new" && body.references)
				? JSON.stringify(references)
				: null,
			thread_id: threadId || messageId,
			message_id: outgoingMessageId,
			raw_headers: JSON.stringify([
				{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
				{ key: "to", value: joinList(to) },
				...(cc ? [{ key: "cc", value: joinList(cc) }] : []),
				...(bcc ? [{ key: "bcc", value: joinList(bcc) }] : []),
				{ key: "subject", value: subject },
				{ key: "date", value: now },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
				...(mode.kind === "reply" && inReplyTo ? [{ key: "in-reply-to", value: `<${inReplyTo}>` }] : []),
				...(mode.kind === "reply" && references.length > 0
					? [{ key: "references", value: references.map((r) => `<${r}>`).join(" ") }]
					: []),
			]),
		}, attachmentData);
	} catch (e) {
		// Nothing has gone out yet on a deferred send, so give back the slot.
		if (options.defer) await stub.refundSendBudget(budget.id);
		throw e;
	}

	if (markRead) await stub.markThreadRead(markRead);

	if (options.defer) {
		const label = DEFERRED_LABEL[mode.kind];
		options.defer(deliver().then(
			async ({ messageId: providerId }) => {
				if (!key) return;
				await stub.recordSendProvider(key, providerId || null);
				await stub.finishSendKey(key, messageId);
			},
			async (e) => {
				const error = (e as Error).message || "Delivery failed";
				console.error(`Deferred ${label} delivery failed:`, error);
				// It may have gone out: keep the Sent copy and leave the attempt in sending.
				if (!sendWasRejected(e)) {
					if (key) await stub.recordSendProvider(key, null, error).catch(() => {});
					return;
				}
				// Nothing went out: give back the slot and put the message where the sender will see it.
				await stub.refundSendBudget(budget.id).catch(() => {});
				await stub.moveEmail(messageId, Folders.DRAFT).catch(() => {});
				if (key) await stub.failSendKey(key, error).catch(() => {});
			},
		));
	}
	return { ok: true, id: messageId };
}
