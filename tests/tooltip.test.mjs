import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const { parseTip, splitKeys } = await loadTs("app/components/postal/Tooltip.tsx");

test("a title's shortcut becomes keycaps", () => {
	assert.deepEqual(splitKeys("⌘↵"), ["⌘", "↵"]);
	assert.deepEqual(splitKeys("Esc"), ["Esc"]);
	assert.deepEqual(splitKeys("⌘⇧K"), ["⌘", "⇧", "K"]);
	assert.deepEqual(parseTip("Send (⌘↵)"), { label: "Send", keys: ["⌘", "↵"], hint: undefined });
});

test("text after a middle dot is the hint line", () => {
	assert.deepEqual(parseTip("Select (X) · shift-click for a range"), { label: "Select", keys: ["X"], hint: "shift-click for a range" });
	assert.deepEqual(parseTip("Label · Labels are shared", "More"), { label: "Label", keys: [], hint: "Labels are shared. More" });
});

test("long parentheses stay in the label", () => {
	assert.equal(parseTip("Archive (everything older than a year)").label, "Archive (everything older than a year)");
	assert.equal(parseTip("  "), null);
});

test("keys off a Mac and sequences split into keycaps", () => {
	assert.deepEqual(splitKeys("Ctrl+K"), ["Ctrl", "K"]);
	assert.deepEqual(splitKeys("Ctrl+⇧K"), ["Ctrl", "⇧", "K"]);
	assert.deepEqual(splitKeys("G I"), ["G", "I"]);
	assert.deepEqual(splitKeys("#"), ["#"]);
	assert.deepEqual(parseTip("Search (Ctrl+Shift+K)"), { label: "Search", keys: ["Ctrl", "Shift", "K"], hint: undefined });
});

test("with key hints off, tooltips leave out their keys", async () => {
	const { readFileSync } = await import("node:fs");
	const tooltip = readFileSync(new URL("../app/components/postal/Tooltip.tsx", import.meta.url), "utf8");
	const css = readFileSync(new URL("../app/components/postal/postal.css", import.meta.url), "utf8");
	assert.match(tooltip, /closest\("\.postal"\)\?\.getAttribute\("data-keys"\) === "off"\) tip\.keys = \[\]/);
	const rule = css.split("\n").find((l) => l.startsWith('.postal[data-keys="off"] :is(.pg-kbd, .pg-keyhint, kbd)'));
	assert.ok(rule && !rule.includes(".pg-tip"), "the hide rule must cover every kbd and not exempt tooltips");
});

test("key hints come from shared/shortcuts, never a typed key", async () => {
	const { readdirSync, readFileSync } = await import("node:fs");
	const dir = new URL("../app/components/postal/", import.meta.url);
	const typed = [];
	for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
		readFileSync(new URL(f, dir), "utf8").split("\n").forEach((line, i) => {
			if (/<kbd[^>]*>[^<{]+<\/kbd>/.test(line)) typed.push(`${f}:${i + 1}`);
		});
	}
	assert.deepEqual(typed, [], "Use <Keys id=...> so the hint follows rebinding and Show key hints");
});
