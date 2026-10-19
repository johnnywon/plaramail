// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email sending via Cloudflare Email Service binding.
 *
 * Uses the `send_email` Worker binding (`env.EMAIL.send()`) to send emails.
 *
 * See: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */
import { htmlToTextAlternative } from "./lib/text-alternative";

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	headers?: Record<string, string>;
}

/**
 * Send an email using the Cloudflare Email Service binding.
 *
 * @param binding  - The `EMAIL` SendEmail binding from env
 * @param params   - Email parameters (to, from, subject, body, etc.)
 * @returns The send result with messageId
 * @throws On validation or delivery errors (error has `.code` property)
 */
export async function sendEmail(
	binding: SendEmail,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	const message: Record<string, unknown> = {
		to: params.to,
		from: params.from,
		subject: params.subject,
	};

	if (params.html) message.html = params.html;
	// HTML always goes with a text part for the mail service to send as its alternative (lib/text-alternative.ts).
	const text = params.text || (params.html ? htmlToTextAlternative(params.html) : "");
	if (text) message.text = text;
	if (params.cc) message.cc = params.cc;
	if (params.bcc) message.bcc = params.bcc;
	if (params.replyTo) message.replyTo = params.replyTo;

	if (params.headers && Object.keys(params.headers).length > 0) {
		message.headers = params.headers;
	}

	if (params.attachments && params.attachments.length > 0) {
		// The binding sends a string as the file's own text, so decode the base64.
		message.attachments = params.attachments.map((att) => ({
			content: Uint8Array.from(atob(att.content), (c) => c.charCodeAt(0)),
			filename: att.filename,
			type: att.type,
			disposition: att.disposition,
			...(att.contentId ? { contentId: att.contentId } : {}),
		}));
	}

	// Local (Miniflare) bindings resolve without a result.
	const result = (await binding.send(message as any)) as { messageId?: string } | undefined;
	return { messageId: result?.messageId ?? "" };
}

/**
 * Codes the mail service returns when it refused the message, so nothing
 * went out. Any other throw (an internal error, a delivery failure, a
 * timeout with no code) may have come after the message was accepted.
 */
const REJECTED_CODES = new Set([
	"E_VALIDATION_ERROR", "E_FIELD_MISSING", "E_TOO_MANY_RECIPIENTS", "E_TOO_MANY_ATTACHMENTS",
	"E_SENDER_NOT_VERIFIED", "E_RECIPIENT_NOT_ALLOWED", "E_RECIPIENT_SUPPRESSED", "E_SENDER_DOMAIN_NOT_AVAILABLE",
	"E_CONTENT_TOO_LARGE", "E_HEADER_NOT_ALLOWED", "E_HEADER_USE_API_FIELD", "E_HEADER_VALUE_INVALID",
	"E_HEADER_VALUE_TOO_LONG", "E_HEADER_NAME_INVALID", "E_HEADERS_TOO_LARGE", "E_HEADERS_TOO_MANY",
	"E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED",
]);

/** True when a send error proves the mail service did not accept the message. */
export function sendWasRejected(error: unknown): boolean {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && REJECTED_CODES.has(code);
}
