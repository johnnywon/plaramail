import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const { consoleTabFrom, CONSOLE_TABS } = await loadTs("app/components/postal/console-tabs.ts");

const from = (query) => consoleTabFrom(new URLSearchParams(query));

test("?console= names a tab", () => {
	for (const tab of CONSOLE_TABS) assert.equal(from(`console=${tab}`), tab);
	assert.equal(from(""), null);
	assert.equal(from("console="), null);
});

test("the page's own name and its usual words open Preferences (#49)", () => {
	for (const name of ["preferences", "settings", "prefs", "Preferences"]) assert.equal(from(`console=${name}`), "general", name);
	assert.equal(from("settings=preferences"), "general");
});

test("an unknown page opens Overview instead of closing the console (#49)", () => {
	assert.equal(from("console=nope"), "home");
	assert.equal(from("settings=nope"), "home");
});

test("old ?settings= links and 0.7 console tabs open the same place", () => {
	assert.equal(from("settings=general"), "general");
	assert.equal(from("settings=agent"), "mailroom");
	assert.equal(from("settings=index"), "storage");
	assert.equal(from("settings=activity"), "logs");
	assert.equal(from("console=overview"), "home");
	assert.equal(from("console=drafting"), "mailroom");
	assert.equal(from("console=model"), "models");
	assert.equal(from("console=connections"), "mcp");
	assert.equal(from("console=tools"), "mcp");
	assert.equal(from("console=limits&settings=general"), "mailroom");
});

test("names of built-in object properties don't open an empty console (WON-245)", () => {
	for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
		assert.equal(from(`console=${name}`), "home");
		assert.equal(from(`settings=${name}`), "home");
	}
});
