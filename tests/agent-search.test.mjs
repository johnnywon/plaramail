import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { addMessages, d1Db, row } from "./helpers/d1-mail.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const bulk = await loadTs("workers/lib/mail-bulk-sql.ts");
const tools = await loadTs("workers/lib/tools.ts");

const labels = [{ id: "receipts", name: "Receipts", color: "#000", count: 0, auto: false }];

test("a search spans every address unless it names one", () => {
	const { exec } = d1Db();
	const msg = (id, fields) => row(id, { sender_addr: "billing@example.org", sender_name: "Billing", sender_domain: "example.org", recipients: "a@example.com", subject: "Your receipt", subject_norm: "your receipt", ...fields });
	addMessages(exec, "a@example.com", [msg("e1"), msg("e2", { sender_addr: "ann@example.net", sender_domain: "example.net", date: "2026-10-08T10:00:00.000Z" })]);
	addMessages(exec, "b@example.net", [msg("e3", { state: "archive", date: "2026-10-10T10:00:00.000Z" })]);
	const matching = (filter, limit) => idx.runSync(bulk.matchingThreadKeysQuery(filter, limit), exec);

	const all = tools.mailSearchFilter({ from: ["example.org"] }, labels);
	assert.deepEqual(matching(all.filter, 10).length, 2, "both addresses, inbox and archive");
	const one = tools.mailSearchFilter({ from: ["example.org"], to: ["b@example.net"] }, labels);
	assert.equal(matching(one.filter, 10).length, 1);
	assert.equal(matching(all.filter, 1).length, 1, "limit holds");
});

test("the search filter refuses unknown labels, folders and an empty search", () => {
	assert.match(tools.mailSearchFilter({ label: ["Nope"] }, labels).error, /Unknown label/);
	assert.match(tools.mailSearchFilter({ folder: "elsewhere", query: "x" }, labels).error, /Unknown folder/);
	assert.match(tools.mailSearchFilter({}, labels).error, /at least one/);
	assert.deepEqual(tools.mailSearchFilter({ label: ["receipts"], unread: false }, labels).filter.label, ["receipts"]);
	assert.deepEqual(tools.mailSearchFilter({ unread: false, query: "x" }, labels).filter.is, ["read"]);
});

test("label_matching labels every match, and refuses too many", async () => {
	const d1 = await openD1();
	d1.exec(`INSERT INTO labels (id, name, color) VALUES ('receipts', 'Receipts', '#000')`);
	const billing = (id) => row(id, { sender_addr: "billing@example.org", sender_domain: "example.org", conversation_id: id });
	addMessages(d1.exec, "a@example.com", [billing("e1"), billing("e2"), row("e3", { sender_addr: "ann@example.net", sender_domain: "example.net" })]);
	const env = { BUCKET: {}, DB: d1.DB };
	const labeled = () => d1.exec(`SELECT m.email_id FROM message_labels JOIN messages m ON m.id = message ORDER BY m.email_id`).map((r) => r.email_id);

	const done = await tools.toolLabelMatching(env, { from: ["example.org"] }, { add: ["Receipts"] });
	assert.deepEqual(done, { status: "updated", conversations: 2, changes: ["added Receipts"] });
	assert.deepEqual(labeled(), ["e1", "e2"]);

	const many = Array.from({ length: tools.LABEL_MATCHING_MAX + 1 }, (_, i) => billing(`m${i}`));
	addMessages(d1.exec, "b@example.net", many);
	d1.exec(`DELETE FROM message_labels`);
	assert.match((await tools.toolLabelMatching(env, { from: ["example.org"] }, { add: ["Receipts"] })).error, /More than/);
	assert.deepEqual(labeled(), [], "nothing applied when there are too many");
	assert.match((await tools.toolLabelMatching(env, { from: ["example.org"] }, {})).error, /which labels/);
});
