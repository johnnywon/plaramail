// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The search language. One
 * parser for the search bar, the API, the agent's tools and MCP. It turns
 * text into a typed SearchQuery; workers/store/search.ts compiles that to SQL.
 *
 * A query is a list of terms, all of which must match. A term is one item,
 * an item with a leading `-` (excluded), or items joined by `OR`. Unknown
 * operators stay plain words, so `ratio:4:3` still searches. Operators with
 * values that don't parse are left out of the query and reported in `errors`.
 */

export const OPERATORS = [
	"from", "to", "cc", "subject", "label", "in", "is", "has", "filename",
	"before", "after", "newer", "older", "larger", "smaller", "list", "sort",
] as const;
export type Operator = (typeof OPERATORS)[number];

export const IN_VALUES = ["inbox", "unread", "starred", "drafts", "sent", "archive", "spam", "trash", "all", "anywhere"] as const;
export const IS_SEARCH_VALUES = ["unread", "read", "starred", "scheduled", "replied"] as const;
export const HAS_SEARCH_VALUES = ["attachment", "unsubscribe", "pdf", "image", "link", "draft"] as const;
export const SORT_VALUES = ["relevance", "date"] as const;

/** One-line descriptions, for completion and the cheat sheet. */
export const OPERATOR_HELP: Record<Operator, string> = {
	from: "Sender name, address or domain",
	to: "Recipient, or one of your addresses",
	cc: "Copied recipient",
	subject: "Words in the subject",
	label: "Label by name",
	in: "View or folder: inbox, sent, trash, anywhere…",
	is: "unread, read, starred, scheduled, replied",
	has: "attachment, pdf, image, link, draft, unsubscribe",
	filename: "Attachment name or type",
	before: "Before a date (2026-01-31) or an age (30d)",
	after: "On or after a date (2026-01-31) or an age (30d)",
	newer: "Newer than an age: 7d, 3w, 2m, 1y",
	older: "Older than an age: 7d, 3w, 2m, 1y",
	larger: "Bigger than a size: 500k, 5mb",
	smaller: "Smaller than a size: 500k, 5mb",
	list: "Mailing list id",
	sort: "relevance or date",
};

/** A date bound: a calendar day (local to the reader) or an age back from now. */
export type DateValue =
	| { kind: "day"; year: number; month: number; day: number }
	| { kind: "instant"; iso: string }
	| { kind: "ago"; amount: number; unit: "d" | "w" | "m" | "y" };

export type Leaf =
	| { type: "word"; text: string }
	| { type: "phrase"; text: string }
	| { type: "op"; op: Exclude<Operator, "sort" | "before" | "after" | "newer" | "older" | "larger" | "smaller">; value: string; phrase: boolean }
	| { type: "date"; op: "before" | "after"; value: DateValue }
	| { type: "size"; op: "larger" | "smaller"; bytes: number };

export interface Term {
	negate: boolean;
	/** Two or more leaves when joined by OR. */
	any: Leaf[];
	/** The term's text in the input, for rewriting the search without it. */
	start: number;
	end: number;
}

export interface QueryError {
	op: string;
	value: string;
	message: string;
	start: number;
	end: number;
}

export interface SearchQuery {
	terms: Term[];
	sort?: (typeof SORT_VALUES)[number];
	errors: QueryError[];
}

export const MAX_SEARCH_LENGTH = 500;
export const MAX_TERMS = 32;

const OP_SET: ReadonlySet<string> = new Set(OPERATORS);
const ISO_DAY = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;
const AGE = /^(\d{1,4})([dwmy])$/i;
const SIZE = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)?$/i;
const SIZE_UNITS: Record<string, number> = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3 };

interface Item {
	negate: boolean;
	/** null for a dropped item (an empty operator, or one with an error). */
	leaf: Leaf | null;
	or: boolean;
	sort?: SearchQuery["sort"];
	start: number;
	end: number;
}

export function parseDate(value: string): DateValue | null {
	const age = AGE.exec(value);
	if (age) return { kind: "ago", amount: Number(age[1]), unit: age[2].toLowerCase() as "d" | "w" | "m" | "y" };
	if (ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))) return { kind: "instant", iso: new Date(value).toISOString() };
	const day = ISO_DAY.exec(value);
	if (!day) return null;
	const [year, month, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
	const check = new Date(Date.UTC(year, month - 1, d));
	if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== d) return null;
	return { kind: "day", year, month, day: d };
}

export function parseSize(value: string): number | null {
	const m = SIZE.exec(value);
	if (!m) return null;
	const bytes = Number(m[1]) * SIZE_UNITS[(m[2] ?? "b").toLowerCase()];
	return Number.isFinite(bytes) ? Math.round(bytes) : null;
}

/** Read a `"…"` run from `at` (the opening quote). An unclosed quote runs to the end. */
function readQuoted(input: string, at: number): { text: string; end: number } {
	const close = input.indexOf('"', at + 1);
	return close < 0 ? { text: input.slice(at + 1), end: input.length } : { text: input.slice(at + 1, close), end: close + 1 };
}

/** One operator's leaf, or an error message. `null` leaf with no error drops it (an empty value while typing). */
function operatorLeaf(op: Operator, raw: string, quoted: boolean): { leaf?: Leaf; sort?: SearchQuery["sort"]; error?: string } {
	const value = raw.trim();
	if (!value) return {};
	const lower = value.toLowerCase();
	const oneOf = (allowed: readonly string[]) => (allowed.includes(lower) ? undefined : `${op}: takes ${allowed.join(", ")}`);
	switch (op) {
		case "sort": {
			const error = oneOf(SORT_VALUES);
			return error ? { error } : { sort: lower as SearchQuery["sort"] };
		}
		case "is": {
			const error = oneOf(IS_SEARCH_VALUES);
			return error ? { error } : { leaf: { type: "op", op, value: lower, phrase: false } };
		}
		case "has": {
			const error = oneOf(HAS_SEARCH_VALUES);
			return error ? { error } : { leaf: { type: "op", op, value: lower, phrase: false } };
		}
		case "before": case "after": case "newer": case "older": {
			const date = parseDate(value);
			const ageOnly = op === "newer" || op === "older";
			if (!date || (ageOnly && date.kind !== "ago")) {
				return { error: ageOnly ? `${op}: needs an age like 7d, 3w, 2m or 1y` : `${op}: needs a date like 2026-01-31 or an age like 30d` };
			}
			return { leaf: { type: "date", op: op === "newer" ? "after" : op === "older" ? "before" : op, value: date } };
		}
		case "larger": case "smaller": {
			const bytes = parseSize(value);
			return bytes === null ? { error: `${op}: needs a size like 500k or 5mb` } : { leaf: { type: "size", op, bytes } };
		}
		case "subject": case "filename": case "label":
			return { leaf: { type: "op", op, value, phrase: quoted } };
		default:
			return { leaf: { type: "op", op, value: lower, phrase: quoted } };
	}
}

function tokenize(input: string, errors: QueryError[]): Item[] {
	const items: Item[] = [];
	let i = 0;
	while (i < input.length) {
		if (/\s/.test(input[i])) {
			i++;
			continue;
		}
		const start = i;
		const negate = input[i] === "-" && i + 1 < input.length && !/\s/.test(input[i + 1]);
		if (negate) i++;
		if (input[i] === '"') {
			const q = readQuoted(input, i);
			i = q.end;
			const text = q.text.trim();
			items.push({ negate, leaf: text ? { type: "phrase", text } : null, or: false, start, end: i });
			continue;
		}
		let end = i;
		while (end < input.length && !/\s/.test(input[end])) end++;
		const token = input.slice(i, end);
		if (!negate && token === "OR") {
			items.push({ negate: false, leaf: null, or: true, start, end });
			i = end;
			continue;
		}
		const colon = token.indexOf(":");
		const name = colon > 0 ? token.slice(0, colon).toLowerCase() : "";
		if (OP_SET.has(name)) {
			const op = name as Operator;
			let value = token.slice(colon + 1);
			let quoted = false;
			if (value.startsWith('"')) {
				const q = readQuoted(input, i + colon + 1);
				value = q.text;
				quoted = true;
				end = q.end;
			}
			const parsed = operatorLeaf(op, value, quoted);
			if (parsed.error) errors.push({ op, value, message: parsed.error, start, end });
			items.push({ negate, leaf: parsed.leaf ?? null, or: false, sort: parsed.sort, start, end });
			i = end;
			continue;
		}
		items.push({ negate, leaf: { type: "word", text: token }, or: false, start, end });
		i = end;
	}
	return items;
}

/**
 * Parse search text. `a OR b` joins neighbours into one term; an `OR` next to
 * an excluded item, at either end, or next to a dropped item is ignored.
 */
export function parseSearch(input: string): SearchQuery {
	const errors: QueryError[] = [];
	const text = input.length > MAX_SEARCH_LENGTH ? input.slice(0, MAX_SEARCH_LENGTH) : input;
	if (input.length > MAX_SEARCH_LENGTH) {
		errors.push({ op: "", value: "", message: `Search text is limited to ${MAX_SEARCH_LENGTH} characters`, start: MAX_SEARCH_LENGTH, end: input.length });
	}
	const items = tokenize(text, errors);
	const terms: Term[] = [];
	let sort: SearchQuery["sort"];
	for (let k = 0; k < items.length; k++) {
		const item = items[k];
		if (item.sort) sort = item.sort;
		if (!item.leaf || item.or) continue;
		const prev = items[k - 1];
		const last = terms[terms.length - 1];
		const joins = prev?.or && last && !last.negate && !item.negate && items[k - 2]?.leaf && items[k - 2].end === last.end;
		if (joins) {
			last.any.push(item.leaf);
			last.end = item.end;
		} else {
			terms.push({ negate: item.negate, any: [item.leaf], start: item.start, end: item.end });
		}
	}
	for (let k = terms.length - 1; k >= 0; k--) {
		const kinds = new Set(terms[k].any.map(isTextLeaf));
		if (kinds.size > 1) {
			const [term] = terms.splice(k, 1);
			errors.push({ op: "OR", value: "", message: "OR can't join words with filters like is:, label: or dates", start: term.start, end: term.end });
		}
	}
	if (terms.length > MAX_TERMS) {
		const extra = terms.splice(MAX_TERMS);
		errors.push({ op: "", value: "", message: `A search can have up to ${MAX_TERMS} terms`, start: extra[0].start, end: extra[extra.length - 1].end });
	}
	return { terms, sort, errors };
}

const TEXT_OPS: ReadonlySet<string> = new Set(["subject", "from", "to", "filename"]);

/** Whether a leaf matches words in the word index, as against a filter on a column. */
export function isTextLeaf(leaf: Leaf): boolean {
	return leaf.type === "word" || leaf.type === "phrase" || (leaf.type === "op" && TEXT_OPS.has(leaf.op));
}

const quote = (value: string) => (/[\s"]/.test(value) || value === "" ? `"${value.replace(/"/g, "")}"` : value);

function formatDate(value: DateValue): string {
	if (value.kind === "ago") return `${value.amount}${value.unit}`;
	if (value.kind === "instant") return value.iso;
	return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
	for (const [unit, size] of [["gb", 1024 ** 3], ["mb", 1024 ** 2], ["kb", 1024]] as const) {
		if (bytes >= size && bytes % size === 0) return `${bytes / size}${unit}`;
	}
	return String(bytes);
}

export function formatLeaf(leaf: Leaf): string {
	switch (leaf.type) {
		case "word": return leaf.text;
		case "phrase": return `"${leaf.text.replace(/"/g, "")}"`;
		case "date": return `${leaf.op}:${formatDate(leaf.value)}`;
		case "size": return `${leaf.op}:${formatSize(leaf.bytes)}`;
		case "op": return `${leaf.op}:${leaf.phrase ? `"${leaf.value.replace(/"/g, "")}"` : quote(leaf.value)}`;
	}
}

export function formatTerm(term: Term): string {
	return `${term.negate ? "-" : ""}${term.any.map(formatLeaf).join(" OR ")}`;
}

/** Canonical text for a query: what the agent and the Ask row show. */
export function formatSearch(query: Pick<SearchQuery, "terms" | "sort">): string {
	return [...query.terms.map(formatTerm), ...(query.sort ? [`sort:${query.sort}`] : [])].join(" ");
}

/** Words and phrases the results should highlight: everything not excluded that isn't an operator. */
export function highlightTerms(query: SearchQuery): string[] {
	const out: string[] = [];
	for (const term of query.terms) {
		if (term.negate) continue;
		for (const leaf of term.any) {
			if (leaf.type === "word" || leaf.type === "phrase") out.push(...leaf.text.toLowerCase().split(/\s+/).filter(Boolean));
			else if (leaf.type === "op" && leaf.op === "subject") out.push(...leaf.value.toLowerCase().split(/\s+/).filter(Boolean));
		}
	}
	return [...new Set(out)];
}
