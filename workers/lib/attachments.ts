// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared attachment storage logic.
 * Eliminates the triplicated atob → Uint8Array → R2.put pattern.
 */
import type { Env } from "../types";

export interface StoredAttachment {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string;
}

/**
 * The disposition to store for a received part. postal-mime gives null when
 * the part has no Content-Disposition. Such a part is inline when the HTML
 * body shows it through cid:, so the reader rewrites the image and the message
 * is not marked as having a file. postal-mime's `related` flag is not used: it
 * is set on every part with a Content-ID, inside multipart/related or not.
 */
export function inboundDisposition(
	part: { disposition?: string | null; contentId?: string },
	html: string | undefined,
): string {
	if (part.disposition) return part.disposition;
	const cid = part.contentId?.replace(/^<|>$/g, "").trim();
	return cid && (html ?? "").toLowerCase().includes(`cid:${cid.toLowerCase()}`) ? "inline" : "attachment";
}

export async function deleteAttachmentFiles(
	bucket: Env["BUCKET"],
	emailId: string,
	attachments: { id: string; filename: string }[],
) {
	if (attachments.length === 0) return;
	await bucket.delete(attachments.map(({ id, filename }) => `attachments/${emailId}/${id}/${filename}`));
}

/**
 * Store base64-encoded attachments to R2 and return metadata for the store.
 */
export async function storeAttachments(
	bucket: Env["BUCKET"],
	emailId: string,
	attachments?: {
		content: string;
		filename: string;
		type: string;
		disposition: string;
		contentId?: string;
	}[],
): Promise<StoredAttachment[]> {
	if (!attachments?.length) return [];

	const results: StoredAttachment[] = [];
	for (const att of attachments) {
		const attachmentId = crypto.randomUUID();
		// Sanitize filename to prevent path traversal in R2 keys
		const safeFilename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
		const key = `attachments/${emailId}/${attachmentId}/${safeFilename}`;
		const binaryStr = atob(att.content);
		const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
		await bucket.put(key, bytes);
		results.push({
			id: attachmentId,
			email_id: emailId,
			filename: safeFilename,
			mimetype: att.type,
			size: bytes.byteLength,
			content_id: att.contentId || null,
			disposition: att.disposition,
		});
	}
	return results;
}
