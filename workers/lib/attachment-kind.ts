// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Which attachments get their text searched: PDFs, Word, Excel and OpenDocument files go through
 * Workers AI `toMarkdown`; text files are decoded in the Worker. Inline
 * parts and files over 10 MB are left out. A file counts by its type or,
 * when the sender gave a generic type, by its extension.
 *
 * migrations/0003_attachment_text.sql queues older attachments with the
 * same rule in SQL; tests/attachment-text.test.mjs checks the two agree.
 */

export const ATTACHMENT_SIZE_MAX = 10 * 1024 * 1024;

export type TextKind = "markdown" | "plain";

const MARKDOWN: Record<string, string> = {
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
	xls: "application/vnd.ms-excel",
	odt: "application/vnd.oasis.opendocument.text",
	ods: "application/vnd.oasis.opendocument.spreadsheet",
};

const PLAIN: Record<string, string> = {
	txt: "text/plain",
	csv: "text/csv",
	md: "text/markdown",
};

export interface AttachmentFacts {
	filename: string;
	mimetype: string;
	size: number;
	disposition?: string | null;
}

/** How the attachment's text is read, or null when it isn't searched. */
export function textKind(a: AttachmentFacts): TextKind | null {
	if ((a.disposition ?? "attachment") === "inline" || a.size > ATTACHMENT_SIZE_MAX) return null;
	const type = a.mimetype.toLowerCase().split(";")[0].trim();
	const ext = /\.([a-z0-9]+)$/i.exec(a.filename)?.[1]?.toLowerCase() ?? "";
	if (Object.values(MARKDOWN).includes(type) || ext in MARKDOWN) return "markdown";
	if (Object.values(PLAIN).includes(type) || ext in PLAIN) return "plain";
	return null;
}

/** toMarkdown wants a file name it recognizes; give one the right extension when the sender's doesn't have it. */
export function markdownName(a: AttachmentFacts): string {
	const ext = /\.([a-z0-9]+)$/i.exec(a.filename)?.[1]?.toLowerCase() ?? "";
	if (ext in MARKDOWN) return a.filename;
	const type = a.mimetype.toLowerCase().split(";")[0].trim();
	const known = Object.entries(MARKDOWN).find(([, t]) => t === type)?.[0];
	return known ? `${a.filename}.${known}` : a.filename;
}
