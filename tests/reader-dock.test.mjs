// The message view on a phone (WON-679): Back, Archive, Trash and More on top, Reply in a dock
// at the bottom, and More as a sheet. Source checks, like tests/mobile-composer.test.mjs.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const reader = read("app/components/postal/Reader.tsx");
const css = read("app/components/postal/postal.css");

test("on a phone the top bar keeps Archive, Trash and More, and the rest moves", () => {
	const bar = reader.slice(reader.indexOf('className="pg-reader-bar"'), reader.indexOf("{more && ("));
	assert.match(bar, /\{!phone && \(\n\t+<div className="pg-group">\n\t+<button type="button" className="pg-icon-btn" title=\{tip\("reply"/);
	assert.match(bar, /\{!phone && \(\n\t+<div className="pg-group" style=\{\{ position: "relative" \}\}>/);
	assert.match(bar, /aria-label="Archive"/);
	assert.match(bar, /aria-label="Move to Trash"/);
	assert.match(bar, /aria-label="More"\n\t+aria-haspopup="menu"/);
	// Unsubscribe, Block, Report spam and View source live only in More now.
	for (const name of ["Unsubscribe", "Block sender", "Report spam", "View source"]) assert.doesNotMatch(bar, new RegExp(`aria-label="${name}"`), name);
	assert.match(reader, /className="pg-icon-btn pg-subject-star"/);
});

test("Reply sits in a dock at the bottom, and the reply bar steps aside", () => {
	assert.match(reader, /const dock = phone && !props\.inline && !!original;/);
	const dock = reader.slice(reader.indexOf('className="pg-reader-dock"'), reader.indexOf("{source && <SourceModal"));
	assert.match(dock, /draft \? \(\n\t+<button type="button" className="pg-dock-reply" onClick=\{\(\) => props\.onEditDraft\(draft\)\}>/);
	assert.match(dock, /aria-label="Reply all"/);
	assert.match(dock, /aria-label="Forward"/);
	assert.match(dock, /<AgentKey open=\{false\} busy=\{false\} label="Draft reply"/);
	assert.match(css, /\.pg-reader\[data-dock\] \.pg-reply-bar \{ display: none; \}/);
	assert.match(css, /\.pg-reader-dock \{ position: absolute;[^}]*backdrop-filter: blur\(20px\)[^}]*animation: pg-dock-in var\(--pg-side-ms\) var\(--pg-side-ease\);/);
});

test("More is a menu, a sheet on a phone, and Escape closes it before the mail shortcuts see it", () => {
	assert.match(reader, /className="pg-popover pg-msgmenu"\n\t+role="menu"/);
	const items = reader.slice(reader.indexOf('className="pg-popover pg-msgmenu"'), reader.indexOf('className="pg-reader-dock"'));
	assert.equal((items.match(/role="menuitem"/g) ?? []).length, 8);
	assert.match(reader, /document\.addEventListener\("keydown", onKey, true\);/);
	assert.match(reader, /if \(e\.key !== "Escape"\) return;\n\t+e\.preventDefault\(\);/);
	assert.match(reader, /const MORE_OUT_MS = 200;/);
	assert.match(css, /\.pg-msgmenu \{ position: fixed; z-index: 50; left: 0; right: 0; bottom: 0;[^}]*animation: pg-sheet-in var\(--pg-side-ms\)/);
	assert.match(css, /\.pg-msgmenu\[data-leaving\] \{ animation: pg-sheet-out \.2s/);
	// Its own class: .pg-more is the list's load-more sentinel.
	assert.doesNotMatch(reader, /pg-more\b/);
});

test("on a touch tablet the toolbar stays one row", () => {
	assert.match(css, /\.pg-reader-bar \.pg-group \.pg-icon-btn \{ min-width: 40px; \}/);
});
