import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-227: the tab shows the unread count in its title and on its icon.

const { badgeText, unreadTitle } = await loadTs("app/lib/unread-tab.ts");

test("the title carries the count in front", () => {
	assert.equal(unreadTitle("PluraMail", 12), "(12) PluraMail");
	assert.equal(unreadTitle("(12) PluraMail", 3), "(3) PluraMail", "an old count is replaced");
	assert.equal(unreadTitle("(99+) PluraMail", 0), "PluraMail", "no unread mail, no count");
});

test("the badge says 99+ past 99", () => {
	assert.equal(badgeText(7), "7");
	assert.equal(badgeText(99), "99");
	assert.equal(badgeText(100), "99+");
});

test("the mail view keeps the tab on the Unread count, and the icon comes from the deployment's own favicon", () => {
	const mail = readFileSync(new URL("../app/components/postal/PostalMail.tsx", import.meta.url), "utf8");
	assert.match(mail, /useUnreadTab\(counts\.unread\);/);
	const hook = readFileSync(new URL("../app/lib/unread-tab.ts", import.meta.url), "utf8");
	assert.match(hook, /link\[rel="icon"\]/);
	assert.match(hook, /if \(!n\) restore\(\);/);
});
