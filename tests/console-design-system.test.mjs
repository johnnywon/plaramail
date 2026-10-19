// The console is built from its design system (app/components/postal/ConsoleUI.tsx, `.pg-ui-*`).
// A console file may use only those classes, the app's shared primitives, and the one-offs listed
// below. A one-off has to earn its place: add it here with the reason, and to DESIGN.md (Console).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DIR = new URL("../app/components/postal/", import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), "utf8");

const CONSOLE_FILES = [
	"Console.tsx", "ConsoleColophon.tsx", "ConsoleUI.tsx", "ConsoleSearch.tsx", "ConsoleMessage.tsx", "OverviewTab.tsx",
	"LimitsTab.tsx", "ActivityTab.tsx", "StorageTab.tsx", "LabelsTab.tsx", "ShortcutsTab.tsx", "ModelTab.tsx", "McpTab.tsx",
	"BlockedSenders.tsx",
];

/** Primitives the whole app shares: controls, type, table, layout helpers, dialogs. */
const SHARED = new Set([
	"pg-btn", "pg-btn-", "pg-btn-sm", "pg-btn-primary", "pg-btn-quiet", "pg-btn-danger", "pg-icon-btn",
	"pg-input", "pg-textarea", "pg-select", "pg-kbd", "pg-mono", "pg-flex", "pg-ellipsis", "pg-table",
	"pg-hide-sm", "pg-mobile-only", "pg-desktop-only", "pg-modal", "pg-modal-foot", "pg-drawer-scrim", "pg-rail-head",
	"pg-caption", "pg-popover", "pg-menu-item", "pg-h", "pg-reveal", "pg-reveal-in", "pg-sr-only",
]);

/** One-offs, by prefix, and why each pays off. */
const ONE_OFFS = {
	"pg-console": "the console shell: its rail, page column and search bar",
	"pg-search": "console search reuses the mail search bar so the two heads match",
	"pg-sw": "console search reuses the mail search window",
	"pg-clear": "the search bar's clear button",
	"pg-csw-": "ids for console search options",
	"pg-cmsg": "the thread viewer that opens a message over the console",
	"pg-list": "Draft review uses mail's list column so drafts read like mail",
	"pg-row": "Draft review uses mail's rows",
	"pg-review": "Draft review's full reply and its Send row",
	"pg-gap": "mail's day break between Draft review rows",
	"pg-day-first": "mail's date column in Draft review",
	"pg-empty": "mail's empty state in Draft review",
	"pg-scope-icon": "mail's list head in Draft review",
	"pg-title": "mail's list head in Draft review",
	"pg-count": "mail's list head in Draft review",
	"pg-btn-outline": "Draft review's Edit button, as in mail",
	"pg-label": "the label editor: rename in place, colour, count, delete",
	"pg-color": "the label colour picker",
	"pg-keys": "the shortcut recorder, shared with the ? map",
	"pg-model": "the model picker (DESIGN.md, Settings: Model & key)",
	"pg-models": "the model picker",
	"pg-pick": "the model picker's suggested cards",
	"pg-prov": "the model picker's provider rows",
	"pg-browse": "the model picker's browse rows",
	"pg-zdr": "the zero-retention mark in the model picker",
};

const classesIn = (src) => new Set(src.match(/\bpg-[a-z0-9-]+/g) ?? []);
const allowed = (c) => c.startsWith("pg-ui-") || SHARED.has(c) || Object.keys(ONE_OFFS).some((p) => c.startsWith(p));

test("console files use only design-system classes, shared primitives and listed one-offs", () => {
	const strays = [];
	for (const file of CONSOLE_FILES) {
		for (const c of classesIn(read(file))) if (!allowed(c)) strays.push(`${file}: ${c}`);
	}
	assert.deepEqual(strays, [], "Use a ConsoleUI element, or add the one-off to ONE_OFFS and DESIGN.md with its reason");
});

test("every one-off is still used, so the list stays honest", () => {
	const all = CONSOLE_FILES.map(read).join("\n");
	for (const prefix of Object.keys(ONE_OFFS)) assert.ok(all.includes(prefix), `${prefix} is no longer used; remove it from ONE_OFFS`);
});

test("no inline styles in console files", () => {
	for (const file of CONSOLE_FILES) assert.ok(!/style=\{\{/.test(read(file)), `${file} has an inline style; use a ConsoleUI element`);
});

test("tables with a row per address show the whole address, clipped with the full one in a title (#51)", () => {
	for (const file of ["OverviewTab.tsx", "StorageTab.tsx"]) {
		const column = read(file).match(/\{ key: "address"[^\n]*/)[0];
		assert.doesNotMatch(column, /\bshort\b/, `${file}: hello@example and hello@example.org would read the same`);
		assert.match(column, /clip: \((\w)\) => \1\.mailboxId/, file);
	}
});
