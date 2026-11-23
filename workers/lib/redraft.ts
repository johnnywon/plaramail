// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Redraft: revise an agent draft with a one-off instruction ("shorter",
 * "decline politely"). The model sees the draft, the address's prompt and
 * the email it answers after the same injection scan as
 * auto-draft. It has no tools: its only output is the new body, which
 * replaces the draft. The instruction is added to the draft's notes.
 */
import { REDRAFT_INSTRUCTION_MAX, type DraftNotes } from "../../shared/draft-notes";
import { Folders } from "../../shared/folders";
import { prepareAutoDraft } from "../agent/auto-draft";
import type { MailboxStore } from "../store";
import { deleteAttachmentFiles } from "./attachments";
import { splitQuotedBlock } from "./ai";
import { textToHtml } from "./email-helpers";
import type { EmailFull } from "./schemas";

export interface RedraftDeps {
	ai: Ai;
	bucket: R2Bucket;
	/** The address's system prompt. */
	system: string;
	/** One model call: system and prompt in, text out. */
	write: (system: string, prompt: string) => Promise<string>;
	/** The same check agent drafts get (verifyDraft). Empty means nothing usable. */
	verify: (text: string) => Promise<string>;
	/** The id of the model `write` uses. The redraft's notes name it: it wrote the new text. */
	model?: string | null;
}

export type RedraftResult =
	| { ok: true; draft: { id: string; subject: string; recipient: string; body: string }; notes: DraftNotes }
	| { ok: false; status: 400 | 404 | 422 | 502; error: string };

/** HTML to plain text with line breaks kept. */
export function htmlToLines(html: string): string {
	return html
		.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function redraftPrompt(input: { draft: string; instruction: string; email?: { from: string; subject: string; body: string } | null }): string {
	const parts = [`Revise this email draft. Follow the operator's instruction and keep everything else that still fits.

Instruction: ${input.instruction}

Current draft:
${input.draft || "(empty)"}`];
	if (input.email) {
		parts.push(`The email this draft answers:
From: ${input.email.from}
Subject: ${input.email.subject}

${input.email.body || "(empty)"}`);
	}
	parts.push("Reply with only the revised email body, as plain text. No subject line, no commentary, no quoted original.");
	return parts.join("\n\n");
}

export async function redraft(
	stub: MailboxStore,
	mailboxId: string,
	draftId: string,
	instruction: string,
	deps: RedraftDeps,
): Promise<RedraftResult> {
	const wanted = instruction.trim();
	if (!wanted) return { ok: false, status: 400, error: "Say how to change the draft" };
	if (wanted.length > REDRAFT_INSTRUCTION_MAX) return { ok: false, status: 400, error: `Keep the instruction under ${REDRAFT_INSTRUCTION_MAX} characters` };

	const draft = (await stub.getEmail(draftId)) as EmailFull | null;
	if (!draft || draft.folder_id !== Folders.DRAFT) return { ok: false, status: 404, error: "Draft not found" };
	const notes = draft.draft_notes ?? (await stub.getDraftNotes(draftId));
	if (!notes) return { ok: false, status: 400, error: "Only drafts an agent wrote can be redrafted" };
	if (draft.attachments?.length) return { ok: false, status: 400, error: "Redraft works on drafts without attachments" };

	// The email it answers, scanned like auto-draft's input. A failed scan stops the redraft.
	let email: { from: string; subject: string; body: string } | null = null;
	if (draft.in_reply_to) {
		const prepared = await prepareAutoDraft(deps.ai, stub, { emailId: draft.in_reply_to, threadId: draft.thread_id || draft.in_reply_to });
		if (!prepared.ok && prepared.reason !== "email not found") return { ok: false, status: 422, error: `Can't redraft: ${prepared.reason}` };
		if (prepared.ok) {
			const m = prepared.context.email;
			email = { from: m.sender_name ? `${m.sender_name} <${m.sender}>` : m.sender, subject: m.subject, body: m.body_text };
		}
	}

	const { reply, quoted } = splitQuotedBlock(draft.body ?? "");
	let text: string;
	try {
		text = (await deps.write(deps.system, redraftPrompt({ draft: htmlToLines(reply), instruction: wanted, email }))).trim();
	} catch (e) {
		return { ok: false, status: 502, error: `The model failed: ${(e as Error).message}`.slice(0, 300) };
	}
	const verified = text ? (await deps.verify(text)).trim() : "";
	if (!verified) return { ok: false, status: 502, error: "The model returned no draft. Try again or reword the instruction." };
	const html = /<[a-z][\s\S]*>/i.test(verified) ? verified : textToHtml(verified);

	// Replace the draft, as saving a draft does, and carry its notes forward.
	const next: DraftNotes = { ...notes, instructions: [...notes.instructions, wanted], model: deps.model ?? null };
	const id = crypto.randomUUID();
	await stub.createEmail(Folders.DRAFT, {
		id,
		subject: draft.subject ?? "",
		sender: mailboxId.toLowerCase(),
		recipient: draft.recipient ?? "",
		cc: draft.cc ?? null,
		bcc: draft.bcc ?? null,
		date: new Date().toISOString(),
		body: html + quoted,
		in_reply_to: draft.in_reply_to ?? null,
		email_references: draft.email_references ?? null,
		thread_id: draft.thread_id || id,
	}, []);
	await stub.setDraftNotes(id, next);
	const attachments = await stub.deleteEmail(draftId);
	if (attachments) await deleteAttachmentFiles(deps.bucket, draftId, attachments);
	return { ok: true, draft: { id, subject: draft.subject ?? "", recipient: draft.recipient ?? "", body: html + quoted }, notes: next };
}
