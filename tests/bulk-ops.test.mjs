import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Planned bulk ops applied on D1 (workers/store/d1/ops.ts), and the folder
// counts the import's dry run reads.

const { applyOps } = await loadTs("workers/store/d1/ops.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");

const A = "a@example.com";
const B = "b@example.org";

async function mail() {
	const d1 = await openD1();
	await d1.addMailboxes(A, B);
	let n = 0;
	const add = async (mailbox, folder = "inbox", fields = {}, attachments = []) => {
		const id = `e${++n}`;
		await new D1Mailbox(d1.sql, {}, mailbox).createEmail(folder, {
			id, subject: "Hello", sender: "ann@example.org", recipient: mailbox, date: "2026-10-01T00:00:00Z", body: "<p>Body</p>", thread_id: id, ...fields,
		}, attachments);
		return id;
	};
	const run = (ops) => applyOps(d1.sql, ops);
	const folderOf = (id) => d1.exec(`SELECT folder_id FROM messages WHERE email_id = ?`, id)[0]?.folder_id;
	const labelsOf = (id) => d1.exec(`SELECT label_id FROM message_labels JOIN messages m ON m.id = message WHERE m.email_id = ? ORDER BY label_id`, id).map((r) => r.label_id);
	d1.exec(`INSERT INTO labels (id, name, color) VALUES ('tax', 'Tax', '#000'), ('work', 'Work', '#000')`);
	return { d1, add, run, folderOf, labelsOf };
}

test("flag ops count only rows whose value changed, in their own mailbox", async () => {
	const m = await mail();
	const a = await m.add(A, "inbox", { read: false });
	const b = await m.add(A, "inbox", { read: true });
	const other = await m.add(B, "inbox", { read: false });
	assert.equal((await m.run([{ mailboxId: A, kind: "flags", emailIds: [a, b, other, "missing"], patch: { read: true } }])).affected, 1);
	assert.equal(m.d1.exec(`SELECT read FROM messages WHERE email_id = ?`, other)[0].read, 0, "another mailbox's message is untouched");
	assert.equal((await m.run([{ mailboxId: A, kind: "flags", emailIds: [a, b], patch: { starred: true } }])).affected, 2);
	assert.equal((await m.run([{ mailboxId: A, kind: "flags", emailIds: [a], patch: {} }])).affected, 0);
});

test("move ops move only rows still in the source folder", async () => {
	const m = await mail();
	const a = await m.add(A);
	const b = await m.add(A, "sent");
	assert.equal((await m.run([{ mailboxId: A, kind: "move", emailIds: [a, b], to: "archive", from: "inbox" }])).affected, 1);
	assert.equal(m.folderOf(a), "archive");
	assert.equal(m.folderOf(b), "sent");
	const missing = await m.run([{ mailboxId: A, kind: "move", emailIds: [a], to: "nowhere", from: "archive" }]);
	assert.deepEqual(missing.failed, [{ mailboxId: A, error: "Folder not found: nowhere" }]);
});

test("after a folder import, moves into custom folders are refused and the mailbox is reported", async () => {
	const m = await mail();
	m.d1.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, 'receipts', 'Receipts')`, A);
	const a = await m.add(A);
	assert.equal((await m.run([{ mailboxId: A, kind: "move", emailIds: [a], to: "receipts", from: "inbox" }])).affected, 1);
	m.d1.exec(`UPDATE mailboxes SET folders_imported = 1 WHERE id = ?`, A);
	const refused = await m.run([
		{ mailboxId: A, kind: "move", emailIds: [a], to: "receipts", from: "archive" },
		{ mailboxId: A, kind: "move", emailIds: [a], to: "inbox", from: "receipts" },
	]);
	assert.match(refused.failed[0].error, /system folders only/);
	assert.equal(refused.affected, 0, "a failed mailbox's later ops are skipped");
	assert.equal((await m.run([{ mailboxId: A, kind: "move", emailIds: [a], to: "inbox", from: "receipts" }])).affected, 1);
});

test("label ops add idempotently, remove, and skip unknown ids", async () => {
	const m = await mail();
	const a = await m.add(A);
	const b = await m.add(A);
	const add = (ids, labels) => m.run([{ mailboxId: A, kind: "labels", emailIds: ids, add: labels, remove: [] }]);
	assert.equal((await add([a, b, "missing"], ["tax"])).affected, 2);
	assert.equal((await add([a, b], ["tax"])).affected, 0);
	assert.equal((await m.run([{ mailboxId: A, kind: "labels", emailIds: [a], add: ["work"], remove: ["tax"] }])).affected, 1);
	assert.deepEqual(m.labelsOf(a), ["work"]);
	assert.deepEqual(m.labelsOf(b), ["tax"]);
});

test("purge ops delete only mail still in Trash and return its files", async () => {
	const m = await mail();
	const att = (emailId) => [{ id: `a-${emailId}`, email_id: emailId, filename: "x.pdf", mimetype: "application/pdf", size: 3, content_id: null, disposition: "attachment" }];
	const t1 = await m.add(A, "trash", {}, att("e1"));
	const t2 = await m.add(A, "trash");
	const i1 = await m.add(A);
	const d1 = await m.add(A, "draft");
	await m.run([{ mailboxId: A, kind: "labels", emailIds: [t1], add: ["tax"], remove: [] }]);
	const out = await m.run([{ mailboxId: A, kind: "purge", emailIds: [t1, t2, i1, d1, "missing"] }]);
	assert.equal(out.affected, 2);
	assert.deepEqual(out.purged, ["attachments/e1/a-e1/x.pdf"]);
	assert.deepEqual(m.d1.exec(`SELECT email_id FROM messages ORDER BY email_id`).map((r) => r.email_id), [i1, d1].sort());
	assert.equal(m.d1.exec(`SELECT COUNT(*) AS n FROM attachments`)[0].n, 0);
	assert.equal(m.d1.exec(`SELECT COUNT(*) AS n FROM message_labels`)[0].n, 0);
	assert.deepEqual(await m.run([{ mailboxId: A, kind: "purge", emailIds: [t1] }]), { affected: 0, failed: [], purged: [] });
});

test("folder counts list custom folders only, empty ones included", async () => {
	const m = await mail();
	m.d1.exec(`INSERT INTO folders (mailbox_id, id, name) VALUES (?, 'receipts', 'Receipts'), (?, 'empty', 'Empty')`, A, A);
	await m.add(A, "receipts");
	await m.add(A, "receipts");
	await m.add(A);
	assert.deepEqual(await new D1Mailbox(m.d1.sql, {}, A).folderImportCounts(), {
		folders: [{ folderId: "empty", name: "Empty", count: 0 }, { folderId: "receipts", name: "Receipts", count: 2 }],
		imported: false,
	});
});
