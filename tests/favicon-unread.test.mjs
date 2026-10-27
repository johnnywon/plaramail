import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-227: the tab shows the unread count in its title and on its icon.

const { badgeText, unreadTitle } = await loadTs("app/lib/unread-tab.ts");

test("the title carries the count in front", () => {
	assert.equal(unreadTitle("PlaraMail", 12), "(12) PlaraMail");
	assert.equal(unreadTitle("(12) PlaraMail", 3), "(3) PlaraMail", "an old count is replaced");
	assert.equal(unreadTitle("(99+) PlaraMail", 0), "PlaraMail", "no unread mail, no count");
});

test("the badge says 99+ past 99", () => {
	assert.equal(badgeText(7), "7");
	assert.equal(badgeText(99), "99");
	assert.equal(badgeText(100), "99+");
});

test("the mail view keeps the tab on the Unread count, and the icon comes from the deployment's own favicon", () => {
	const mail = readFileSync(new URL("../app/components/postal/PostalMail.tsx", import.meta.url), "utf8");
	assert.match(mail, /useUnreadTab\(counts\.unread, title\);/);
	const hook = readFileSync(new URL("../app/lib/unread-tab.ts", import.meta.url), "utf8");
	assert.match(hook, /link\[rel="icon"\]/);
	assert.match(hook, /if \(!n\) restore\(\);/);
});

const { tabTitle } = await loadTs("app/lib/brand.ts");

test("a tab title names where you are, narrowest first, then the app", () => {
	assert.equal(tabTitle("PlaraMail", "Inbox"), "Inbox · PlaraMail");
	assert.equal(tabTitle("PlaraMail", "Your agents", "Console"), "Your agents · Console · PlaraMail");
	assert.equal(tabTitle("PlaraMail", "“invoice”", "Search"), "“invoice” · Search · PlaraMail");
	assert.equal(tabTitle("PlaraMail", "  ", null, undefined), "PlaraMail", "empty places drop out");
	assert.equal(unreadTitle(tabTitle("PlaraMail", "Inbox"), 34), "(34) Inbox · PlaraMail");
});

test("every view sets its title: a console page, the open message, a search, or the view", () => {
	const mail = readFileSync(new URL("../app/components/postal/PostalMail.tsx", import.meta.url), "utf8");
	assert.match(mail, /tabTitle\(appName, CONSOLE_LABELS\[consoleTab\], "Console"\)/);
	assert.match(mail, /tabTitle\(appName, openRow\?\.subject \|\| "Message"\)/);
	assert.match(mail, /tabTitle\(appName, `“\$\{debounced\.trim\(\)\}”`, "Search"\)/);
	assert.match(mail, /tabTitle\(appName, VIEW_LABELS\[filter\.view\] \?\? "Mail"\)/);
	const compose = readFileSync(new URL("../app/components/postal/ComposeWindow.tsx", import.meta.url), "utf8");
	assert.match(compose, /document\.title = tabTitle\(appName, state\.subject\.trim\(\) \|\| "New message"\)/);
	// Nothing else writes document.title.
	for (const f of ["PostalMail.tsx", "Reader.tsx", "Console.tsx", "ListPane.tsx"]) {
		assert.doesNotMatch(readFileSync(new URL(`../app/components/postal/${f}`, import.meta.url), "utf8"), /document\.title =/, f);
	}
});
