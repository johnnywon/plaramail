// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The parts of search only D1's tables support: substring matches through
 * messages_trigram and attachment_trigram, "Did you mean" through messages_vocab, and snippets for
 * the rows on a page. Generators, like mail-index-sql.ts; each statement
 * holds at most one MATCH.
 */
import { highlightTerms, type Leaf, parseSearch } from "../../shared/search-query";
import { htmlToText } from "./message-meta";
import { type Conversation, facetsQuery, type MailFilter, type MailPage, mailQuery, type Query, sqlStep } from "./mail-index-sql";
import { escapeHtml, fold, snippetHtml } from "./snippets";
import { foldLetters } from "./search-fold";

/** Shorter words are left to the word index: the trigram index needs three characters. */
const MIN_SUBSTRING = 3;
/** Messages a substring may match. A code or order number matches few. */
const MAX_SUBSTRING_MATCHES = 1_000;
/** Words checked per search. */
const MAX_WORDS = 4;
/** Bodies are read this far for snippets. */
const SNIPPET_BODY = 65_536;

const quoted = (word: string) => `"${foldLetters(word).replace(/"/g, '""')}"`;

/** The search's positive single words, the ones a fallback or a spelling fix can stand in for. */
function loneWords(q: string): { text: string; start: number; end: number }[] {
	return parseSearch(q)
		.terms.filter((t) => !t.negate && t.any.length === 1 && t.any[0].type === "word")
		.map((t) => ({ text: (t.any[0] as Extract<Leaf, { type: "word" }>).text.toLowerCase(), start: t.start, end: t.end }))
		.slice(0, MAX_WORDS);
}

function* hasWord(word: string): Query<boolean> {
	const rows = yield sqlStep(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ? LIMIT 1`, `${quoted(word)}*`);
	return rows.length > 0;
}

/**
 * Words of three or more characters that match nothing in the word index,
 * with the messages whose subject, addresses, attachment names or attachment
 * text contain them. Finds codes, order numbers and partial addresses.
 */
export function* substringsQuery(filter: MailFilter): Query<Record<string, number[]> | undefined> {
	const out: Record<string, number[]> = {};
	for (const { text } of loneWords(filter.q)) {
		if ([...text].length < MIN_SUBSTRING || out[text]) continue;
		if (yield* hasWord(text)) continue;
		const ids = new Set<number>();
		// One statement per table: a statement with two MATCHes is what D1 can't run.
		for (const table of ["messages_trigram", "attachment_trigram"]) {
			if (ids.size >= MAX_SUBSTRING_MATCHES) break;
			const rows = yield sqlStep(`SELECT rowid FROM ${table} WHERE ${table} MATCH ? LIMIT ?`, quoted(text), MAX_SUBSTRING_MATCHES - ids.size);
			for (const r of rows) ids.add(Number(r.rowid));
		}
		if (ids.size > 0) out[text] = [...ids];
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

export interface DidYouMean {
	/** The search with each unknown word replaced. */
	text: string;
	words: { from: string; to: string }[];
}

/**
 * For a search that found nothing: each word the index doesn't know, replaced
 * by the indexed word that shares its first two letters, is closest by edit
 * distance, and is in the most messages. Null when nothing is close.
 */
export function* didYouMeanQuery(text: string): Query<DidYouMean | null> {
	const words: DidYouMean["words"] = [];
	let fixed = text;
	for (const w of [...loneWords(text)].reverse()) {
		if ([...w.text].length < MIN_SUBSTRING || (yield* hasWord(w.text))) continue;
		const prefix = fold(w.text).slice(0, 2);
		const candidates = yield sqlStep(
			`SELECT term, doc FROM messages_vocab WHERE term >= ? AND term < ? LIMIT 5000`,
			prefix, `${prefix}￿`,
		);
		const target = fold(w.text);
		const limit = target.length <= 4 ? 1 : 2;
		let best: { term: string; distance: number; doc: number } | null = null;
		for (const row of candidates) {
			const term = String(row.term);
			if (Math.abs(term.length - target.length) > limit) continue;
			const distance = editDistance(target, term, limit);
			if (distance > limit || distance === 0) continue;
			const doc = Number(row.doc);
			if (!best || distance < best.distance || (distance === best.distance && doc > best.doc)) best = { term, distance, doc };
		}
		if (!best) continue;
		words.unshift({ from: w.text, to: best.term });
		fixed = fixed.slice(0, w.start) + best.term + fixed.slice(w.end);
	}
	return words.length > 0 ? { text: fixed, words } : null;
}

/** Levenshtein distance, stopping early once every path is over `limit`. */
export function editDistance(a: string, b: string, limit = Infinity): number {
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		let low = i;
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			low = Math.min(low, row[j]);
		}
		if (low > limit) return limit + 1;
		prev = row;
	}
	return prev[b.length];
}

/** The words a snippet marks: the search's words and phrases, and subject chips. */
export function snippetTerms(filter: MailFilter): string[] {
	const terms = highlightTerms(parseSearch(filter.q));
	for (const s of filter.subject) terms.push(...s.toLowerCase().split(/\s+/).filter(Boolean));
	return terms;
}

/**
 * Snippets for a page of conversations: the start of each body, as text, around
 * the search's words. A body kept in R2 uses the stored opening lines instead.
 */
export function* snippetsQuery(conversations: Conversation[], filter: MailFilter): Query<Map<string, string>> {
	const terms = snippetTerms(filter);
	// Words found only inside longer words are marked there too.
	const inner = Object.keys(filter.substrings ?? {});
	const out = new Map<string, string>();
	if (conversations.length === 0 || terms.length === 0) return out;
	const rows = yield sqlStep(
		`SELECT email_id, substr(body, 1, ?) AS body, snippet FROM messages WHERE email_id IN (SELECT value FROM json_each(?))`,
		SNIPPET_BODY, JSON.stringify(conversations.map((c) => c.email_id)),
	);
	const unmarked: string[] = [];
	for (const row of rows) {
		const text = row.body == null ? String(row.snippet ?? "") : htmlToText(String(row.body));
		const html = snippetHtml(text, terms, undefined, inner);
		out.set(String(row.email_id), html);
		if (!html.includes("<mark>")) unmarked.push(String(row.email_id));
	}
	// A match in an attachment's text shows that text, after the file name.
	if (unmarked.length === 0) return out;
	const files = yield sqlStep(
		`SELECT a.email_id, a.filename, substr(t.text, 1, ?) AS text FROM attachments a JOIN attachment_text t ON t.attachment_id = a.id
		WHERE t.state = 'done' AND a.email_id IN (SELECT value FROM json_each(?)) ORDER BY a.rowid`,
		SNIPPET_BODY, JSON.stringify(unmarked),
	);
	for (const file of files) {
		const id = String(file.email_id);
		if (out.get(id)?.includes("<mark>")) continue;
		const html = snippetHtml(String(file.text ?? ""), terms, undefined, inner);
		if (html.includes("<mark>")) out.set(id, `${escapeHtml(String(file.filename))}: ${html}`);
	}
	return out;
}

/** The filter with its substring matches. */
export function* withSubstrings(filter: MailFilter): Query<MailFilter> {
	if (!filter.q.trim()) return filter;
	const substrings = yield* substringsQuery(filter);
	return substrings ? { ...filter, substrings } : filter;
}

/** The list on D1: substring fallback, the page, then snippets for its rows. */
export function* d1MailQuery(filter: MailFilter, options: { cursor?: string | null; limit?: number; now?: number } = {}): Query<MailPage> {
	const full = yield* withSubstrings(filter);
	const page = yield* mailQuery(full, options);
	const snippets = yield* snippetsQuery(page.conversations, full);
	if (snippets.size === 0) return page;
	return { ...page, conversations: page.conversations.map((c) => (snippets.has(c.email_id) ? { ...c, snippet_html: snippets.get(c.email_id) } : c)) };
}

export function* d1FacetsQuery(filter: MailFilter, now = Date.now()) {
	return yield* facetsQuery(yield* withSubstrings(filter), now);
}
