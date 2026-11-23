// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared utility functions used across the frontend.
 *
 * Date formatting lives in `shared/dates.ts`.
 */
import DOMPurify from "dompurify";
import type { Attachment } from "~/types";
import { isHtmlBody, plainTextToHtml } from "../components/plain-text";

/**
 * Split a comma-separated email field into individual addresses.
 */
export function splitEmailList(value?: string | null): string[] {
	return (value || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * Convert HTML content to plain text.
 * Uses DOM APIs so must only be called client-side.
 */
export function htmlToPlainText(html: string): string {
	// Sanitize with DOMPurify before DOM parsing to prevent XSS during innerHTML assignment.
	// DOMPurify strips all dangerous content (scripts, event handlers, etc.)
	// while preserving structural HTML for text extraction.
	const sanitized = DOMPurify.sanitize(html);
	const div = document.createElement("div");
	div.innerHTML = sanitized
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<p[^>]*>/gi, "")
		.replace(/<div[^>]*>/gi, "")
		.replace(/<\/div>/gi, "\n");
	return (div.textContent || div.innerText || "").trim();
}

/**
 * Escape all five OWASP-recommended HTML special characters in plain text.
 * Safe for use in both text content and attribute contexts.
 */
export function escapeHtml(text: string): string {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Generate the HTML signature block for compose forms.
 */
export function getSignatureBlock(settings?: {
	signature?: { enabled: boolean; text?: string; html?: string };
}): string {
	const sig = settings?.signature;
	if (sig?.enabled && (sig?.html || sig?.text)) {
		// Sanitize HTML signatures with DOMPurify to allow safe formatting
		// (bold, italic, links, etc.) while stripping scripts and event handlers.
		// Text signatures are HTML-escaped since they have no formatting.
		const content = sig.html
			? DOMPurify.sanitize(sig.html)
			: escapeHtml(sig.text || "");
		return `<div style="border-top: 1px solid #ccc; margin-top: 16px; padding-top: 12px;">${content}</div>`;
	}
	return "";
}

/**
 * Rewrite CID references in email HTML to API URLs for inline images.
 * Replaces `src="cid:image001@example.com"` with the attachment API endpoint.
 */
export function rewriteInlineImages(
	body: string,
	mailboxId: string,
	emailId: string,
	attachments?: { id: string; content_id?: string | null; disposition?: string | null }[],
): string {
	if (!body || !attachments?.length) return body;
	let result = body;
	for (const att of attachments) {
		if (att.disposition === "inline" && att.content_id) {
			const url = `/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${att.id}`;
			// Strip angle brackets from content_id if present
			const cid = att.content_id.startsWith("<")
				? att.content_id.slice(1, -1)
				: att.content_id;
			// The sender writes the Content-ID. One with quotes or brackets could break the markup around it.
			if (!/^[^\s"'<>]+$/.test(cid)) continue;
			result = result.replace(new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi"), url);
		}
	}
	return result;
}

/**
 * The HTML the reader shows for a message body. Text-only mail becomes HTML the
 * app writes from escaped text; it has no cid: images, so the rewrite is for HTML mail only.
 */
export function messageBodyHtml(
	raw: string,
	mailboxId: string,
	emailId: string,
	attachments?: { id: string; content_id?: string | null; disposition?: string | null }[],
): string {
	if (!isHtmlBody(raw)) return plainTextToHtml(raw);
	return rewriteInlineImages(raw, mailboxId, emailId, attachments);
}

export function getNonInlineAttachments(attachments?: Attachment[]): Attachment[] {
	return attachments?.filter((attachment) => attachment.disposition !== "inline") ?? [];
}

export function getAttachmentUrl(
	mailboxId: string,
	emailId: string,
	attachmentId: string,
): string {
	return `/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`;
}
