import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const { SHORTCUTS, KeyMatcher, cannotBind, cycleView, describeChanges, cleanOverrides, describeShortcuts, findShortcut, keycaps, keyText, parseBinding, rebind, resolveBindings, setShortcut, stepOf, tidy, validStep } = await loadTs("shared/shortcuts.ts");

test("ids are unique and every default key is a valid step", () => {
	const ids = SHORTCUTS.map((s) => s.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const s of SHORTCUTS) for (const k of s.keys) for (const step of k.split(" ")) assert.ok(validStep(step), `${s.id}: ${step}`);
});

test("no two shortcuts in a scope share a key by default", () => {
	const bindings = resolveBindings();
	for (const s of SHORTCUTS) assert.deepEqual(bindings.get(s.id), [...s.keys], s.id);
});

test("a key event becomes a step", () => {
	assert.equal(stepOf({ key: "E" , shiftKey: true }), "Shift+e");
	assert.equal(stepOf({ key: "e" }), "e");
	assert.equal(stepOf({ key: "?", shiftKey: true }), "?");
	assert.equal(stepOf({ key: "#", shiftKey: true }), "#");
	assert.equal(stepOf({ key: "k", metaKey: true }), "Mod+k");
	assert.equal(stepOf({ key: "K", ctrlKey: true, shiftKey: true }), "Mod+Shift+k");
	assert.equal(stepOf({ key: "Enter", metaKey: true }), "Mod+Enter");
	assert.equal(stepOf({ key: "ArrowDown", shiftKey: true }), "Shift+ArrowDown");
	assert.equal(stepOf({ key: " " }), "Space");
	assert.equal(stepOf({ key: "Shift", shiftKey: true }), null);
	assert.equal(stepOf({ key: "F5" }), null);
});

test("the matcher finds singles, sequences and Shift ranges", () => {
	const m = new KeyMatcher(resolveBindings());
	assert.deepEqual(m.match("e", 0), { id: "archive", shift: false });
	assert.deepEqual(m.match("Shift+x", 0), { id: "select", shift: true });
	assert.equal(m.match("Shift+e", 0), null);
	assert.equal(m.match("g", 0), "pending");
	assert.deepEqual(m.match("i", 500), { id: "goInbox", shift: false });
	assert.equal(m.match("g", 0), "pending");
	assert.equal(m.match("i", 1500), null);
	assert.deepEqual(m.match("Mod+j", 0), { id: "agent", shift: false });
	assert.equal(m.match("Mod+i", 0), null, "editor keys are not mail keys");
	assert.deepEqual(m.match("Shift+i", 0), { id: "markRead", shift: false });
	assert.deepEqual(m.match("u", 0), { id: "back", shift: false });
	assert.deepEqual(m.match("Delete", 0), { id: "trash", shift: false });
});

test("rebinding a key takes it from the shortcut that had it", () => {
	const overrides = rebind({}, "archive", ["s"]);
	assert.deepEqual(overrides, { archive: ["s"], star: [] });
	const bindings = resolveBindings(overrides);
	assert.deepEqual(bindings.get("archive"), ["s"]);
	assert.deepEqual(bindings.get("star"), []);
	const m = new KeyMatcher(bindings);
	assert.deepEqual(m.match("s", 0), { id: "archive", shift: false });
	assert.equal(m.match("e", 0), null);
	assert.deepEqual(tidy(rebind(overrides, "archive", ["e"])), { star: [] });
});

test("an override that clashes with a fixed key loses it", () => {
	const bindings = resolveBindings({ archive: ["Escape", "y"] });
	assert.deepEqual(bindings.get("archive"), ["y"]);
	assert.deepEqual(bindings.get("back"), ["Escape", "u"]);
});

test("reserved and unusable keys can't be bound", () => {
	for (const k of ["g", "?", "Escape", "u", "Tab", "Enter", "Alt+e", "E", "nonsense"]) assert.ok(cannotBind(k), k);
	for (const k of ["y", "Shift+y", "Mod+Shift+k", "Delete", "!", "1"]) assert.equal(cannotBind(k), null, k);
	assert.deepEqual(cleanOverrides({ archive: ["y", "y", "g", "q", "w"], help: ["h"] }), { archive: ["y", "q"] });
	assert.deepEqual(cleanOverrides("nope"), {});
});

test("keycaps follow the platform", () => {
	assert.deepEqual(keycaps("Mod+Enter", true), ["⌘", "↵"]);
	assert.deepEqual(keycaps("Mod+Enter", false), ["Ctrl", "↵"]);
	assert.deepEqual(keycaps("g i", true), ["G", "I"]);
	assert.deepEqual(keycaps("Shift+x", true), ["⇧", "X"]);
	assert.equal(keyText("Mod+k", true), "⌘K");
	assert.equal(keyText("Mod+k", false), "Ctrl+K");
	assert.equal(keyText("g i", false), "G I");
});


test("every shortcut has a place on the map, and toolbar keys a group", () => {
	const areas = new Set(["search", "go", "list", "toolbar", "agent", "composer", "more"]);
	for (const s of SHORTCUTS) {
		assert.ok(areas.has(s.area), `${s.id}: area`);
		if (s.area === "toolbar") assert.ok(Number.isInteger(s.cluster), `${s.id}: cluster`);
	}
});

test("loose key text becomes a binding", () => {
	assert.equal(parseBinding("E"), "e");
	assert.equal(parseBinding("shift+x"), "Shift+x");
	assert.equal(parseBinding("Cmd+K"), "Mod+k");
	assert.equal(parseBinding("ctrl-shift-k"), "Mod+Shift+k");
	assert.equal(parseBinding("⌘↵"), "Mod+Enter");
	assert.equal(parseBinding("⌘⇧K"), "Mod+Shift+k");
	assert.equal(parseBinding("down"), "ArrowDown");
	assert.equal(parseBinding("#"), "#");
	assert.equal(parseBinding("g then i"), "g i");
	assert.equal(parseBinding("hyper+k"), null);
	assert.equal(parseBinding("a b c"), null);
});

test("shortcuts are found by id or label", () => {
	assert.equal(findShortcut("replyAll").id, "replyAll");
	assert.equal(findShortcut("Reply all").id, "replyAll");
	assert.equal(findShortcut("reply-all").id, "replyAll");
	assert.equal(findShortcut("nope"), null);
});

test("setShortcut rebinds, reports what it took, and refuses what it must", () => {
	const r = setShortcut({}, "archive", ["S"]);
	assert.equal(r.ok, true);
	assert.deepEqual(r.overrides, { archive: ["s"], star: [] });
	assert.deepEqual(r.takenFrom, [{ id: "star", label: "Star or unstar", keys: ["s"] }]);
	assert.deepEqual(setShortcut(r.overrides, "star", null).overrides, { archive: [] });
	assert.deepEqual(setShortcut({}, "archive", []).overrides, { archive: [] });
	assert.match(setShortcut({}, "help", ["h"]).error, /fixed/);
	assert.match(setShortcut({}, "archive", ["g"]).error, /Go to/);
	assert.match(setShortcut({}, "archive", ["hyper+q"]).error, /Can't read/);
	assert.match(setShortcut({}, "nope", ["q"]).error, /Unknown shortcut/);
	const list = describeShortcuts(r.overrides);
	assert.deepEqual(list.find((s) => s.id === "archive"), { id: "archive", label: "Archive", group: "Conversation", scope: "mail", keys: ["s"], defaultKeys: ["e"], rebindable: true });
});

test("keys the browser keeps can't be bound", () => {
	for (const k of ["Mod+t", "Mod+w", "Mod+r", "Mod+c", "Mod+Shift+t", "Mod+1", "Mod+Tab"]) assert.match(cannotBind(k), /browser/, k);
	assert.equal(cannotBind("Mod+e"), null);
	assert.match(setShortcut({}, "archive", ["cmd+t"]).error, /belongs to the browser/);
});

test("a change made elsewhere is described for the toast", () => {
	const after = setShortcut({}, "archive", ["y"]).overrides;
	assert.deepEqual(describeChanges({}, after, true), ["Archive is now Y"]);
	assert.deepEqual(describeChanges({}, setShortcut({}, "archive", ["s"]).overrides, true), ["Archive is now S", "Star or unstar is off"]);
	assert.deepEqual(describeChanges(after, after, true), []);
	assert.deepEqual(describeChanges({}, { search: ["Mod+e"] }, false), ["Search is now Ctrl+E"]);
});

test("` and ~ step through Inbox, Unread, Starred and Drafts", () => {
	assert.equal(stepOf({ key: "`" }), "`");
	assert.equal(stepOf({ key: "~", shiftKey: true }), "~");
	const m = new KeyMatcher(resolveBindings());
	assert.deepEqual(m.match("`", 0), { id: "nextView", shift: false });
	assert.deepEqual(m.match("~", 0), { id: "prevView", shift: false });
	assert.deepEqual(["inbox", "unread", "starred", "drafts"].map((v) => cycleView(v, 1)), ["unread", "starred", "drafts", "inbox"]);
	assert.equal(cycleView("inbox", -1), "drafts");
	assert.equal(cycleView("sent", 1), "inbox");
	assert.equal(cycleView("sent", -1), "drafts");
});
