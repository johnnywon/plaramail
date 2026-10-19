import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// The name line of a list row (#34): who a row is from, or for sent mail, who it went to.

const { rowSender } = await loadTs("app/components/postal/row-sender.ts");

const base = { state: "inbox", sender_name: "Ann", sender_addr: "ann@example.org", recipient: "me@example.com" };

test("received mail shows the sender's name, or address", () => {
	assert.deepEqual(rowSender(base), { text: "Ann" });
	assert.deepEqual(rowSender({ ...base, sender_name: "" }), { text: "ann@example.org" });
});

test("sent mail shows To and the first recipient, with a count of the rest", () => {
	const sent = { ...base, state: "sent", sender_name: "me", sender_addr: "me@example.com" };
	assert.deepEqual(rowSender({ ...sent, recipient: "bob@example.org" }), { to: true, text: "bob@example.org" });
	assert.deepEqual(rowSender({ ...sent, recipient: "Bob Ray <bob@example.org>, cy@example.net, di@example.net" }), { to: true, text: "Bob Ray", more: 2 });
	assert.deepEqual(rowSender({ ...sent, recipient: "" }), { to: true, text: "(no recipient)" });
});

test("a draft says Draft", () => {
	assert.deepEqual(rowSender({ ...base, state: "draft" }), { text: "Draft" });
});
