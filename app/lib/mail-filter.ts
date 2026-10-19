// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { formatLeaf, type Leaf, parseSearch, type QueryError } from "../../shared/search-query";

/**
 * URL state for the unified mail view. The URL is the single source of
 * truth: a view, an ordered list of filter chips (the drill path), a sort,
 * and the open conversation. Chips keep the order they were added in.
 */

export const VIEWS = ["inbox", "unread", "starred", "drafts", "sent", "archive", "spam", "trash", "all"] as const;
export const IS_VALUES = ["unread", "read", "starred"] as const;
export const HAS_VALUES = ["attachment", "unsubscribe"] as const;
export const DATE_TOKENS = ["today", "yesterday", "7d", "30d", "older"] as const;
export const SORTS = ["date", "from", "subject"] as const;

export type ChipKind = "address" | "from" | "label" | "is" | "has" | "subject" | "date" | "before" | "after" | "q";
export interface Chip {
	kind: ChipKind;
	value: string;
}

export interface MailFilter {
	view: string;
	chips: Chip[];
	sort: (typeof SORTS)[number];
	dir: "asc" | "desc";
}

export interface OpenRef {
	mailboxId: string;
	emailId: string;
}

export const VIEW_LABELS: Record<string, string> = {
	inbox: "Inbox", unread: "Unread", starred: "Starred", drafts: "Drafts", sent: "Sent",
	archive: "Archive", spam: "Spam", trash: "Trash", all: "All mail",
};

const CHIP_KINDS: readonly ChipKind[] = ["address", "from", "label", "is", "has", "subject", "date", "before", "after", "q"];
/** Kinds that hold one value; a later chip of the same kind replaces the earlier one. */
const SINGLE: ReadonlySet<ChipKind> = new Set(["date", "before", "after", "q"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Keys that make a URL an explicit filter. Without any, `/` lands on unread Inbox. */
const FILTER_KEYS = new Set<string>(["view", "sort", "dir", ...CHIP_KINDS]);

export const DEFAULT_FILTER: MailFilter = { view: "inbox", chips: [{ kind: "is", value: "unread" }], sort: "date", dir: "desc" };

export function isView(value: string): boolean {
	return (VIEWS as readonly string[]).includes(value) || /^folder:[\w-]+$/.test(value);
}

function validChip(chip: Chip): Chip | null {
	const value = chip.value.trim();
	if (!value || value.length > 200) return null;
	switch (chip.kind) {
		case "is": return (IS_VALUES as readonly string[]).includes(value) ? { kind: "is", value } : null;
		case "has": return (HAS_VALUES as readonly string[]).includes(value) ? { kind: "has", value } : null;
		case "date": return (DATE_TOKENS as readonly string[]).includes(value) ? { kind: "date", value } : null;
		case "before": case "after": return ISO_DATE.test(value) ? { kind: chip.kind, value } : null;
		case "address": case "from": return { kind: chip.kind, value: value.toLowerCase() };
		default: return { kind: chip.kind, value };
	}
}

const READ_PAIR = new Set(["read", "unread"]);

/**
 * Add a chip. An equal chip, a chip of a single-value kind, or the other half
 * of read/unread is replaced in place, so the drill path keeps its order.
 */
export function addChip(chips: Chip[], raw: Chip): Chip[] {
	const chip = validChip(raw);
	if (!chip) return chips;
	const replaces = (c: Chip) =>
		c.kind === chip.kind &&
		(c.value === chip.value || SINGLE.has(chip.kind) || (chip.kind === "is" && READ_PAIR.has(c.value) && READ_PAIR.has(chip.value)));
	const out: Chip[] = [];
	let placed = false;
	for (const c of chips) {
		if (!replaces(c)) out.push(c);
		else if (!placed) {
			out.push(chip);
			placed = true;
		}
	}
	if (!placed) out.push(chip);
	return out;
}

export function removeChip(chips: Chip[], chip: Chip): Chip[] {
	return chips.filter((c) => !(c.kind === chip.kind && c.value === chip.value));
}

export function parseFilter(params: URLSearchParams): MailFilter {
	if (![...params.keys()].some((key) => FILTER_KEYS.has(key))) {
		return { ...DEFAULT_FILTER, chips: [...DEFAULT_FILTER.chips] };
	}
	const view = params.get("view") ?? "inbox";
	let chips: Chip[] = [];
	for (const [key, value] of params) {
		if ((CHIP_KINDS as readonly string[]).includes(key)) chips = addChip(chips, { kind: key as ChipKind, value });
	}
	const sort = params.get("sort") ?? "date";
	return {
		view: isView(view) ? view : "inbox",
		chips,
		sort: (SORTS as readonly string[]).includes(sort) ? (sort as MailFilter["sort"]) : "date",
		dir: params.get("dir") === "asc" ? "asc" : "desc",
	};
}

/** URL params for the filter, chips in path order. The default sort is omitted. */
export function filterToParams(filter: MailFilter): URLSearchParams {
	const params = new URLSearchParams();
	params.set("view", filter.view);
	for (const chip of filter.chips) params.append(chip.kind, chip.value);
	if (filter.sort !== "date") params.set("sort", filter.sort);
	if (filter.dir !== "desc") params.set("dir", filter.dir);
	return params;
}

export function parseOpen(params: URLSearchParams): OpenRef | null {
	const raw = params.get("open");
	if (!raw) return null;
	const at = raw.lastIndexOf(":");
	if (at <= 0 || at === raw.length - 1) return null;
	return { mailboxId: raw.slice(0, at).toLowerCase(), emailId: raw.slice(at + 1) };
}

export function openParam(ref: OpenRef): string {
	return `${ref.mailboxId}:${ref.emailId}`;
}

/** Full URL search for a filter plus the open conversation and the search text. */
export function toSearch(filter: MailFilter, open?: OpenRef | null, search = ""): string {
	const params = filterToParams(filter);
	if (open) params.set("open", openParam(open));
	if (search.trim()) params.set("search", search);
	return `?${params}`;
}

/** Query for /api/v1/mail and /mail/facets. */
export function apiParams(filter: MailFilter, tzOffset = new Date().getTimezoneOffset()): URLSearchParams {
	const params = new URLSearchParams();
	params.set("view", filter.view);
	for (const kind of CHIP_KINDS) {
		for (const chip of filter.chips) if (chip.kind === kind) params.append(kind, chip.value);
	}
	if (filter.sort !== "date") params.set("sort", filter.sort);
	if (filter.dir !== "desc") params.set("dir", filter.dir);
	params.set("tz", String(tzOffset));
	return params;
}

export interface LabelRef {
	id: string;
	name: string;
}

const IN_VIEWS: Record<string, string> = { draft: "drafts", drafts: "drafts", inbox: "inbox", sent: "sent", archive: "archive", spam: "spam", trash: "trash", all: "all", starred: "starred", unread: "unread" };

function resolveLabel(value: string, labels: readonly LabelRef[]): string | null {
	// The current name, spaces optionally written as hyphens. Not the id: it keeps the label's first name.
	const v = value.trim().toLowerCase();
	return labels.find((l) => l.name.toLowerCase() === v || l.name.toLowerCase().replace(/\s+/g, "-") === v)?.id ?? null;
}

/** The chip a lone, not excluded item becomes, or the view `in:` picks. Null leaves it in the search text. */
function chipOf(leaf: Leaf, labels: readonly LabelRef[]): Chip | { view: string } | null {
	if (leaf.type === "date") return leaf.value.kind === "day" ? { kind: leaf.op, value: formatLeaf(leaf).slice(leaf.op.length + 1) } : null;
	if (leaf.type !== "op") return null;
	const { op, value } = leaf;
	switch (op) {
		case "from": return !leaf.phrase && (value.includes("@") || value.includes(".")) ? { kind: "from", value } : null;
		case "to": return leaf.phrase ? null : { kind: "address", value };
		case "subject": return leaf.phrase ? null : { kind: "subject", value };
		case "label": {
			const id = resolveLabel(value, labels);
			return id ? { kind: "label", value: id } : null;
		}
		case "in": return IN_VIEWS[value] ? { view: IN_VIEWS[value] } : null;
		case "is": return (IS_VALUES as readonly string[]).includes(value) ? { kind: "is", value } : null;
		case "has": return (HAS_VALUES as readonly string[]).includes(value) ? { kind: "has", value } : null;
		default: return null;
	}
}

/**
 * Turn search text into chips with the shared parser (shared/search-query.ts).
 * A lone operator the URL has a chip for becomes that chip; `in:` changes the
 * view; `label:` takes a label's current name. Everything else, including
 * exclusions, OR, unknown labels and the newer operators, stays as text for
 * the server to parse. Operators with bad values are left out and reported.
 */
export function parseSearchText(input: string, labels: readonly LabelRef[] = []): { view?: string; chips: Chip[]; text: string; errors: QueryError[] } {
	const query = parseSearch(input);
	let chips: Chip[] = [];
	let view: string | undefined;
	const rest: string[] = [];
	for (const term of query.terms) {
		const chip = !term.negate && term.any.length === 1 ? chipOf(term.any[0], labels) : null;
		const valid = chip && "kind" in chip ? validChip(chip) : chip;
		if (valid && "view" in valid) view = valid.view;
		else if (valid) chips = addChip(chips, valid);
		else rest.push(input.slice(term.start, term.end));
	}
	if (query.sort) rest.push(`sort:${query.sort}`);
	return { view, chips, text: rest.join(" ").replace(/\s+/g, " ").trim(), errors: query.errors };
}

/** Apply search-field input to a filter: operators become chips, the rest replaces the text chip. */
export function applySearch(filter: MailFilter, input: string, labels: readonly LabelRef[] = []): MailFilter {
	const parsed = parseSearchText(input, labels);
	let chips = filter.chips;
	for (const chip of parsed.chips) chips = addChip(chips, chip);
	if (parsed.text) chips = addChip(chips, { kind: "q", value: parsed.text });
	return { ...filter, view: parsed.view ?? filter.view, chips };
}

/** Values of one chip kind, in path order. */
export function chipValues(filter: MailFilter, kind: ChipKind): string[] {
	return filter.chips.filter((c) => c.kind === kind).map((c) => c.value);
}

// ── Client-side matching ───────────────────────────────────────────

export interface MatchableRow {
	mailbox_id: string;
	state: string;
	sender_addr: string;
	unread: boolean;
	starred: boolean;
	has_attachment: boolean;
	can_unsubscribe: boolean;
	labels: string[];
	date: string;
}

function viewMatches(view: string, row: MatchableRow): boolean {
	switch (view) {
		case "inbox": return row.state === "inbox";
		case "unread": return row.state === "inbox" && row.unread;
		case "starred": return row.starred && row.state !== "trash" && row.state !== "spam";
		case "drafts": return row.state === "draft";
		case "all": return row.state !== "trash" && row.state !== "spam";
		default: return row.state === view;
	}
}

function addressMatches(value: string, mailboxId: string): boolean {
	const [local, domain] = mailboxId.split("@");
	const v = value.replace(/^@/, "");
	if (value.includes("@") && !value.startsWith("@")) return mailboxId === value;
	return v.includes(".") ? domain === v : local === v;
}

/**
 * Whether a row still matches a filter, for optimistic updates. Free text,
 * subject and date chips need the server and are treated as matching.
 */
export function matchesFilter(row: MatchableRow, filter: MailFilter): boolean {
	if (!viewMatches(filter.view, row)) return false;
	const addresses = chipValues(filter, "address");
	if (addresses.length && !addresses.some((a) => addressMatches(a, row.mailbox_id))) return false;
	const froms = chipValues(filter, "from");
	if (froms.length && !froms.some((f) => (f.includes("@") ? row.sender_addr === f : row.sender_addr.endsWith(`@${f.replace(/^@/, "")}`)))) return false;
	for (const label of chipValues(filter, "label")) if (!row.labels.includes(label)) return false;
	for (const value of chipValues(filter, "is")) {
		if (value === "unread" && !row.unread) return false;
		if (value === "read" && row.unread) return false;
		if (value === "starred" && !row.starred) return false;
	}
	for (const value of chipValues(filter, "has")) {
		if (value === "attachment" && !row.has_attachment) return false;
		if (value === "unsubscribe" && !row.can_unsubscribe) return false;
	}
	return true;
}
