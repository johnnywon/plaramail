// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { isTimeZone } from "./dates";
import { cleanOverrides, sameOverrides, type ShortcutOverrides } from "./shortcuts";

/** Settings > General. Saved to the deployment (R2 config/prefs.json); each browser keeps a copy for a fast first paint. */
export interface Prefs {
	theme: "dark" | "light" | "system";
	/** Show key hints next to controls. Off by default; shortcuts work either way, and tooltips and Settings > Shortcuts always show keys. */
	keys: boolean;
	markRead: boolean;
	images: "ask" | "always" | "never";
	replyFrom: boolean;
	/** Rebound keyboard shortcuts; anything not here keeps its default keys. */
	shortcuts: ShortcutOverrides;
	/** Days the activity log keeps agent and MCP actions. */
	activityDays: ActivityDays;
	/** New mail no agent takes: left alone, or drafted by the PluraMail Agent. */
	unmatched: Unmatched;
	/** The reader's IANA time zone, for times the Worker writes into mail (quotes). Empty until a browser saves it. */
	timeZone: string;
}

export const UNMATCHED = ["leave", "draft"] as const;
export type Unmatched = (typeof UNMATCHED)[number];

export const ACTIVITY_DAYS = [90, 120, 180] as const;
export type ActivityDays = (typeof ACTIVITY_DAYS)[number];

export const DEFAULT_PREFS: Prefs = { theme: "dark", keys: false, markRead: true, images: "ask", replyFrom: true, shortcuts: {}, activityDays: 90, unmatched: "leave", timeZone: "" };

const THEMES = ["dark", "light", "system"] as const;
const IMAGES = ["ask", "always", "never"] as const;

/** Prefs from untrusted input: each known field is kept only if valid, otherwise it comes from base. Unknown fields are dropped. */
export function cleanPrefs(input: unknown, base: Prefs = DEFAULT_PREFS): Prefs {
	const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
	const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
	return {
		theme: pick(o.theme, THEMES, base.theme),
		keys: bool(o.keys, base.keys),
		markRead: bool(o.markRead, base.markRead),
		images: pick(o.images, IMAGES, base.images),
		replyFrom: bool(o.replyFrom, base.replyFrom),
		shortcuts: o.shortcuts === undefined ? base.shortcuts : cleanOverrides(o.shortcuts),
		activityDays: pick(o.activityDays, ACTIVITY_DAYS, base.activityDays),
		unmatched: pick(o.unmatched, UNMATCHED, base.unmatched),
		timeZone: isTimeZone(o.timeZone) ? o.timeZone : base.timeZone,
	};
}

export function samePrefs(a: Prefs, b: Prefs): boolean {
	return a.theme === b.theme && a.keys === b.keys && a.markRead === b.markRead && a.images === b.images && a.replyFrom === b.replyFrom && a.activityDays === b.activityDays && a.unmatched === b.unmatched && a.timeZone === b.timeZone && sameOverrides(a.shortcuts, b.shortcuts);
}
