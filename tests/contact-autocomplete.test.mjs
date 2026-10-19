import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { A, B, DB, guarded } from "./helpers/search-fixture.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-216: the composer suggests people you wrote to and people who wrote to you.

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const sg = await loadTs("workers/lib/search-suggest-sql.ts");
const contacts = (q, exclude = [A, B]) => idx.runSync(sg.contactsQuery(q, exclude), guarded(DB.exec));

test("a sent message counts twice a received conversation, and names come from received mail", () => {
	assert.deepEqual(contacts("ann"), [{ value: "ann@example.org", name: "Ann Lee", count: 4 }]);
	assert.deepEqual(contacts("lee").map((c) => c.value), ["ann@example.org"], "by a word of the name");
	assert.deepEqual(contacts("bil").map((c) => `${c.value}:${c.count}`), ["billing@example.net:1"]);
});

test("Trash, Spam, your own addresses and cc'd strangers stay out", () => {
	assert.deepEqual(contacts("spam"), [], "only sender in Trash");
	assert.deepEqual(contacts("a@"), [], "your own address");
	assert.deepEqual(contacts("boss"), [], "cc'd on received mail, never written to");
	assert.deepEqual(contacts("a", []).some((c) => c.value === A), false, "your address never sent you mail");
});

test("nothing until a letter or digit is typed", () => {
	assert.deepEqual(contacts(""), []);
	assert.deepEqual(contacts("  @ "), []);
});

test("the recipient field is a combobox over GET /api/v1/contacts", () => {
	const win = readFileSync(new URL("../app/components/postal/ComposeWindow.tsx", import.meta.url), "utf8");
	assert.match(win, /queryFn: \(\{ signal \}\) => api\.contacts\(query, \{ signal \}\)/);
	assert.match(win, /role="combobox"/);
	assert.match(win, /role="listbox" aria-label=\{`Suggestions for \$\{label\}`\}/);
	assert.match(win, /type="button" role="option"/);
	assert.doesNotMatch(win, /TODO\(roadmap\): contact autocomplete/);
	const worker = readFileSync(new URL("../workers/index.ts", import.meta.url), "utf8");
	assert.match(worker, /app\.get\("\/api\/v1\/contacts"/);
	assert.match(worker, /const own = \[\.\.\.configuredAddresses\(c\.env\), /, "configured addresses with no mailbox yet are yours too");
});
