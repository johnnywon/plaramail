// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * URL and display helpers for the postal view. The URL keeps the same filter
 * keys as the unified view (view, address, label, is, has, date, sort, dir,
 * open) plus `search`, the raw text in the search bar.
 */

import {
	addChip,
	applySearch,
	type Chip,
	type ChipKind,
	chipValues,
	type LabelRef,
	type MailFilter,
	type OwnAddresses,
	parseFilter,
	parseSearchText,
	removeChip,
} from "~/lib/mail-filter";
import { highlightTerms, parseSearch, type QueryError } from "../../../shared/search-query";

const FILTER_KEYS = ["view", "sort", "dir", "address", "from", "label", "is", "has", "subject", "date", "before", "after", "q"];

/** The postal view lands on Inbox across all addresses, not the Unread view. */
export const HOME: MailFilter = { view: "inbox", chips: [], sort: "date", dir: "desc" };

/** What the row, bulk and reader toolbars can do to a conversation. */
export type MailAction = "archive" | "trash" | "read" | "star" | "restore" | "spam";

/** Views whose mail can move back to the Inbox. */
export const RESTORABLE: ReadonlySet<string> = new Set(["archive", "spam", "trash"]);

export function parsePostalFilter(params: URLSearchParams): MailFilter {
	if (![...params.keys()].some((k) => FILTER_KEYS.includes(k))) return { ...HOME, chips: [] };
	return parseFilter(params);
}

/** `in:` names a view (in:sent) or, like `to:`, an address or domain. */
export function normalizeSearch(input: string): string {
	return input.replace(/(^|\s)in:(?:"([^"]*)"|(\S+))/gi, (whole, lead: string, quoted?: string, bare?: string) => {
		const value = (quoted ?? bare ?? "").trim();
		return value.includes("@") || value.includes(".") ? `${lead}to:${value}` : whole;
	});
}

export function withSearch(filter: MailFilter, search: string, labels: readonly LabelRef[], own?: OwnAddresses): MailFilter {
	const text = search.trim();
	if (!text) return filter;
	return applySearch(filter, normalizeSearch(text), labels, own);
}

/** Free-text words of the search, for highlighting. Excluded words and operators are left out. */
export function searchTerms(search: string, labels: readonly LabelRef[], own?: OwnAddresses): string[] {
	const parsed = parseSearchText(normalizeSearch(search), labels, own);
	return highlightTerms(parseSearch(parsed.text));
}

/** Operators in the search whose values don't parse. They are left out of the search. */
export function searchErrors(search: string): QueryError[] {
	return parseSearch(normalizeSearch(search)).errors;
}

export function scopeOf(filter: MailFilter): string | null {
	const values = chipValues(filter, "address");
	return values.length === 1 ? values[0] : null;
}

/** A label view: All mail narrowed to one label from the sidebar, with no address scope. */
export function labelOf(filter: MailFilter): string | null {
	if (filter.view !== "all" || filter.chips.some((c) => c.kind === "address")) return null;
	return filter.chips[0]?.kind === "label" ? filter.chips[0].value : null;
}

export function hasChip(filter: MailFilter, kind: ChipKind, value: string): boolean {
	return filter.chips.some((c) => c.kind === kind && c.value === value);
}

export function toggleChip(filter: MailFilter, chip: Chip): MailFilter {
	const on = hasChip(filter, chip.kind, chip.value);
	return { ...filter, chips: on ? removeChip(filter.chips, chip) : addChip(filter.chips, chip) };
}

export function withoutKinds(filter: MailFilter, kinds: ChipKind[]): MailFilter {
	return { ...filter, chips: filter.chips.filter((c) => !kinds.includes(c.kind)) };
}

/** Address or domain scope with a view; drops labels and other scopes. */
export function scoped(view: string, scope: string | null, base: MailFilter): MailFilter {
	const chips = scope ? [{ kind: "address" as const, value: scope }] : [];
	const keep = base.chips.filter((c) => c.kind === "is" || c.kind === "has" || c.kind === "date");
	return { view, chips: [...chips, ...keep], sort: base.sort, dir: base.dir };
}

/** Chips the Filter popover owns: status, labels and date. Unread-only and a label view are counted elsewhere. */
export function filterCount(filter: MailFilter): number {
	const view = labelOf(filter);
	let skipped = false;
	return filter.chips.filter((c) => {
		if (c.kind === "is" && c.value === "unread") return false;
		if (c.kind === "label" && view === c.value && !skipped) {
			skipped = true;
			return false;
		}
		return c.kind === "is" || c.kind === "has" || c.kind === "label" || c.kind === "date";
	}).length;
}

// ── Dates ────────────────────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayKey(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "FRI OCT 9", with the year when it is not this year. */
export function dayLabel(iso: string, now = new Date()): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
	return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`.toUpperCase();
}

export function timeLabel(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Fri, Oct 9 · 2:01 PM" */
export function fullDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === new Date().getFullYear() ? "" : `, ${d.getFullYear()}`} · ${timeLabel(iso)}`;
}

/** "Tue, Oct 13, 8:00 AM" for schedule times. */
export function sendTimeLabel(d: Date): string {
	return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function formatSize(bytes: number): string {
	return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function conversations(n: number) {
	return n === 1 ? "conversation" : `${n.toLocaleString()} conversations`;
}

/** Display name from a raw From header value, else the address. */
export function nameFromHeaders(rawHeaders: string | null | undefined, fallback: string): string {
	if (!rawHeaders) return fallback;
	try {
		const parsed = JSON.parse(rawHeaders) as unknown;
		const list = Array.isArray(parsed)
			? (parsed as { key?: string; value?: string }[])
			: Object.entries(parsed as Record<string, string>).map(([key, value]) => ({ key, value }));
		const from = list.find((h) => String(h.key).toLowerCase() === "from")?.value;
		const m = from ? String(from).match(/^\s*"?([^"<]+?)"?\s*</) : null;
		return m?.[1]?.trim() || fallback;
	} catch {
		return fallback;
	}
}

export const ADDRESS_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>.]+$/;
