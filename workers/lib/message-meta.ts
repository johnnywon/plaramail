// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Pure helpers that turn a stored email into the columns the list and search
 * read: sender parts, list headers, body text.
 */

/** Body text goes into the word index, capped per message. */
export const BODY_TEXT_LIMIT = 32 * 1024;

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
		if (code[0] === "#") {
			const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
		}
		return NAMED_ENTITIES[code.toLowerCase()] ?? match;
	});
}

/** Strip HTML to searchable plain text. Plain-text bodies pass through with whitespace collapsed. */
export function htmlToText(body: string | null | undefined): string {
	if (!body) return "";
	const text = body
		.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<[^>]+>/g, " ");
	return decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, BODY_TEXT_LIMIT);
}

function headerValue(rawHeaders: string | null | undefined, key: string): string | null {
	if (!rawHeaders) return null;
	try {
		const headers = JSON.parse(rawHeaders) as { key?: string; value?: string }[];
		if (!Array.isArray(headers)) return null;
		const found = headers.find((h) => h?.key?.toLowerCase() === key);
		return typeof found?.value === "string" ? found.value : null;
	} catch {
		return null;
	}
}

/** Sender address, display name and domain. The name comes from the From header when it has one. */
export function parseSender(sender: string | null | undefined, rawHeaders: string | null | undefined) {
	const addr = (sender ?? "").trim().toLowerCase();
	const from = headerValue(rawHeaders, "from");
	let name = "";
	const match = from?.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
	if (match) name = match[1].trim();
	return { addr, name, domain: addr.includes("@") ? addr.slice(addr.lastIndexOf("@") + 1) : "" };
}

/** List-Id and List-Unsubscribe targets. `unsubscribe` is JSON `{ urls, oneClick }` or null. */
export function listHeaders(rawHeaders: string | null | undefined) {
	const listIdRaw = headerValue(rawHeaders, "list-id");
	const listId = listIdRaw ? (listIdRaw.match(/<([^>]+)>/)?.[1] ?? listIdRaw).trim().toLowerCase() : null;
	const unsubRaw = headerValue(rawHeaders, "list-unsubscribe");
	const urls = unsubRaw ? [...unsubRaw.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim()).filter(Boolean) : [];
	const post = headerValue(rawHeaders, "list-unsubscribe-post");
	const oneClick = !!post && /list-unsubscribe\s*=\s*one-click/i.test(post);
	return {
		list_id: listId || null,
		unsubscribe: urls.length > 0 ? JSON.stringify({ urls, oneClick }) : null,
	};
}

const NO_REPLY_SENDER = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)([+.-][^@]*)?@/i;

/**
 * Why a message should get no automatic reply, or null for mail a person
 * sent. Covers RFC 3834 Auto-Submitted, Precedence bulk/list/junk, mailing
 * list headers, auto-responder markers and no-reply senders. Replying to these
 * wastes a model call at best and starts a reply loop at worst.
 */
export function automatedMailReason(rawHeaders: string | null | undefined, sender: string | null | undefined): string | null {
	const autoSubmitted = headerValue(rawHeaders, "auto-submitted")?.trim().toLowerCase();
	if (autoSubmitted && autoSubmitted !== "no") return `Auto-Submitted: ${autoSubmitted}`;
	const precedence = headerValue(rawHeaders, "precedence")?.trim().toLowerCase();
	if (precedence && ["bulk", "list", "junk", "auto_reply"].includes(precedence)) return `Precedence: ${precedence}`;
	if (headerValue(rawHeaders, "list-id")) return "List-Id";
	if (headerValue(rawHeaders, "list-unsubscribe")) return "List-Unsubscribe";
	for (const key of ["x-autoreply", "x-autorespond", "x-auto-response-suppress"]) {
		if (headerValue(rawHeaders, key)) return key;
	}
	if (sender && NO_REPLY_SENDER.test(sender.trim())) return `sender ${sender.trim().toLowerCase()}`;
	return null;
}
