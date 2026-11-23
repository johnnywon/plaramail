// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Every keyboard shortcut, defined once. The mail view's key handler, the
 * tooltips, the key hints, the ? map, Settings > Shortcuts and the agent's
 * shortcut tools all read this.
 *
 * A binding is a step like "e", "Shift+x", "Mod+k" or "ArrowDown", or two
 * steps for a sequence ("g i"). Mod is ⌘ on a Mac and Ctrl elsewhere. A
 * letter is always lower case; Shift is written out. A symbol carries its own
 * shift: "?" and "#", never "Shift+/". parseBinding() turns looser text
 * ("cmd+K", "ctrl+shift+k", "⌘↵", "down") into this form.
 *
 * Mail-scope shortcuts that are not fixed can be rebound, in Settings or by
 * the agent and MCP (list_shortcuts, set_shortcut, reset_shortcuts). The rest
 * are listed so the list is complete, but the composer, the editor and the
 * search box handle them on their own.
 *
 * Adding a shortcut:
 * 1. Add an entry to SHORTCUTS: id, group, label, keys, scope and the map
 *    area. Use primary for a key people press all day.
 * 2. For scope "mail", add its action to the `actions` map in
 *    app/components/postal/PostalMail.tsx. Typecheck fails until you do.
 * 3. Give the button it triggers a title from useShortcuts().tip(id, label)
 *    so its tooltip shows the key, rebound or not.
 * tests/shortcuts.test.mjs checks the defaults don't clash.
 */

export type ShortcutGroup = "Navigate" | "Conversation" | "Write" | "Search" | "App";

/** Where a shortcut works: the mail view's handler, the composer, or the search box. */
export type ShortcutScope = "mail" | "compose" | "search";

/**
 * Where the ? map draws a shortcut: on the search bar, the sidebar's Go to
 * list, the message list, the message toolbar, the agent column, the
 * composer, or in the quiet "more" line under the map.
 */
export type ShortcutArea = "search" | "go" | "list" | "toolbar" | "agent" | "composer" | "more";

export interface ShortcutDef {
	id: string;
	group: ShortcutGroup;
	label: string;
	keys: readonly string[];
	scope: ShortcutScope;
	/** Listed but not rebindable. */
	fixed?: boolean;
	/** Shift plus the key does the ranged version (Shift+x selects a range). */
	shiftRange?: boolean;
	hint?: string;
	area: ShortcutArea;
	/** A key people press all day: drawn larger on the map. */
	primary?: boolean;
	/** Toolbar keys sit in the reader's button groups; a new cluster starts a new group. */
	cluster?: number;
	/** A shorter name for the map. */
	short?: string;
	/** Drawn in its column's header on the map, where the real collapse button is. */
	header?: boolean;
}

export const SHORTCUTS = [
	{ id: "next", group: "Navigate", label: "Next conversation", keys: ["j", "ArrowDown"], scope: "mail", area: "list", primary: true, short: "Next" },
	{ id: "prev", group: "Navigate", label: "Previous conversation", keys: ["k", "ArrowUp"], scope: "mail", area: "list", primary: true, short: "Previous" },
	{ id: "search", group: "Navigate", label: "Search", keys: ["/", "Mod+k"], scope: "mail", area: "search", primary: true },
	{ id: "goInbox", group: "Navigate", label: "Go to Inbox", keys: ["g i"], scope: "mail", fixed: true, area: "go", short: "Inbox" },
	{ id: "goStarred", group: "Navigate", label: "Go to Starred", keys: ["g s"], scope: "mail", fixed: true, area: "go", short: "Starred" },
	{ id: "goDrafts", group: "Navigate", label: "Go to Drafts", keys: ["g d"], scope: "mail", fixed: true, area: "go", short: "Drafts" },
	{ id: "goSent", group: "Navigate", label: "Go to Sent", keys: ["g t"], scope: "mail", fixed: true, area: "go", short: "Sent" },
	{ id: "goAll", group: "Navigate", label: "Go to All mail", keys: ["g a"], scope: "mail", fixed: true, area: "go", short: "All mail" },
	{ id: "nextView", group: "Navigate", label: "Next view", keys: ["`"], scope: "mail", hint: "Inbox, Unread, Starred, Drafts", area: "go", short: "Next view" },
	{ id: "prevView", group: "Navigate", label: "Previous view", keys: ["~"], scope: "mail", hint: "Drafts, Starred, Unread, Inbox", area: "go", short: "Previous view" },
	{ id: "back", group: "Navigate", label: "Clear selection or back to the list", keys: ["Escape", "u"], scope: "mail", fixed: true, area: "more", short: "Close" },

	{ id: "archive", group: "Conversation", label: "Archive", keys: ["e"], scope: "mail", area: "toolbar", primary: true, cluster: 2 },
	{ id: "trash", group: "Conversation", label: "Move to Trash", keys: ["#", "Delete"], scope: "mail", area: "toolbar", primary: true, cluster: 2, short: "Trash" },
	{ id: "spam", group: "Conversation", label: "Report spam", keys: ["!"], scope: "mail", area: "toolbar", cluster: 2, short: "Spam" },
	{ id: "markRead", group: "Conversation", label: "Mark read", keys: ["Shift+i"], scope: "mail", area: "toolbar", cluster: 3 },
	{ id: "markUnread", group: "Conversation", label: "Mark unread", keys: ["Shift+u"], scope: "mail", area: "toolbar", cluster: 3 },
	{ id: "star", group: "Conversation", label: "Star or unstar", keys: ["s"], scope: "mail", area: "toolbar", cluster: 3, short: "Star" },
	{ id: "label", group: "Conversation", label: "Label", keys: ["l"], scope: "mail", area: "toolbar", cluster: 3 },
	{ id: "select", group: "Conversation", label: "Select", keys: ["x"], scope: "mail", shiftRange: true, hint: "With Shift, selects a range", area: "list" },
	{ id: "undo", group: "Conversation", label: "Undo", keys: ["z"], scope: "mail", area: "more" },

	{ id: "compose", group: "Write", label: "New message", keys: ["c"], scope: "mail", area: "list" },
	{ id: "reply", group: "Write", label: "Reply", keys: ["r"], scope: "mail", area: "toolbar", primary: true, cluster: 1 },
	{ id: "replyAll", group: "Write", label: "Reply all", keys: ["a"], scope: "mail", area: "toolbar", primary: true, cluster: 1, short: "All" },
	{ id: "forward", group: "Write", label: "Forward", keys: ["f"], scope: "mail", area: "toolbar", primary: true, cluster: 1 },
	{ id: "send", group: "Write", label: "Send", keys: ["Mod+Enter"], scope: "compose", fixed: true, area: "composer", primary: true },
	{ id: "minimise", group: "Write", label: "Minimize or close the composer", keys: ["Escape"], scope: "compose", fixed: true, area: "composer" },
	{ id: "bold", group: "Write", label: "Bold", keys: ["Mod+b"], scope: "compose", fixed: true, area: "composer" },
	{ id: "italic", group: "Write", label: "Italic", keys: ["Mod+i"], scope: "compose", fixed: true, area: "composer" },
	{ id: "underline", group: "Write", label: "Underline", keys: ["Mod+u"], scope: "compose", fixed: true, area: "composer" },
	{ id: "link", group: "Write", label: "Link", keys: ["Mod+k"], scope: "compose", fixed: true, area: "composer" },

	{ id: "searchMove", group: "Search", label: "Move through suggestions", keys: ["ArrowDown", "ArrowUp"], scope: "search", fixed: true, area: "search" },
	{ id: "searchComplete", group: "Search", label: "Complete", keys: ["Tab"], scope: "search", fixed: true, area: "search" },
	{ id: "searchOpen", group: "Search", label: "Open the first result", keys: ["Enter"], scope: "search", fixed: true, area: "search" },
	{ id: "searchRun", group: "Search", label: "Search", keys: ["Mod+Enter"], scope: "search", fixed: true, area: "search" },
	{ id: "searchSave", group: "Search", label: "Save search", keys: ["Mod+s"], scope: "search", fixed: true, area: "search" },
	{ id: "searchClose", group: "Search", label: "Close suggestions, then clear", keys: ["Escape"], scope: "search", fixed: true, area: "search" },

	{ id: "sidebar", group: "App", label: "Sidebar", keys: ["Mod+b"], scope: "mail", area: "go", header: true },
	{ id: "agent", group: "App", label: "Agent panel", keys: ["Mod+j"], scope: "mail", area: "agent", header: true },
	{ id: "panels", group: "App", label: "Both side panels", keys: ["\\"], scope: "mail", area: "more", short: "Both panels" },
	{ id: "help", group: "App", label: "Keyboard shortcuts", keys: ["?"], scope: "mail", fixed: true, area: "more", short: "Shortcuts" },
] as const satisfies readonly ShortcutDef[];

type Def = (typeof SHORTCUTS)[number];
export type ShortcutId = Def["id"];
export type MailShortcutId = Extract<Def, { scope: "mail" }>["id"];
export type RebindableId = Exclude<Extract<Def, { scope: "mail" }>, { fixed: true }>["id"];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["Navigate", "Conversation", "Write", "Search", "App"];
const ALL: readonly ShortcutDef[] = SHORTCUTS;
const BY_ID = new Map<string, ShortcutDef>(ALL.map((s) => [s.id, s]));

export function shortcut(id: ShortcutId): ShortcutDef {
	return BY_ID.get(id)!;
}

export function isRebindable(id: string): id is RebindableId {
	const def = BY_ID.get(id);
	return !!def && def.scope === "mail" && !def.fixed;
}

/** Saved rebindings: a shortcut's keys, replacing its defaults. An empty list turns it off. */
export type ShortcutOverrides = Partial<Record<RebindableId, string[]>>;

/** At most this many keys per shortcut. */
export const MAX_KEYS = 2;

const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control", "Alt", "AltGraph", "CapsLock", "Fn", "OS", "Hyper", "Super"]);
const NAMED_KEYS = new Set([
	"Enter", "Escape", "Tab", "Backspace", "Delete", "Space", "Home", "End", "PageUp", "PageDown",
	"ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);
const STEP = /^((?:Mod\+|Alt\+|Shift\+)*)(.+)$/;

export interface KeyLike {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
}

/** The step a key event makes, or null for a lone modifier or a key we don't name. */
export function stepOf(e: KeyLike): string | null {
	if (!e.key || MODIFIER_KEYS.has(e.key) || e.key === "Dead" || e.key === "Unidentified") return null;
	let key = e.key === " " ? "Space" : e.key;
	const letter = /^[a-z]$/i.test(key);
	if (letter) key = key.toLowerCase();
	else if (key.length > 1 && !NAMED_KEYS.has(key)) return null;
	const named = key.length > 1;
	let mods = "";
	if (e.metaKey || e.ctrlKey) mods += "Mod+";
	if (e.altKey) mods += "Alt+";
	if (e.shiftKey && (letter || named)) mods += "Shift+";
	return mods + key;
}

/** The views nextView and prevView step through, in order. From any other view, nextView goes to the first and prevView to the last. */
export const CYCLE_VIEWS = ["inbox", "unread", "starred", "drafts"] as const;

export function cycleView(view: string, step: 1 | -1): (typeof CYCLE_VIEWS)[number] {
	const i = (CYCLE_VIEWS as readonly string[]).indexOf(view);
	const n = CYCLE_VIEWS.length;
	return CYCLE_VIEWS[i < 0 ? (step > 0 ? 0 : n - 1) : (i + step + n) % n];
}

/** Whether a string is a step the matcher understands. */
export function validStep(step: string): boolean {
	const m = STEP.exec(step);
	if (!m) return false;
	const key = m[2];
	if (key.length === 1) return key === key.toLowerCase() || !/[a-z]/i.test(key);
	return NAMED_KEYS.has(key);
}

/** Keys the mail view keeps for itself: its fixed keys (Escape, u, ?), the first key of a sequence (g), and keys that move focus or type. */
const RESERVED = new Set([
	...ALL.filter((s) => s.scope === "mail" && s.fixed).flatMap((s) => s.keys.map((k) => k.split(" ")[0])),
	"Tab", "Shift+Tab", "Enter", "Space", "Shift+Space",
]);

/**
 * ⌘ keys the browser or the OS acts on first (new tab, close, reload, quit,
 * hide, zoom, tab switching) or that people expect to edit text (copy,
 * paste, select all, undo, find, print). A page never sees some of them, so
 * a shortcut on one would silently not fire.
 */
const BROWSER_KEYS = new Set([
	..."tnwqrlhmcvxazfpdoy0123456789,=-+".split("").map((k) => `Mod+${k}`),
	..."tnwrzbhjoip".split("").map((k) => `Mod+Shift+${k}`),
	"Mod+Tab", "Mod+Shift+Tab", "Mod+ArrowLeft", "Mod+ArrowRight", "Mod+Backspace", "Mod+Delete",
]);

/** Why a step can't be bound to a shortcut, or null if it can. */
export function cannotBind(step: string): string | null {
	if (!validStep(step)) return "That key can't be used.";
	if (RESERVED.has(step)) return step === "g" ? "G starts the Go to shortcuts." : `${keyText(step, true)} is kept for the app.`;
	if (step.startsWith("Alt+") || step.includes("+Alt+")) return "Option and Alt type characters; use another key.";
	if (BROWSER_KEYS.has(step)) return `${keyText(step, true)} belongs to the browser.`;
	return null;
}

/** Overrides from untrusted input: known, rebindable ids with valid, bindable, distinct keys. */
export function cleanOverrides(input: unknown): ShortcutOverrides {
	const out: ShortcutOverrides = {};
	if (!input || typeof input !== "object" || Array.isArray(input)) return out;
	for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
		if (!isRebindable(id) || !Array.isArray(value)) continue;
		const keys = [...new Set(value.filter((k): k is string => typeof k === "string" && cannotBind(k) === null))].slice(0, MAX_KEYS);
		out[id] = keys;
	}
	return out;
}

/** The keys each shortcut answers to. A rebound key is taken from the shortcut that had it by default. */
export function resolveBindings(overrides: ShortcutOverrides = {}): Map<ShortcutId, string[]> {
	const claimed = new Map<string, Map<ShortcutScope, ShortcutId>>();
	const claim = (step: string, def: ShortcutDef) => {
		const scopes = claimed.get(step) ?? new Map<ShortcutScope, ShortcutId>();
		if (scopes.has(def.scope)) return false;
		scopes.set(def.scope, def.id as ShortcutId);
		claimed.set(step, scopes);
		return true;
	};
	const out = new Map<ShortcutId, string[]>();
	const own = (def: ShortcutDef) => (isRebindable(def.id) ? overrides[def.id] : undefined);
	// Fixed keys first, then rebound ones, then the defaults left over.
	for (const def of ALL) if (def.fixed) out.set(def.id as ShortcutId, def.keys.filter((k) => claim(k, def)));
	for (const def of ALL) {
		const keys = own(def);
		if (!def.fixed && keys) out.set(def.id as ShortcutId, keys.filter((k) => claim(k, def)));
	}
	for (const def of ALL) if (!def.fixed && !own(def)) out.set(def.id as ShortcutId, def.keys.filter((k) => claim(k, def)));
	return out;
}

/** Overrides with `keys` given to `id`, taken away from any other shortcut that had them. */
export function rebind(overrides: ShortcutOverrides, id: RebindableId, keys: string[]): ShortcutOverrides {
	const current = resolveBindings(overrides);
	const next: ShortcutOverrides = { ...overrides };
	for (const def of ALL) {
		if (def.id === id || !isRebindable(def.id)) continue;
		const had = current.get(def.id) ?? [];
		if (had.some((k) => keys.includes(k))) next[def.id] = had.filter((k) => !keys.includes(k));
	}
	next[id] = keys.slice(0, MAX_KEYS);
	return tidy(next);
}

/** Overrides without entries that only repeat the defaults. */
export function tidy(overrides: ShortcutOverrides): ShortcutOverrides {
	const out: ShortcutOverrides = {};
	for (const [id, keys] of Object.entries(overrides) as [RebindableId, string[]][]) {
		const def = shortcut(id);
		if (keys.length === def.keys.length && keys.every((k, i) => k === def.keys[i])) continue;
		out[id] = keys;
	}
	return out;
}

export function sameOverrides(a: ShortcutOverrides, b: ShortcutOverrides): boolean {
	const ka = Object.keys(a).sort();
	const kb = Object.keys(b).sort();
	if (ka.join() !== kb.join()) return false;
	return ka.every((id) => (a[id as RebindableId] ?? []).join(" ") === (b[id as RebindableId] ?? []).join(" "));
}

/** Which shortcut a binding in the given scope belongs to. */
export function ownerOf(bindings: Map<ShortcutId, string[]>, step: string, scope: ShortcutScope = "mail"): ShortcutId | null {
	for (const [id, keys] of bindings) if (shortcut(id).scope === scope && keys.includes(step)) return id;
	return null;
}

const SEQUENCE_MS = 1000;

/**
 * Turns key steps into mail-scope shortcuts. The first step of a sequence
 * ("g" of "g i") returns "pending"; the second, within a second, the shortcut.
 */
export class KeyMatcher {
	private single = new Map<string, MailShortcutId>();
	private sequences = new Map<string, MailShortcutId>();
	private starts = new Set<string>();
	private pending: { step: string; at: number } | null = null;

	constructor(bindings: Map<ShortcutId, string[]>) {
		for (const [id, keys] of bindings) {
			if (shortcut(id).scope !== "mail") continue;
			for (const k of keys) {
				if (k.includes(" ")) {
					this.sequences.set(k, id as MailShortcutId);
					this.starts.add(k.split(" ")[0]);
				} else this.single.set(k, id as MailShortcutId);
			}
		}
	}

	match(step: string, now = Date.now()): { id: MailShortcutId; shift: boolean } | "pending" | null {
		const prev = this.pending;
		this.pending = null;
		if (prev && now - prev.at < SEQUENCE_MS) {
			const id = this.sequences.get(`${prev.step} ${step}`);
			if (id) return { id, shift: false };
		}
		if (this.starts.has(step)) {
			this.pending = { step, at: now };
			return "pending";
		}
		const id = this.single.get(step);
		if (id) return { id, shift: false };
		if (step.startsWith("Shift+")) {
			const base = this.single.get(step.slice(6));
			if (base && shortcut(base).shiftRange) return { id: base, shift: true };
		}
		return null;
	}
}

const CAPS: Record<string, string> = {
	ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "↵", Escape: "Esc", Backspace: "⌫",
	Delete: "Del", Space: "Space", Tab: "Tab", PageUp: "PgUp", PageDown: "PgDn", Home: "Home", End: "End",
};

/** Keycaps for a binding: "Mod+Enter" is ["⌘", "↵"] on a Mac and ["Ctrl", "↵"] elsewhere. A sequence's steps are joined. */
export function keycaps(binding: string, mac: boolean): string[] {
	return binding.split(" ").flatMap((step) => {
		const m = STEP.exec(step);
		if (!m) return [step];
		const mods = m[1].split("+").filter(Boolean).map((mod) => (mod === "Mod" ? (mac ? "⌘" : "Ctrl") : mod === "Shift" ? (mac ? "⇧" : "Shift") : mac ? "⌥" : "Alt"));
		const key = CAPS[m[2]] ?? (m[2].length === 1 ? m[2].toUpperCase() : m[2]);
		return [...mods, key];
	});
}

/** A binding as tooltip text, "(⌘K)" style without the parentheses: "⌘K", "Ctrl+K", "G I". */
export function keyText(binding: string, mac: boolean): string {
	return binding.split(" ").map((step) => {
		const caps = keycaps(step, mac);
		return mac ? caps.join("") : caps.join("+");
	}).join(" ");
}

// ── For agents ───────────────────────────────────────────────────

const KEY_ALIASES: Record<string, string> = {
	esc: "Escape", escape: "Escape", enter: "Enter", return: "Enter", "↵": "Enter", tab: "Tab", space: "Space",
	backspace: "Backspace", "⌫": "Backspace", delete: "Delete", del: "Delete", home: "Home", end: "End",
	pageup: "PageUp", pgup: "PageUp", pagedown: "PageDown", pgdn: "PageDown",
	up: "ArrowUp", arrowup: "ArrowUp", "↑": "ArrowUp", down: "ArrowDown", arrowdown: "ArrowDown", "↓": "ArrowDown",
	left: "ArrowLeft", arrowleft: "ArrowLeft", "←": "ArrowLeft", right: "ArrowRight", arrowright: "ArrowRight", "→": "ArrowRight",
};
const MOD_ALIASES: Record<string, "Mod" | "Shift" | "Alt"> = {
	mod: "Mod", cmd: "Mod", command: "Mod", meta: "Mod", ctrl: "Mod", control: "Mod", "⌘": "Mod", "⌃": "Mod",
	shift: "Shift", "⇧": "Shift", alt: "Alt", option: "Alt", opt: "Alt", "⌥": "Alt",
};

/**
 * A binding from loose text, or null: "E", "shift+x", "Cmd+K", "ctrl-enter",
 * "⌘↵", "down", "g i". A capital letter alone means the letter, not Shift.
 */
export function parseBinding(text: string): string | null {
	const steps = text.trim().split(/\s+(?:then\s+)?/i).filter(Boolean);
	if (!steps.length || steps.length > 2) return null;
	const out: string[] = [];
	for (const raw of steps) {
		const mods = new Set<string>();
		let rest = raw;
		// Symbol modifiers glued to the key: ⌘K, ⌘⇧K.
		while (rest.length > 1 && MOD_ALIASES[rest[0]]) {
			mods.add(MOD_ALIASES[rest[0]]);
			rest = rest.slice(1);
		}
		const parts = rest.length > 1 ? rest.split(/[+-](?=.)/) : [rest];
		const keyPart = parts.pop()!;
		for (const p of parts) {
			const mod = MOD_ALIASES[p.toLowerCase()];
			if (!mod) return null;
			mods.add(mod);
		}
		let key = KEY_ALIASES[keyPart.toLowerCase()] ?? keyPart;
		if (key.length === 1) key = key.toLowerCase();
		const prefix = ["Mod", "Alt", "Shift"].filter((m) => mods.has(m)).map((m) => `${m}+`).join("");
		const step = prefix + key;
		if (!validStep(step)) return null;
		out.push(step);
	}
	return out.join(" ");
}

/** A shortcut named by id or label, any case ("archive", "Reply all", "replyAll"). */
export function findShortcut(ref: string): ShortcutDef | null {
	const r = ref.trim().toLowerCase().replace(/[\s_-]+/g, "");
	return ALL.find((s) => s.id.toLowerCase() === r || s.label.toLowerCase().replace(/\s+/g, "") === r || s.short?.toLowerCase().replace(/\s+/g, "") === r) ?? null;
}

export interface ShortcutInfo {
	id: ShortcutId;
	label: string;
	group: ShortcutGroup;
	/** Where it works: the mail view, the composer or the search box. */
	scope: ShortcutScope;
	keys: string[];
	defaultKeys: string[];
	rebindable: boolean;
}

/** Every shortcut with the keys it answers to now, for list_shortcuts. */
export function describeShortcuts(overrides: ShortcutOverrides = {}): ShortcutInfo[] {
	const bindings = resolveBindings(overrides);
	return ALL.map((s) => ({
		id: s.id as ShortcutId,
		label: s.label,
		group: s.group,
		scope: s.scope,
		keys: bindings.get(s.id as ShortcutId) ?? [],
		defaultKeys: [...s.keys],
		rebindable: isRebindable(s.id),
	}));
}

export type SetShortcutResult =
	| { ok: true; overrides: ShortcutOverrides; id: RebindableId; keys: string[]; takenFrom: { id: ShortcutId; label: string; keys: string[] }[] }
	| { ok: false; error: string };

/**
 * Give a shortcut new keys, as set_shortcut does. `keys` are loose text
 * (parseBinding); an empty list turns the shortcut off; null restores its
 * defaults. A key another shortcut had moves over, and the result says which.
 */
export function setShortcut(overrides: ShortcutOverrides, ref: string, keys: string[] | null): SetShortcutResult {
	const def = findShortcut(ref);
	if (!def) return { ok: false, error: `Unknown shortcut: ${ref}. Use list_shortcuts to see them.` };
	if (!isRebindable(def.id)) return { ok: false, error: `${def.label} is fixed and can't be rebound.` };
	const steps: string[] = [];
	for (const text of keys ?? def.keys) {
		const step = parseBinding(text);
		if (!step) return { ok: false, error: `Can't read "${text}" as a key. Try "y", "shift+y", "cmd+k" or "down".` };
		const reason = cannotBind(step);
		if (reason) return { ok: false, error: `${text}: ${reason}` };
		if (!steps.includes(step)) steps.push(step);
	}
	if (steps.length > MAX_KEYS) return { ok: false, error: `A shortcut takes at most ${MAX_KEYS} keys.` };
	const before = resolveBindings(overrides);
	const next = rebind(overrides, def.id, steps);
	const takenFrom = [...before].filter(([id, had]) => id !== def.id && shortcut(id).scope === "mail" && had.some((k) => steps.includes(k)))
		.map(([id, had]) => ({ id, label: shortcut(id).label, keys: had.filter((k) => steps.includes(k)) }));
	return { ok: true, overrides: next, id: def.id, keys: steps, takenFrom };
}

/** What changed between two sets of overrides, as "Archive is now Y" lines; for the toast when keys change elsewhere. */
export function describeChanges(before: ShortcutOverrides, after: ShortcutOverrides, mac: boolean): string[] {
	const a = resolveBindings(before);
	const b = resolveBindings(after);
	const out: string[] = [];
	for (const def of ALL) {
		if (!isRebindable(def.id)) continue;
		const was = a.get(def.id as ShortcutId) ?? [];
		const now = b.get(def.id as ShortcutId) ?? [];
		if (was.join(" ") === now.join(" ")) continue;
		out.push(now.length ? `${def.label} is now ${now.map((k) => keyText(k, mac)).join(" or ")}` : `${def.label} is off`);
	}
	return out;
}
