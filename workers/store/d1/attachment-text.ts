// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Attachment text for search, run by the cron when ATTACHMENT_SEARCH is
 * "true". Each run claims a few
 * queued attachments, reads each file from R2, converts it, stores the text
 * (capped at 64 KB) and rewrites the message's word-index row with the text
 * after the body, and its attachment_trigram row for substring search. Inbound mail never waits for it.
 *
 * States: pending, working (claimed by a run), done, skipped (the file is
 * gone from R2), failed. A claim older than CLAIM_STALE_MS means the run
 * died on that file, so it counts as failed rather than being retried.
 */
import { markdownName, textKind } from "../../lib/attachment-kind";
import { htmlToText } from "../../lib/message-meta";
import type { Sql } from "../sql";
import { attachmentKey, attachmentNames, ftsInsert } from "./rows";
import { foldLetters } from "../../lib/search-fold";

export const ATTACHMENT_TEXT_MAX = 64 * 1024;
export const ATTACHMENT_BATCH = 5;
export const CLAIM_STALE_MS = 10 * 60_000;

export interface TextSources {
	bucket: { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> } | null> };
	/** One toMarkdown call. Throws or returns { error } when the file can't be converted. */
	toMarkdown(name: string, blob: Blob): Promise<{ text: string } | { error: string }>;
}

/** The first `max` bytes of `text` as UTF-8, without a split character at the end. */
export function capText(text: string, max = ATTACHMENT_TEXT_MAX): string {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= max) return text;
	return new TextDecoder().decode(bytes.slice(0, max)).replace(/�+$/, "");
}

/**
 * Control characters become spaces (some PDFs map hyphens to NUL, and SQLite's
 * text functions stop at a NUL); whitespace runs inside lines collapse;
 * blank-line runs become one.
 */
export function tidy(text: string): string {
	return text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0B-\x1F\x7F]/g, " ").replace(/[ \t\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

/**
 * toMarkdown's own framing, dropped so it isn't indexed as words: the file
 * name heading, a PDF's "## Metadata" list (PDFFormatVersion=1.4 and so on),
 * and the "## Contents" and "### Page N" headings.
 */
export function stripFraming(markdown: string, name: string): string {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	if (lines[0]?.trim() === `# ${name}`) lines.shift();
	const out: string[] = [];
	let inMetadata = false;
	for (const line of lines) {
		if (/^##\s+Metadata\s*$/.test(line)) {
			inMetadata = true;
			continue;
		}
		if (inMetadata && (/^-\s/.test(line) || line.trim() === "")) continue;
		inMetadata = false;
		if (/^##\s+Contents\s*$/.test(line) || /^###\s+Page \d+\s*$/.test(line)) continue;
		out.push(line);
	}
	return out.join("\n");
}

type Outcome = { state: "done"; text: string } | { state: "skipped" | "failed"; text: null };

async function convert(sources: TextSources, a: { id: string; email_id: string; filename: string; mimetype: string; size: number }): Promise<Outcome> {
	const kind = textKind(a);
	if (!kind) return { state: "skipped", text: null };
	const obj = await sources.bucket.get(attachmentKey(a));
	if (!obj) return { state: "skipped", text: null };
	try {
		if (kind === "plain") return { state: "done", text: capText(tidy(new TextDecoder().decode(await obj.arrayBuffer()))) };
		const name = markdownName(a);
		const out = await sources.toMarkdown(name, new Blob([await obj.arrayBuffer()], { type: a.mimetype }));
		if ("error" in out) {
			console.error(`attachment text: ${a.id} not converted: ${out.error.slice(0, 200)}`);
			return { state: "failed", text: null };
		}
		return { state: "done", text: capText(tidy(stripFraming(out.text, name))) };
	} catch (e) {
		console.error(`attachment text: ${a.id} failed: ${(e as Error).message}`);
		return { state: "failed", text: null };
	}
}

/** Rewrite one message's word-index row from its stored fields, body and attachment text. */
export async function reindexMessage(sql: Sql, bucket: TextSources["bucket"], emailId: string): Promise<boolean> {
	const [message] = await sql.all(
		`SELECT id, subject, sender_name, sender_addr, recipients, body, body_key FROM messages WHERE email_id = ?`,
		emailId,
	);
	if (!message) return false;
	const body = message.body != null ? String(message.body) : message.body_key ? ((await (await bucket.get(String(message.body_key)))?.text()) ?? "") : "";
	const attachments = await sql.all(
		`SELECT a.filename, a.disposition, t.text FROM attachments a LEFT JOIN attachment_text t ON t.attachment_id = a.id AND t.state = 'done'
		WHERE a.email_id = ? ORDER BY a.rowid`,
		emailId,
	);
	const texts = attachments.map((a) => (a.text == null ? "" : String(a.text))).filter((t) => t.length > 0);
	await sql.batch([
		{ sql: `DELETE FROM messages_fts WHERE rowid = ?`, params: [message.id] },
		{ sql: `DELETE FROM attachment_trigram WHERE rowid = ?`, params: [message.id] },
		...(texts.length > 0
			? [{ sql: `INSERT INTO attachment_trigram (rowid, text) SELECT id, ? FROM messages WHERE email_id = ?`, params: [foldLetters(texts.join("\n\n")), emailId] }]
			: []),
		ftsInsert(emailId, {
			subject: String(message.subject ?? ""),
			senderName: String(message.sender_name ?? ""),
			senderAddr: String(message.sender_addr ?? ""),
			recipients: String(message.recipients ?? ""),
			bodyText: [htmlToText(body), ...texts].join("\n\n"),
			attachmentNames: attachmentNames(attachments.map((a) => ({ filename: String(a.filename), disposition: (a.disposition as string | null) ?? null }))),
		}),
	]);
	return true;
}

/** One cron batch. Returns how many attachments ended in each state. */
export async function extractAttachmentText(sql: Sql, sources: TextSources, now = Date.now(), limit = ATTACHMENT_BATCH) {
	const at = new Date(now).toISOString();
	await sql.run(
		`UPDATE attachment_text SET state = 'failed', updated_at = ? WHERE state = 'working' AND updated_at < ?`,
		at, new Date(now - CLAIM_STALE_MS).toISOString(),
	);
	const claimed = await sql.all(
		`UPDATE attachment_text SET state = 'working', updated_at = ?
		WHERE attachment_id IN (SELECT attachment_id FROM attachment_text WHERE state = 'pending' ORDER BY updated_at DESC LIMIT ?)
		RETURNING attachment_id`,
		at, limit,
	);
	const counts = { done: 0, skipped: 0, failed: 0 };
	if (claimed.length === 0) return counts;
	const rows = await sql.all(
		`SELECT id, email_id, filename, mimetype, size FROM attachments WHERE id IN (SELECT value FROM json_each(?))`,
		JSON.stringify(claimed.map((r) => String(r.attachment_id))),
	);
	const touched = new Set<string>();
	for (const row of rows) {
		const a = { id: String(row.id), email_id: String(row.email_id), filename: String(row.filename), mimetype: String(row.mimetype), size: Number(row.size) };
		const out = await convert(sources, a);
		await sql.run(
			`UPDATE attachment_text SET state = ?, text = ?, updated_at = ? WHERE attachment_id = ? AND state = 'working'`,
			out.state, out.text, new Date().toISOString(), a.id,
		);
		counts[out.state]++;
		if (out.state === "done" && out.text) touched.add(a.email_id);
	}
	for (const emailId of touched) await reindexMessage(sql, sources.bucket, emailId);
	return counts;
}

/** Workers AI's toMarkdown as a TextSources converter. */
export function workersAiMarkdown(ai: Ai): TextSources["toMarkdown"] {
	return async (name, blob) => {
		const out = await ai.toMarkdown({ name, blob });
		return out.format === "markdown" ? { text: out.data } : { error: out.error };
	};
}
