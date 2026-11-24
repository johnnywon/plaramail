import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-533: an MCP grant reaches only the addresses chosen on the consent page or narrowed in Console > MCP.

const grants = await loadTs("workers/mcp/grants.ts");
const { narrowProps, sessionOwner } = await loadTs("workers/mcp/session.ts");

test("the consent form keeps only the deployment's addresses, lowercased and once each", () => {
	const form = new FormData();
	for (const a of ["B@example.com", "a@example.com", "b@example.com", "stranger@example.net"]) form.append("address", a);
	assert.deepEqual(grants.chosenAddresses(form, ["a@example.com", "b@example.com", "c@example.com"]), ["a@example.com", "b@example.com"]);
	assert.deepEqual(grants.chosenAddresses(new FormData(), ["a@example.com"]), []);
});

test("a grant from before address limits reaches every address", () => {
	assert.equal(grants.effectiveAddresses(undefined, undefined), null);
});

test("a grant reaches what was consented, narrowed by what Console stored, never more", () => {
	assert.deepEqual(grants.effectiveAddresses(["a@example.com", "b@example.com"], undefined), ["a@example.com", "b@example.com"]);
	assert.deepEqual(grants.effectiveAddresses(["a@example.com", "b@example.com"], ["b@example.com"]), ["b@example.com"]);
	assert.deepEqual(grants.effectiveAddresses(["a@example.com"], ["a@example.com", "b@example.com"]), ["a@example.com"], "a stored list can't widen the consent");
	assert.deepEqual(grants.effectiveAddresses(undefined, ["b@example.com"]), ["b@example.com"], "an older grant narrowed in Console");
});

test("the grant id is read from a bearer token", () => {
	assert.equal(grants.grantIdFromAuthorization("Bearer owner%40example.com:g123:secret"), "g123");
	assert.equal(grants.grantIdFromAuthorization("Bearer nonsense"), null);
	assert.equal(grants.grantIdFromAuthorization(null), null);
});

test("grantAddresses reads Console's narrowing from D1 at call time", async () => {
	const d1 = await openD1();
	const props = { userId: "owner@example.com", clientId: "c1", clientName: "App", scopes: ["mail"], grantId: "g1", addresses: ["a@example.com", "b@example.com"] };
	assert.deepEqual(await grants.grantAddresses(d1.sql, props), ["a@example.com", "b@example.com"]);
	await grants.storeAddresses(d1.sql, "g1", ["a@example.com"]);
	assert.deepEqual(await grants.grantAddresses(d1.sql, props), ["a@example.com"]);
	assert.equal(await grants.grantAddresses(d1.sql, { ...props, addresses: undefined, grantId: "g2" }), null);
	await grants.forgetAddresses(d1.sql, "g1");
	assert.deepEqual(await grants.grantAddresses(d1.sql, props), ["a@example.com", "b@example.com"]);
});

test("Console can narrow a grant to a non-empty subset, and can't widen it", () => {
	const current = ["a@example.com", "b@example.com"];
	assert.deepEqual(grants.narrowTo(current, ["B@example.com"]), { addresses: ["b@example.com"] });
	assert.ok("error" in grants.narrowTo(current, []));
	assert.ok("error" in grants.narrowTo(current, ["c@example.com"]));
	assert.ok("error" in grants.narrowTo(current, "a@example.com"));
});

test("every token carries its grant id, and a session belongs to one grant", () => {
	const props = { userId: "u", clientId: "c", clientName: "App", scopes: ["mail", "mail.send"], addresses: ["a@example.com"] };
	const same = narrowProps({ props, requestedScope: ["mail", "mail.send"], grantId: "g1" });
	assert.equal(same.accessTokenProps.grantId, "g1");
	assert.deepEqual(same.accessTokenProps.scopes, ["mail", "mail.send"]);
	const narrowed = narrowProps({ props, requestedScope: ["mail"], grantId: "g1" });
	assert.deepEqual(narrowed.accessTokenProps.scopes, ["mail"]);
	assert.notEqual(sessionOwner({ ...props, grantId: "g1" }), sessionOwner({ ...props, grantId: "g2" }));
});

test("label tools on a narrowed grant: counts cover its addresses, and a label on other mail can't be renamed or deleted", async () => {
	const d1 = await openD1();
	await d1.addMailboxes("a@example.com", "b@example.com");
	const now = new Date().toISOString();
	const add = (mailbox, id) => d1.exec(
		`INSERT INTO messages (mailbox_id, email_id, folder_id, subject, sender_addr, recipient, date, thread_id, conversation_id) VALUES (?, ?, 'inbox', 's', 'x@example.org', ?, ?, ?, ?)`,
		mailbox, id, mailbox, now, id, id,
	);
	add("a@example.com", "a1");
	add("b@example.com", "b1");
	d1.exec(`INSERT INTO labels (id, name, color) VALUES ('l1', 'Shared', '#888'), ('l2', 'Mine', '#888')`);
	const idOf = (email) => d1.exec(`SELECT id FROM messages WHERE email_id = ?`, email)[0].id;
	d1.exec(`INSERT INTO message_labels (message, label_id) VALUES (?, 'l1'), (?, 'l1'), (?, 'l2')`, idOf("a1"), idOf("b1"), idOf("a1"));
	assert.deepEqual(Object.fromEntries(await grants.labelCounts(d1.sql, ["a@example.com"])), { l1: 1, l2: 1 });
	assert.equal(await grants.labelOutside(d1.sql, "l1", ["a@example.com"]), true);
	assert.equal(await grants.labelOutside(d1.sql, "l2", ["a@example.com"]), false);
});

test("Console shows a grant's addresses from its metadata and any narrowing", () => {
	const all = ["a@example.com", "b@example.com"];
	assert.deepEqual(grants.shownAddresses({ clientName: "Old" }, undefined, all), { addresses: all, every: true });
	assert.deepEqual(grants.shownAddresses({ clientName: "New", addresses: ["b@example.com"] }, undefined, all), { addresses: ["b@example.com"], every: false });
	assert.deepEqual(grants.shownAddresses({ clientName: "Old" }, ["a@example.com"], all), { addresses: ["a@example.com"], every: false });
	assert.deepEqual(grants.shownAddresses({ addresses: all }, ["a@example.com"], all), { addresses: ["a@example.com"], every: false });
});
