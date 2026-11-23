// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The text/plain alternative for outgoing HTML mail. HTML-only mail scores
 * worse with spam filters and is unreadable in text-only clients, so a send
 * without text gets one generated from the HTML. Given html and text, the
 * Email Sending binding writes a multipart/alternative message.
 *
 * Unlike htmlToText in message-meta.ts, which flattens a body for the search
 * index, this keeps the reading order: paragraphs, line breaks, list items,
 * quotes and link targets.
 */
import { decodeEntities } from "./message-meta";

const BLOCK = "p|div|h[1-6]|ul|ol|table|tr|blockquote|pre|section|article|header|footer|hr";

/** Plain text for the HTML body of an outgoing message. */
export function htmlToTextAlternative(html: string): string {
	if (!html) return "";
	let s = html
		.replace(/<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\r\n?/g, "\n");
	// Source line breaks are spaces in HTML, except inside <pre>.
	s = s.replace(/(<pre\b[^>]*>)([\s\S]*?)(<\/pre\s*>)/gi, (_, open, body, close) => `${open}${body.replace(/\n/g, "<br>")}${close}`);
	s = s.replace(/[ \t\n]+/g, " ");
	// Links show their target when it differs from the text.
	s = s.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_, d, q, bare, inner) => {
		const href = decodeEntities(d ?? q ?? bare ?? "").trim();
		const text = inner.replace(/<[^>]+>/g, "").trim();
		const label = decodeEntities(text);
		if (!href || /^(javascript|data):/i.test(href)) return text;
		const target = href.replace(/^mailto:/i, "");
		return label && (label === target || label === href) ? text : `${text} (${target})`.trim();
	});
	s = s
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<li\b[^>]*>/gi, "\n- ")
		.replace(/<\/li\s*>/gi, "")
		.replace(/<(td|th)\b[^>]*>/gi, " ")
		.replace(/<blockquote\b[^>]*>/gi, "\n\n\u0001")
		.replace(/<\/blockquote\s*>/gi, "\u0002\n\n")
		.replace(new RegExp(`</?(${BLOCK})\\b[^>]*>`, "gi"), "\n\n")
		.replace(/<[^>]+>/g, "");
	s = decodeEntities(s).replace(/ /g, " ");
	// Quote the lines inside each blockquote, innermost first.
	let depth = 0;
	const lines: string[] = [];
	for (const raw of s.split("\n")) {
		let line = "";
		let deepest = depth;
		for (const ch of raw) {
			if (ch === "\u0001") { depth++; deepest = Math.max(deepest, depth); continue; }
			if (ch === "\u0002") { depth = Math.max(0, depth - 1); continue; }
			line += ch;
		}
		// Text inside a quote on this line is quoted; an empty line takes the depth the line ends at.
		const text = line.replace(/[ \t]+/g, " ").trim();
		lines.push(text ? `${"> ".repeat(deepest)}${text}` : "> ".repeat(depth).trimEnd());
	}
	// One blank line between blocks at most, none at the ends.
	const blank = (line: string) => /^[> ]*$/.test(line);
	const out: string[] = [];
	for (const line of lines) {
		if (blank(line) && out.length === 0) continue;
		if (blank(line) && blank(out[out.length - 1])) {
			// Of a run of blank lines keep the shallowest, so a quote's end is not quoted.
			if (line.length < out[out.length - 1].length) out[out.length - 1] = line;
			continue;
		}
		out.push(line);
	}
	while (out.length && blank(out[out.length - 1])) out.pop();
	return out.join("\n");
}
