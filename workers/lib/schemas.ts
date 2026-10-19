// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared types and Zod schemas for email data.
 *
 * Types (from email-types.ts): used by the agent, MCP server, and route
 * handlers to avoid `as any` casting.
 *
 * Zod schemas: used across route handlers to eliminate duplication.
 */
import { z } from "zod";
import type { DraftNotes } from "../../shared/draft-notes";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailMetadata {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	read: boolean;
	starred: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	folder_id?: string | null;
	snippet?: string | null;
}

export interface EmailFull extends EmailMetadata {
	body?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: AttachmentInfo[];
	/** Drafts an agent made: how it made them. */
	draft_notes?: DraftNotes;
}

export interface AttachmentInfo {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const RecipientFieldSchema = z.union([
	z.string().email(),
	z.array(z.string().email()).min(1),
]);

export const HeaderSafeStringSchema = z.string().max(998).refine((value) => !/[\r\n]/.test(value), {
	message: "must not contain line breaks",
});
export const HeaderValueSchema = HeaderSafeStringSchema;

export function hasHeaderLineBreaks(...values: (string | null | undefined)[]): boolean {
	return values.some((value) => value != null && /[\r\n]/.test(value));
}

export const MailboxSettingsSchema = z.object({
	fromName: z.string().max(200).optional(),
	forwarding: z.object({
		enabled: z.boolean(),
		email: z.union([z.literal(""), z.string().email()]),
	}).optional(),
	signature: z.object({
		enabled: z.boolean(),
		text: z.string().max(10000),
		html: z.string().optional(),
	}).optional(),
	autoReply: z.object({
		enabled: z.boolean(),
		subject: HeaderValueSchema,
		message: z.string().max(10000),
	}).optional(),
	agentSystemPrompt: z.string().max(20000).optional(),
});

export const ErrorResponseSchema = z.object({
	error: z.string(),
});

export const SendEmailRequestSchema = z
	.object({
		to: RecipientFieldSchema,
		cc: RecipientFieldSchema.optional(),
		bcc: RecipientFieldSchema.optional(),
		from: z.union([
			z.string().email(),
			z.object({ email: z.string().email(), name: z.string() }),
		]),
		subject: HeaderValueSchema,
		html: z.string().optional(),
		text: z.string().optional(),
		attachments: z
			.array(
				z.object({
					content: z.string(), // base64 encoded
					filename: z.string(),
					type: z.string(),
					disposition: z.enum(["attachment", "inline"]),
					contentId: z.string().optional(),
				}),
			)
			.optional(),
		/** On a forward: ids of the original's attachments to send with it, copied from R2. */
		forward_attachments: z.array(z.string().min(1).max(100)).max(50).optional(),
		in_reply_to: HeaderValueSchema.optional(),
		references: z.array(HeaderValueSchema).max(100).optional(),
		thread_id: HeaderValueSchema.optional(),
	})
	.refine((data) => data.html || data.text, {
		message: "Either 'html' or 'text' must be provided",
	});

export const SendEmailResponseSchema = z.object({
	id: z.string(),
	status: z.string(),
});
