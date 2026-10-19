// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Snippets for search results, built in the Worker. FTS5's snippet() can't
 * read a contentless index and re-runs the match (57 to 160 ms on broad
 * words in phase 0), so the Worker takes the message text, finds the words
 * the way the index does (case, diacritics, prefixes) and keeps about 18
 * words around the best cluster.
 *
 * Every piece of mail text is HTML-escaped before `<mark>` is added, so mail
 * text never reaches the page as markup.
 */

import { foldLetters } from "./search-fold";

export const SNIPPET_WORDS = 18;
/** Text past this is not searched for a snippet. */
const MAX_TEXT = 20_000;

const TOKEN = /[\p{L}\p{N}]+/gu;

/** Lower case without diacritics, as the index folds (`remove_diacritics 2` and search-fold.ts). */
export function fold(text: string): string {
	return foldLetters(text.normalize("NFD").replace(/\p{M}/gu, "")).toLowerCase();
}

export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => `&${({ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" } as Record<string, string>)[c]};`);
}

interface Token {
	text: string;
	start: number;
	end: number;
	/** Index of the term it matches, or -1. */
	term: number;
	/** For a substring match, the matched part of `text`; otherwise the whole word is marked. */
	part?: [number, number];
}

/**
 * About `words` words of `text` around the densest cluster of `terms`, as
 * HTML with each matched word in <mark>. Terms match word prefixes; the
 * `substrings` (words the substring search found) also match inside a word,
 * and only that part is marked. With no match it is the opening words,
 * unmarked. Empty text gives "".
 */
export function snippetHtml(text: string, terms: readonly string[], words = SNIPPET_WORDS, substrings: readonly string[] = []): string {
	const source = text.slice(0, MAX_TEXT);
	const folded = [...new Set(terms.map(fold).filter((t) => t.length > 0))];
	const inner = [...new Set(substrings.map(fold).filter((t) => t.length > 0))];
	const tokens: Token[] = [];
	for (const m of source.matchAll(TOKEN)) {
		const word = fold(m[0]);
		const token: Token = { text: m[0], start: m.index!, end: m.index! + m[0].length, term: folded.findIndex((t) => word.startsWith(t)) };
		if (token.term < 0) {
			for (const [i, sub] of inner.entries()) {
				const at = word.indexOf(sub);
				if (at < 0) continue;
				token.term = folded.length + i;
				// Folding can change the length (diacritics); then the whole word is marked.
				if (word.length === m[0].length) token.part = [at, at + sub.length];
				break;
			}
		}
		tokens.push(token);
	}
	if (tokens.length === 0) return "";

	// The window with the most distinct terms, then the most matches, earliest first.
	let best = 0;
	let bestScore = -1;
	if (folded.length + inner.length > 0) {
		for (let s = 0; s < tokens.length; s++) {
			if (tokens[s].term < 0) continue;
			const window = tokens.slice(s, s + words);
			const distinct = new Set(window.filter((t) => t.term >= 0).map((t) => t.term)).size;
			const score = distinct * 1000 + window.filter((t) => t.term >= 0).length;
			if (score > bestScore) {
				bestScore = score;
				best = s;
			}
		}
	}
	// Start a few words before the first match, so it reads in context.
	const lead = bestScore >= 0 ? Math.min(3, best) : 0;
	const from = Math.max(0, Math.min(best - lead, tokens.length - words));
	const to = Math.min(tokens.length, from + words);

	let html = from > 0 ? "… " : "";
	for (let i = from; i < to; i++) {
		const t = tokens[i];
		if (i > from) html += escapeHtml(collapse(source.slice(tokens[i - 1].end, t.start)));
		if (t.term < 0) html += escapeHtml(t.text);
		else if (t.part) {
			const [a, b] = t.part;
			html += `${escapeHtml(t.text.slice(0, a))}<mark>${escapeHtml(t.text.slice(a, b))}</mark>${escapeHtml(t.text.slice(b))}`;
		} else html += `<mark>${escapeHtml(t.text)}</mark>`;
	}
	// Closing punctuation stays with the last word.
	if (to < tokens.length) html += " …";
	else html += escapeHtml(collapse(source.slice(tokens[to - 1].end)).trimEnd());
	return html;
}

/** Punctuation between words stays, up to a few characters; runs of space and line breaks become one space. */
function collapse(between: string): string {
	return between.replace(/\s+/g, " ").slice(0, 12);
}

/** The snippet's text without markup, for the agent's tools. */
export function snippetText(html: string): string {
	return html
		.replace(/<\/?mark>/g, "")
		.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e] ?? "");
}
