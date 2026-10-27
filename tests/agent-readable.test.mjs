// Browser agents (Aside, gstack browse, Playwright, Claude in Chrome) and screen readers read the
// accessibility tree, not the pixels. These checks keep the mail view readable there.
//
// What they pin down, each found by snapshotting the app in Aside and gstack browse:
//   - A div with role="button" hides its text from Playwright's snapshot and can't hold real buttons.
//   - An accessible name like "Sender: Subject" is YAML-quoted in Playwright's aria snapshot, and
//     gstack browse drops the element. Subjects keep their colons; names the app writes don't add one.
//   - Views and conversations are links, so an agent sees where each one goes and can open it by URL.
//   - Text-only mail is part of the page. Sender HTML stays in the sandboxed frame, which some agents
//     can't see into.
//   - Agent chat says who said each turn.
//   - Aside's snapshot shows checked and selected but not pressed, current or expanded. A choice of one is a
//     radio group and a row's Select is a checkbox, so agents see which is on.
//   - Aside leaves out elements with opacity 0. With a mouse, the row toolbar waits for hover with nothing drawn,
//     not transparent, and keeps Select in the tree so an agent can select a row without hovering it.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function tsx(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return tsx(path);
		return path.endsWith(".tsx") ? [path] : [];
	});
}

const read = (path) => readFileSync(path, "utf8");

test("clickable things are buttons or links, never an element with role=button", () => {
	for (const file of tsx("app")) assert.doesNotMatch(read(file), /role="button"/, file);
});

test("accessible names the app writes never join parts with a colon", () => {
	for (const file of tsx("app")) {
		const source = read(file);
		for (const [, literal] of source.matchAll(/aria-label="([^"]*)"/g)) assert.doesNotMatch(literal, /: /, `${file}: aria-label="${literal}"`);
		for (const [, template] of source.matchAll(/aria-label=\{`([^`]*)`\}/g)) {
			const text = template.replace(/\$\{[^}]*\}/g, "x");
			assert.doesNotMatch(text, /: /, `${file}: aria-label={\`${template}\`}`);
		}
	}
});

test("each conversation in the list is a list item with a link to it", () => {
	const source = read("app/components/postal/ListPane.tsx");
	assert.match(source, /role="list"/);
	assert.match(source, /role="listitem"/);
	assert.match(source, /<a\s[^>]*className="pg-row-link"[^>]*href=\{/s);
});

test("sidebar views are links to their URL", () => {
	const source = read("app/components/postal/Sidebar.tsx");
	assert.match(source, /<a\s/);
	assert.match(source, /href: toSearch\(next\)/);
	assert.doesNotMatch(source, /onClick=\{\(\) => go\(/, "a view opened by a button has no URL for an agent to read");
});

test("text-only mail is on the page, and sender HTML stays in the sandboxed frame", () => {
	const reader = read("app/components/postal/Reader.tsx");
	assert.match(reader, /isHtmlBody\(raw\)/);
	assert.match(reader, /<MailText\b/);
	const frame = read("app/components/EmailIframe.tsx");
	assert.match(frame, /export function MailText/);
	const sandbox = frame.match(/\ssandbox="([^"]*)"/)?.[1];
	assert.equal(sandbox, "allow-scripts allow-popups allow-popups-to-escape-sandbox");
});

test("the letterhead names who sent it and when", () => {
	const source = read("app/components/postal/Reader.tsx");
	assert.match(source, /<span className="pg-sr">From<\/span>/);
	assert.match(source, /<span className="pg-sr">\{sent \? "Sent" : "Received"\}<\/span>/);
});

test("agent chat is a log that says who said each turn", () => {
	const source = read("app/components/postal/Agent.tsx");
	assert.match(source, /role="log"/);
	assert.match(source, /role="article" aria-label="You"/);
	assert.match(source, /role="article" aria-label="Agent"/);
});

test("a choice of one is a radio group, so agents see which option is on", () => {
	const groups = {
		"app/components/postal/Segmented.tsx": 1,
		"app/components/postal/ListPane.tsx": 2,
		// Reply mode, and on the phone's cards the agent's tone and Send later's when, day and time.
		"app/components/postal/ComposeWindow.tsx": 5,
		"app/components/postal/ModelTab.tsx": 3,
	};
	for (const [file, count] of Object.entries(groups)) {
		const source = read(file);
		assert.equal(source.match(/role="radiogroup"/g)?.length ?? 0, count, file);
		assert.match(source, /role="radio" aria-checked=\{/, file);
	}
	assert.doesNotMatch(read("app/components/postal/postal.css"), /\.pg-(segmented|flt-dates|modes|prov-filter)[^{]*aria-pressed/);
});

test("a row's Select is a checkbox that stays in the accessibility tree without hover", () => {
	const list = read("app/components/postal/ListPane.tsx");
	assert.equal(list.match(/aria-label="Select" role="checkbox" aria-checked=\{checked\}/g)?.length, 2);
	assert.match(list, /className="pg-row-checkonly" aria-hidden=\{canHover \|\| undefined\}/);
	const css = read("app/components/postal/postal.css");
	const hover = css.match(/@media \(hover: hover\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
	assert.match(hover, /\.pg-row-tools \{ display: flex; \}/);
	assert.match(hover, /\.pg-row-tools > :not\(:first-child\)/);
	assert.doesNotMatch(hover, /pg-row-tools[^{]*\{[^}]*opacity: 0/, "Aside drops transparent elements");
});

test("the Filter button's name says how many filters are on", () => {
	assert.match(read("app/components/postal/ListPane.tsx"), /aria-label=\{nFilters \? `Filter, \$\{nFilters\} on` : "Filter"\}/);
});

test("SearchWindow suggestions and filter menu items name their parts with commas", () => {
	const search = read("app/components/postal/SearchWindow.tsx");
	assert.match(search, /role="option"\n\t+aria-label=\{rowLabel\(row\)\}/);
	assert.match(search, /\.join\(", "\)/);
	const list = read("app/components/postal/ListPane.tsx");
	assert.equal((list.match(/role="menuitemcheckbox" aria-checked=\{on\} aria-label=/g) ?? []).length, 2);
});

test("a list row's buttons say what they act on, so a bare Cancel isn't one of many (#41)", () => {
	const list = read("app/components/postal/ListPane.tsx");
	assert.match(list, /<button type="button" aria-label="Cancel scheduled send" onClick=\{\(\) => props\.onCancelScheduled\(sched\)\}>Cancel<\/button>/);
	assert.doesNotMatch(list, /<button type="button" onClick=[^>]*>\w+<\/button>/, "a text-only row button without a name");
});
