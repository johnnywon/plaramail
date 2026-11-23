import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { addMessages, d1Db, row } from "./helpers/d1-mail.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

const idx = await loadTs("workers/lib/mail-index-sql.ts");
const bulk = await loadTs("workers/lib/mail-bulk-sql.ts");
const tools = await loadTs("workers/lib/tools.ts");

const A = "a@example.com";

test("listLabels reports auto once an agent has applied a label", () => {
	const { exec } = d1Db();
	const run = (query) => idx.runSync(query, exec);
	run(bulk.createLabelQuery({ name: "Receipts" }));
	run(bulk.createLabelQuery({ name: "Travel" }));
	assert.deepEqual(run(bulk.listLabelsQuery()).map((l) => [l.id, l.auto]), [["receipts", false], ["travel", false]]);

	assert.deepEqual(run(bulk.markLabelsAutoQuery(["travel", "travel", "missing"], "2026-10-11T12:00:00.000Z")), ["travel"]);
	assert.deepEqual(run(bulk.markLabelsAutoQuery(["travel"], "2026-10-11T13:00:00.000Z")), [], "already flagged");
	assert.equal(exec(`SELECT applied_at FROM label_auto WHERE label_id = 'travel'`)[0].applied_at, "2026-10-11T13:00:00.000Z");
	assert.deepEqual(run(bulk.listLabelsQuery()).map((l) => [l.id, l.auto]), [["receipts", false], ["travel", true]]);
});

test("the auto flag goes with the label", () => {
	const { exec } = d1Db();
	const run = (query) => idx.runSync(query, exec);
	run(bulk.createLabelQuery({ name: "Travel" }));
	run(bulk.markLabelsAutoQuery(["travel"]));
	assert.equal(run(bulk.deleteLabelRowsQuery("travel")), true);
	assert.equal(exec(`SELECT COUNT(*) AS n FROM label_auto`)[0].n, 0);
});

/** D1 with one message in A and the given labels. `fail` makes label removals throw, as a failing mailbox would. */
async function labelEnv(labels = []) {
	const d1 = await openD1();
	let fail = false;
	const DB = {
		prepare: (text) => {
			if (fail && /DELETE FROM message_labels/.test(text)) throw new Error("down");
			return d1.DB.prepare(text);
		},
		batch: (list) => d1.DB.batch(list),
	};
	for (const [i, name] of labels.entries()) d1.exec(`INSERT INTO labels (id, name, color, position) VALUES (?, ?, '#000', ?)`, name.toLowerCase(), name, i);
	addMessages(d1.exec, A, [row("e1")]);
	return {
		env: { DB, BUCKET: {} },
		exec: d1.exec,
		failRemovals: () => { fail = true; },
		labelsOn: (emailId) => d1.exec(`SELECT label_id FROM message_labels JOIN messages m ON m.id = message WHERE m.email_id = ? ORDER BY label_id`, emailId).map((r) => r.label_id),
		auto: () => d1.exec(`SELECT label_id FROM label_auto ORDER BY label_id`).map((r) => r.label_id),
	};
}

test("toolLabelConversation flags every label it adds, not the ones it removes", async () => {
	const fx = await labelEnv(["Travel", "Receipts"]);
	const result = await tools.toolLabelConversation(fx.env, A, "e1", { add: ["Travel"], remove: ["receipts"] });
	assert.equal(result.status, "updated");
	assert.deepEqual(result.changes, ["added Travel", "removed Receipts"]);
	assert.deepEqual(fx.labelsOn("e1"), ["travel"]);
	assert.deepEqual(fx.auto(), ["travel"]);

	await tools.toolLabelConversation(fx.env, A, "e1", { add: ["Receipts"] });
	await tools.toolLabelConversation(fx.env, A, "e1", { remove: ["receipts"] });
	assert.deepEqual(fx.auto(), ["receipts", "travel"]);
	fx.exec(`DELETE FROM label_auto WHERE label_id = 'travel'`);
	await tools.toolLabelConversation(fx.env, A, "e1", { remove: ["travel"] });
	assert.deepEqual(fx.auto(), ["receipts"], "a removal flags nothing");

	const unknown = await tools.toolLabelConversation(fx.env, A, "e1", { add: ["Nope"] });
	assert.match(unknown.error, /Unknown label/);
	assert.match((await tools.toolLabelConversation(fx.env, A, "missing", { add: ["Travel"] })).error, /not found/);
});

test("toolCreateLabel creates a label once and returns the existing one after", async () => {
	const fx = await labelEnv(["Travel"]);
	const first = await tools.toolCreateLabel(fx.env, { name: " Receipts " });
	assert.equal(first.status, "created");
	assert.equal(first.label.name, "Receipts");
	assert.match(first.label.color, /^#/, "a palette colour is picked");

	const again = await tools.toolCreateLabel(fx.env, { name: "receipts" });
	assert.equal(again.status, "exists");
	assert.equal(again.label.id, "receipts");
	assert.equal(fx.exec(`SELECT COUNT(*) AS n FROM labels`)[0].n, 2, "no duplicate");
});

test("toolCreateLabel passes on the store's refusal", async () => {
	const fx = await labelEnv();
	assert.deepEqual(await tools.toolCreateLabel(fx.env, { name: "x", color: "chartreuse" }), { error: "Pick a colour from the palette" });
});

test("toolRenameLabel finds the label by name or id and renames it", async () => {
	const fx = await labelEnv(["Receipts"]);
	const result = await tools.toolRenameLabel(fx.env, { label: "RECEIPTS", name: " Invoices " });
	assert.deepEqual(result, { status: "renamed", from: "Receipts", label: { id: "receipts", name: "Invoices" } });
	assert.match((await tools.toolRenameLabel(fx.env, { label: "nope", name: "x" })).error, /Unknown label/);
});

test("toolRenameLabel passes on the store's refusal", async () => {
	const fx = await labelEnv(["A", "B"]);
	assert.deepEqual(await tools.toolRenameLabel(fx.env, { label: "a", name: "B" }), { error: 'A label named "B" exists' });
});

test("toolDeleteLabel deletes by name and reports how many conversations it left", async () => {
	const fx = await labelEnv(["Promo"]);
	await tools.toolLabelConversation(fx.env, A, "e1", { add: ["Promo"] });
	assert.deepEqual(await tools.toolDeleteLabel(fx.env, { label: "promo" }), { status: "deleted", label: "Promo", conversations: 1 });
	assert.deepEqual(fx.labelsOn("e1"), []);
	assert.equal(fx.exec(`SELECT COUNT(*) AS n FROM labels`)[0].n, 0);
	assert.match((await tools.toolDeleteLabel(fx.env, { label: "Travel" })).error, /Unknown label/);
});

test("toolDeleteLabel keeps the label when a mailbox fails", async () => {
	const fx = await labelEnv(["Promo"]);
	await tools.toolLabelConversation(fx.env, A, "e1", { add: ["Promo"] });
	fx.failRemovals();
	const result = await tools.toolDeleteLabel(fx.env, { label: "Promo" });
	assert.match(result.error, /was kept/);
	assert.deepEqual(result.failed, [{ mailboxId: A, error: "down" }]);
	assert.equal(fx.exec(`SELECT COUNT(*) AS n FROM labels`)[0].n, 1);
});
