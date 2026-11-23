import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

const fi = await loadTs("workers/lib/folder-import.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");

const A = "a@example.com";

test("the dry run merges folders by name, reuses existing labels and totals counts", () => {
	const plan = fi.planFolderImport([
		{ mailboxId: "b@example.org", imported: false, folders: [{ folderId: "receipts", name: "Receipts", count: 3 }] },
		{ mailboxId: "a@example.com", imported: false, folders: [
			{ folderId: "receipts", name: "Receipts", count: 2 },
			{ folderId: "travel", name: "Travel", count: 0 },
			{ folderId: "tax", name: "Tax", count: 5 },
		] },
		{ mailboxId: "c@example.com", imported: false, folders: [] },
	], [{ id: "taxes", name: "tax" }, { id: "travel", name: "Trips" }]);

	assert.deepEqual(plan.totals, { mailboxes: 2, folders: 4, messages: 10 });
	assert.deepEqual(plan.mailboxes.map((m) => m.mailboxId), ["a@example.com", "b@example.org"]);
	assert.deepEqual(plan.labels, [
		{ id: "taxes", name: "tax", exists: true, folders: 1, messages: 5 },
		{ id: "receipts", name: "Receipts", exists: false, folders: 2, messages: 5 },
		{ id: "travel-2", name: "Travel", exists: false, folders: 1, messages: 0 },
	]);
	assert.equal(plan.mailboxes[0].folders.find((f) => f.folderId === "tax").labelId, "taxes");
});

/** One mailbox on D1 with a custom Receipts folder, and the import's real dependencies. */
async function fixture() {
	const d1 = await openD1();
	await d1.addMailboxes(A);
	d1.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, 'receipts', 'Receipts')`, A);
	const backups = [];
	const env = {
		EMAIL_ADDRESSES: [A],
		DB: d1.DB,
		BUCKET: { put: async (key, body) => void backups.push({ key, body: JSON.parse(body) }) },
	};
	let n = 0;
	const mailbox = new D1Mailbox(d1.sql, env.BUCKET, A);
	const add = async (folder) => {
		const id = `e${++n}`;
		await mailbox.createEmail(folder, { id, subject: "s", sender: "x@example.net", recipient: A, date: "2026-10-01T00:00:00Z", body: "", thread_id: id }, []);
		return id;
	};
	let t = Date.parse("2026-10-09T12:00:00Z");
	const deps = { ...fi.importDeps(env), now: () => (t += 1000) };
	const folderOf = (id) => d1.exec(`SELECT folder_id FROM messages WHERE email_id = ?`, id)[0].folder_id;
	const labels = () => d1.exec(`SELECT id, name, color FROM labels ORDER BY position`);
	const imported = () => !!d1.exec(`SELECT folders_imported FROM mailboxes WHERE id = ?`, A)[0].folders_imported;
	return { d1, deps, backups, add, folderOf, labels, imported };
}

test("a run backs up, labels, archives and marks the mailbox; a rerun changes nothing", async () => {
	const fx = await fixture();
	const a = await fx.add("receipts");
	const b = await fx.add("receipts");
	const inbox = await fx.add("inbox");

	const dry = await fi.dryRunFolderImport(fx.deps);
	assert.deepEqual(dry.totals, { mailboxes: 1, folders: 1, messages: 2 });
	assert.equal(fx.backups.length, 0);

	const first = await fi.runFolderImport(fx.deps);
	assert.match(first.backup, /^backups\/folder-import-2026-10-09T12-00-0\d-000Z\.json$/);
	assert.deepEqual(fx.backups[0].body.emails, { [A]: { receipts: [a, b] } });
	assert.deepEqual(fx.labels().map((l) => [l.id, l.name, l.color]), [["receipts", "Receipts", "#c8372d"]]);
	assert.deepEqual(first.results.map((r) => [r.labeled, r.archived]), [[2, 2]]);
	assert.equal(fx.folderOf(a), "archive");
	assert.equal(fx.folderOf(inbox), "inbox");
	assert.equal(fx.imported(), true);

	const second = await fi.runFolderImport(fx.deps);
	assert.deepEqual(second.results.map((r) => [r.labeled, r.archived]), [[0, 0]]);
	assert.equal(fx.labels().length, 1);
	assert.equal(fx.d1.exec(`SELECT COUNT(*) AS n FROM folders WHERE id = 'receipts'`)[0].n, 1, "the folder itself stays");
});

test("mail moved out of the folder before the run is left alone", async () => {
	const fx = await fixture();
	const kept = await fx.add("receipts");
	const moved = await fx.add("receipts");
	fx.d1.exec(`UPDATE messages SET folder_id = 'inbox' WHERE email_id = ?`, moved);
	const result = await fi.runFolderImport(fx.deps);
	assert.deepEqual(result.results.map((r) => [r.labeled, r.archived]), [[1, 1]]);
	assert.equal(fx.folderOf(kept), "archive");
	assert.equal(fx.folderOf(moved), "inbox");
	assert.equal(fx.d1.exec(`SELECT COUNT(*) AS n FROM message_labels JOIN messages m ON m.id = message WHERE m.email_id = ?`, moved)[0].n, 0);
});

test("new labels skip colours that existing labels use", async () => {
	const fx = await fixture();
	await fx.add("receipts");
	fx.d1.exec(`INSERT INTO labels (id, name, color) VALUES ('follow-up', 'Follow up', '#c8372d')`);
	await fi.runFolderImport(fx.deps);
	assert.equal(fx.labels().find((l) => l.id === "receipts").color, "#d9822b");
});

test("after the import, moves into custom folders are refused", async () => {
	const fx = await fixture();
	const id = await fx.add("inbox");
	await fi.runFolderImport(fx.deps);
	const mailbox = new D1Mailbox(fx.d1.sql, {}, A);
	assert.equal(await mailbox.moveEmail(id, "receipts"), false);
	assert.equal(fx.folderOf(id), "inbox");
	assert.equal(await mailbox.moveEmail(id, "archive"), true);
});
