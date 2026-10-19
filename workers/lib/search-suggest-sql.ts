// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The search window's server side: suggestions for what is typed, and saved
 * searches. Generators over `messages m`, like mail-index-sql.ts.
 *
 * Every statement holds at most one MATCH (see workers/store/search.ts).
 */
import { completionAt, filterTerms, looksLikeRequest, removeRange } from "../../shared/search-complete";
import { formatSearch, MAX_SEARCH_LENGTH, parseSearch } from "../../shared/search-query";
import { type DidYouMean, didYouMeanQuery, withSubstrings } from "./search-engine-sql";
import { FACET_CAP, filterWhere, InvalidFilterError, type MailFilter, type Query, sqlStep } from "./mail-index-sql";

const DAY_MS = 86_400_000;
const WORD = /[\p{L}\p{N}]/u;
const MAX_COMPLETIONS = 8;
/** Recent messages read for `to:` and `cc:` completion. */
const RECIPIENT_SCAN = 500;

export interface SuggestPerson {
	value: string;
	name?: string;
	count: number;
}

export interface SuggestCount {
	token: string;
	label: string;
	count: number;
}

export interface Suggestions {
	/** Values for the operator at the cursor that need the mail to answer: `from:`, `cc:`, `to:`. */
	completions: SuggestPerson[] | null;
	/** With an empty box: the senders with the most mail in the last 90 days. */
	people: SuggestPerson[];
	/** Conversations the search matches, or null when it can't run. */
	count: number | null;
	/** Filters that narrow the search, with counts. */
	narrow: SuggestCount[];
	/** When nothing matched: what searching everywhere or dropping each filter would find. */
	nothing: { everywhere: number | null; removals: { text: string; start: number; end: number; count: number }[] } | null;
	/** On D1, when nothing matched: the search with unknown words respelled. */
	didYouMean: DidYouMean | null;
	interpretable: boolean;
	errors: string[];
}

/** A prefix match over FTS columns, or null when the text has nothing to match. */
function prefixMatch(columns: string, partial: string): string | null {
	const text = partial.replace(/^@/, "").trim();
	if (!WORD.test(text)) return null;
	return `${columns} : "${text.replace(/"/g, '""')}"*`;
}

const people = (rows: Record<string, unknown>[]): SuggestPerson[] =>
	rows.map((r) => ({ value: String(r.value), ...(r.name ? { name: String(r.name) } : {}), count: Number(r.count) }));

/** The senders with the most conversations in the last 90 days. */
function* topSenders(now: number, limit: number): Query<SuggestPerson[]> {
	return people(yield sqlStep(
		`SELECT m.sender_addr AS value, MAX(m.sender_name) AS name, COUNT(DISTINCT m.thread_key) AS count FROM messages m
		WHERE m.deleted = 0 AND m.sender_addr != '' AND m.state NOT IN ('sent', 'draft', 'trash', 'spam') AND m.date >= ?
		GROUP BY m.sender_addr ORDER BY count DESC, value ASC LIMIT ?`,
		new Date(now - 90 * DAY_MS).toISOString(), limit,
	));
}

/** Senders and sender domains by prefix of name or address, most conversations first. */
function* senderCompletions(partial: string, now: number): Query<SuggestPerson[]> {
	const match = prefixMatch("{sender_name sender_addr}", partial);
	if (!match) return yield* topSenders(now, MAX_COMPLETIONS);
	const addresses = people(yield sqlStep(
		`SELECT m.sender_addr AS value, MAX(m.sender_name) AS name, COUNT(DISTINCT m.thread_key) AS count FROM messages m
		WHERE m.deleted = 0 AND m.sender_addr != '' AND m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
		GROUP BY m.sender_addr ORDER BY count DESC, value ASC LIMIT ?`,
		match, MAX_COMPLETIONS,
	));
	// Domains by prefix, as a range over the sender_domain index.
	const p = partial.toLowerCase().replace(/^@/, "");
	const domains = people(yield sqlStep(
		`SELECT m.sender_domain AS value, COUNT(DISTINCT m.thread_key) AS count FROM messages m
		WHERE m.sender_domain >= ? AND m.sender_domain < ? AND m.deleted = 0
		GROUP BY m.sender_domain ORDER BY count DESC, value ASC LIMIT 3`,
		p, `${p}\uffff`,
	));
	return [...domains, ...addresses]
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
		.slice(0, MAX_COMPLETIONS);
}

/** Recipient addresses by prefix, from the newest matching messages. */
function* recipientCompletions(partial: string): Query<SuggestPerson[]> {
	const match = prefixMatch("recipients", partial);
	const rows = match
		? yield sqlStep(
			`SELECT m.recipients AS r FROM messages m
			WHERE m.deleted = 0 AND m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?) ORDER BY m.date DESC LIMIT ?`,
			match, RECIPIENT_SCAN,
		)
		: yield sqlStep(`SELECT m.recipients AS r FROM messages m WHERE m.deleted = 0 AND m.state = 'sent' ORDER BY m.date DESC LIMIT ?`, RECIPIENT_SCAN);
	const p = partial.toLowerCase().replace(/^@/, "");
	const counts = new Map<string, number>();
	for (const row of rows) {
		for (const address of String(row.r ?? "").split(/[\s,;<>]+/)) {
			if (!address.includes("@")) continue;
			if (p && !new RegExp(`(?:^|[@.])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(address)) continue;
			counts.set(address, (counts.get(address) ?? 0) + 1);
		}
	}
	return [...counts]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
		.slice(0, MAX_COMPLETIONS);
}

/**
 * Compose suggestions (WON-216): people you wrote to and people who wrote to
 * you, by prefix of name or address. A sent message counts twice a received
 * conversation, so the people you write to come first. Spam and Trash are left
 * out, and so are `exclude` (your own addresses).
 */
export function* contactsQuery(partial: string, exclude: string[] = []): Query<SuggestPerson[]> {
	const p = partial.trim().toLowerCase();
	if (!WORD.test(p)) return [];
	const skip = new Set(exclude.map((a) => a.toLowerCase()));
	const people = new Map<string, SuggestPerson>();
	const add = (value: string, count: number, name?: string) => {
		const addr = value.toLowerCase();
		if (!addr.includes("@") || skip.has(addr)) return;
		const had = people.get(addr);
		people.set(addr, { value: addr, ...((name || had?.name) ? { name: name || had?.name } : {}), count: (had?.count ?? 0) + count });
	};
	const senders = prefixMatch("{sender_name sender_addr}", p);
	if (senders) {
		const rows = yield sqlStep(
			`SELECT m.sender_addr AS value, MAX(m.sender_name) AS name, COUNT(DISTINCT m.thread_key) AS count FROM messages m
			WHERE m.deleted = 0 AND m.sender_addr != '' AND m.state NOT IN ('sent', 'draft', 'trash', 'spam')
			AND m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
			GROUP BY m.sender_addr ORDER BY count DESC, value ASC LIMIT ?`,
			senders, MAX_COMPLETIONS * 2,
		);
		for (const r of rows) add(String(r.value), Number(r.count), r.name ? String(r.name) : undefined);
	}
	const recipients = prefixMatch("recipients", p);
	if (recipients) {
		const rows = yield sqlStep(
			`SELECT m.recipients AS r FROM messages m
			WHERE m.deleted = 0 AND m.state = 'sent' AND m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?) ORDER BY m.date DESC LIMIT ?`,
			recipients, RECIPIENT_SCAN,
		);
		const starts = new RegExp(`(?:^|[@.])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
		for (const row of rows) {
			for (const address of String(row.r ?? "").split(/[\s,;<>]+/)) if (address.includes("@") && starts.test(address.toLowerCase())) add(address, 2);
		}
	}
	return [...people.values()]
		.filter((c) => c.value.startsWith(p) || c.value.includes(`@${p}`) || c.value.includes(`.${p}`) || (c.name ?? "").toLowerCase().split(/\s+/).some((w) => w.startsWith(p)))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
		.slice(0, MAX_COMPLETIONS);
}

/** Conversations a filter matches, or null when its search doesn't compile. */
function* countOf(filter: MailFilter, now: number): Query<number | null> {
	let w: { sql: string; params: unknown[] };
	try {
		w = filterWhere(filter, now);
	} catch (e) {
		if (e instanceof InvalidFilterError) return null;
		throw e;
	}
	const [row] = yield sqlStep(`SELECT COUNT(DISTINCT m.thread_key) AS n FROM messages m WHERE ${w.sql}`, ...w.params);
	return Number(row?.n ?? 0);
}

function* narrowOf(filter: MailFilter, text: string, now: number): Query<SuggestCount[]> {
	// Counted over the newest matches, as the list's facets are.
	const w = filterWhere(filter, now, FACET_CAP);
	const typed = text.toLowerCase();
	const out: SuggestCount[] = [];
	const domains = yield sqlStep(
		`SELECT m.sender_domain AS value, COUNT(DISTINCT m.thread_key) AS count FROM messages m
		WHERE ${w.sql} AND m.sender_domain != '' GROUP BY m.sender_domain ORDER BY count DESC, value ASC LIMIT 3`,
		...w.params,
	);
	for (const r of domains) out.push({ token: `from:${r.value}`, label: `From ${r.value}`, count: Number(r.count) });
	const labels = yield sqlStep(
		`SELECT l.name AS name, COUNT(DISTINCT m.thread_key) AS count FROM messages m
		JOIN message_labels ml ON ml.message = m.id JOIN labels l ON l.id = ml.label_id
		WHERE ${w.sql} GROUP BY l.id ORDER BY count DESC, l.name ASC LIMIT 3`,
		...w.params,
	);
	for (const r of labels) {
		const name = String(r.name);
		out.push({ token: `label:${/[\s"]/.test(name) ? `"${name.replace(/"/g, "")}"` : name.toLowerCase()}`, label: name, count: Number(r.count) });
	}
	const [status] = yield sqlStep(
		`SELECT COUNT(DISTINCT CASE WHEN m.unread = 1 THEN m.thread_key END) AS unread,
			COUNT(DISTINCT CASE WHEN m.has_attachment = 1 THEN m.thread_key END) AS attachment
		FROM messages m WHERE ${w.sql}`,
		...w.params,
	);
	if (Number(status?.unread)) out.push({ token: "is:unread", label: "Unread", count: Number(status.unread) });
	if (Number(status?.attachment)) out.push({ token: "has:attachment", label: "Has attachment", count: Number(status.attachment) });
	// What is typed already narrows the search.
	return out.filter((s) => !typed.includes(s.token.toLowerCase()));
}

/**
 * Suggestions for the search window. `base` is the view and chips; `text`
 * is the search box and `at` the cursor in it. A value that doesn't parse is
 * reported and left out of the counts, as in the list.
 */
export function* suggestQuery(base: MailFilter, text: string, at: number, now = Date.now()): Query<Suggestions> {
	const parsed = parseSearch(text.slice(0, MAX_SEARCH_LENGTH));
	const out: Suggestions = {
		completions: null, people: [], count: null, narrow: [], nothing: null, didYouMean: null,
		interpretable: looksLikeRequest(text), errors: parsed.errors.map((e) => e.message),
	};

	const ctx = at >= 0 ? completionAt(text, at) : null;
	if (ctx?.kind === "value") {
		if (ctx.op === "from") out.completions = yield* senderCompletions(ctx.partial, now);
		else if (ctx.op === "to" || ctx.op === "cc") out.completions = yield* recipientCompletions(ctx.partial);
	}

	if (parsed.terms.length === 0) {
		out.people = yield* topSenders(now, 6);
		return out;
	}

	const valid = formatSearch(parsed);
	const filter: MailFilter = yield* withSubstrings({ ...base, q: valid });
	out.count = yield* countOf(filter, now);
	if (out.count === null) {
		try {
			filterWhere(filter, now);
		} catch (e) {
			if (e instanceof InvalidFilterError && !out.errors.includes(e.message)) out.errors.push(e.message);
		}
		return out;
	}
	if (out.count > 0) {
		out.narrow = yield* narrowOf(filter, text, now);
		return out;
	}

	// Nothing matched: what would.
	// Searching everywhere drops the view and any `in:` term.
	const scoped = (t: (typeof parsed.terms)[number]) => t.any.every((l) => l.type === "op" && l.op === "in");
	const hasScope = parsed.terms.some(scoped);
	const everywhere = !hasScope && base.view === "anywhere"
		? null
		: yield* countOf({ ...filter, view: "anywhere", q: formatSearch({ terms: parsed.terms.filter((t) => !scoped(t)), sort: parsed.sort }) }, now);
	const removals: NonNullable<Suggestions["nothing"]>["removals"] = [];
	for (const term of filterTerms(text).slice(0, 3)) {
		const count = yield* countOf({ ...base, q: formatSearch(parseSearch(removeRange(text, term.start, term.end))) }, now);
		if (count) removals.push({ ...term, count });
	}
	out.nothing = { everywhere: everywhere || null, removals };
	out.didYouMean = yield* didYouMeanQuery(text);
	return out;
}

// ── Saved searches ─────────────────────────────────────────────────
//
// `saved_searches.filter` holds the search text.

export interface SavedSearch {
	id: string;
	name: string;
	query: string;
	position: number;
	/** Conversations it matches across every folder but Spam and Trash, when asked for. */
	count?: number | null;
}

export class SavedSearchError extends Error {
	override name = "SavedSearchError";
}

/** A create or update as `{ saved }`, or `{ error }` for input the user can fix. Errors don't cross RPC as classes. */
export async function savedResult(run: () => SavedSearch | null | Promise<SavedSearch | null>): Promise<{ saved: SavedSearch | null; error?: undefined } | { saved?: undefined; error: string }> {
	try {
		return { saved: await run() };
	} catch (e) {
		if (e instanceof SavedSearchError) return { error: e.message };
		throw e;
	}
}

const MAX_SAVED = 50;
const MAX_NAME = 80;

const toSaved = (r: Record<string, unknown>): SavedSearch => ({ id: String(r.id), name: String(r.name), query: String(r.filter), position: Number(r.position) });

function cleanQuery(value: unknown): string {
	const q = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
	if (!q) throw new SavedSearchError("A saved search needs search text");
	if (q.length > MAX_SEARCH_LENGTH) throw new SavedSearchError(`Search text is limited to ${MAX_SEARCH_LENGTH} characters`);
	return q;
}

function cleanName(value: unknown, fallback: string): string {
	const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
	return (name || fallback).slice(0, MAX_NAME);
}

function* allSaved(): Query<SavedSearch[]> {
	return (yield sqlStep(`SELECT id, name, filter, position FROM saved_searches ORDER BY position, name`)).map(toSaved);
}

/** Saved searches in order. With `counts`, each is counted over All mail. */
export function* listSavedSearchesQuery(counts?: { tzOffset: number }, now = Date.now()): Query<SavedSearch[]> {
	const list = yield* allSaved();
	if (!counts) return list;
	for (const saved of list) {
		const filter: MailFilter = {
			view: "all", address: [], from: [], label: [], is: [], has: [], subject: [], q: saved.query,
			sort: "date", dir: "desc", tzOffset: counts.tzOffset,
		};
		saved.count = yield* countOf(filter, now);
	}
	return list;
}

export function* createSavedSearchQuery(input: { name?: unknown; query: unknown }, id = crypto.randomUUID()): Query<SavedSearch> {
	const query = cleanQuery(input.query);
	const name = cleanName(input.name, query);
	const list = yield* allSaved();
	if (list.some((s) => s.query === query)) throw new SavedSearchError("This search is already saved");
	if (list.length >= MAX_SAVED) throw new SavedSearchError(`Up to ${MAX_SAVED} saved searches`);
	const position = list.reduce((max, s) => Math.max(max, s.position + 1), 0);
	yield sqlStep(`INSERT INTO saved_searches (id, name, filter, position) VALUES (?, ?, ?, ?)`, id, name, query, position);
	return { id, name, query, position };
}

export function* updateSavedSearchQuery(id: string, input: { name?: unknown; query?: unknown; position?: unknown }): Query<SavedSearch | null> {
	const list = yield* allSaved();
	const current = list.find((s) => s.id === id);
	if (!current) return null;
	const query = input.query === undefined ? current.query : cleanQuery(input.query);
	if (list.some((s) => s.id !== id && s.query === query)) throw new SavedSearchError("This search is already saved");
	const name = input.name === undefined ? current.name : cleanName(input.name, query);
	const position = typeof input.position === "number" && Number.isInteger(input.position) ? input.position : current.position;
	yield sqlStep(`UPDATE saved_searches SET name = ?, filter = ?, position = ? WHERE id = ?`, name, query, position, id);
	return { id, name, query, position };
}

export function* deleteSavedSearchQuery(id: string): Query<boolean> {
	return (yield sqlStep(`DELETE FROM saved_searches WHERE id = ? RETURNING id`, id)).length > 0;
}
