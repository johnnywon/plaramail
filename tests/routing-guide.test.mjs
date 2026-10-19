import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-228: Console > Addresses shows how to start receiving at an address with no mail yet.

const { receivedCount, ROUTING_URL } = await loadTs("app/components/postal/routing-guide.ts");

const status = {
	messages: 5, bytes: 0,
	mailboxes: [
		{ mailboxId: "hello@example.com", states: { inbox: 2, archive: 1 }, unread: 0, starred: 0, total: 3, inboxConversations: 2 },
		{ mailboxId: "Ops@example.net", states: { sent: 1, draft: 1 }, unread: 0, starred: 0, total: 2, inboxConversations: 0 },
	],
};

test("an address counts as receiving once anything outside Sent and Drafts is there", () => {
	assert.equal(receivedCount(status, "hello@example.com"), 3);
	assert.equal(receivedCount(status, "ops@example.net"), 0, "only sent mail and a draft");
	assert.equal(receivedCount(status, "new@example.org"), 0, "no mailbox yet");
	assert.equal(receivedCount(undefined, "hello@example.com"), null, "unknown until the counts load");
});

test("the guide links Email Routing, recommends a catch-all rule and gives the sending command", () => {
	assert.match(ROUTING_URL, /^https:\/\/dash\.cloudflare\.com\/\?to=\/:account\/:zone\/email\/routing\/routes$/);
	const modals = readFileSync(new URL("../app/components/postal/Modals.tsx", import.meta.url), "utf8");
	assert.match(modals, /const silent = receivedCount\(storage\.data, a\) === 0;/);
	assert.match(modals, /\{silent && \(\n\t*<Note tone="warn">/);
	assert.match(modals, /catch-all rule/);
	assert.match(modals, /npx wrangler email sending enable \{identity\.domain\}/);
});
