import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { statements } from "./helpers/schema.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// WON-212: with trashDays set, the hourly cron deletes mail that has been in
// Trash or Spam that long, and its files. Off by default.

const A = "a@example.com";
let mf;
let bucket;

before(async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/store-worker.ts"], bundle: true, format: "esm", platform: "neutral",
		conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"], external: ["cloudflare:workers"],
		write: false, logLevel: "silent",
	});
	mf = new Miniflare({
		modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		bindings: { EMAIL_ADDRESSES: [A] }, r2Buckets: ["BUCKET"], d1Databases: ["DB"],
	});
	for (const s of statements(D1_SCHEMA)) await ok("-", "_sql", s);
	await ok("registry", "put", A, { fromName: A });
	bucket = await mf.getR2Bucket("BUCKET");
});

after(async () => {
	await mf?.dispose();
});

async function ok(target, op, ...args) {
	const response = await mf.dispatchFetch("http://test/", { method: "POST", body: JSON.stringify({ target, op, args }) });
	const result = await response.json();
	assert.equal(result.error, undefined, `${target}.${op}: ${result.error}`);
	return result.ok;
}

const DAY = 86_400_000;
const daysAgo = (d) => new Date(Date.now() - d * DAY).toISOString();
const email = (id, fields = {}) => ({
	id, subject: "Hello", sender: "ann@example.net", recipient: A, cc: null, bcc: null, date: daysAgo(400),
	body: "<p>Hello</p>", thread_id: id, message_id: `${id}@example.net`, raw_headers: "[]", ...fields,
});
const movedAt = async (id) => (await ok("-", "_rows", `SELECT folder_changed_at AS t FROM messages WHERE email_id = '${id}'`))[0].t;

test("moving to Trash stamps the move; a year-old message just trashed is not purged", async () => {
	await ok(A, "createEmail", "inbox", email("old-letter"), [
		{ id: "att1", email_id: "old-letter", filename: "a.pdf", mimetype: "application/pdf", size: 3, content_id: null, disposition: "attachment" },
	]);
	await bucket.put("attachments/old-letter/att1/a.pdf", "pdf");
	assert.equal(await movedAt("old-letter"), null);
	await ok(A, "trashOrDelete", "old-letter");
	assert.ok(Date.now() - Date.parse(await movedAt("old-letter")) < 60_000, "the move is stamped now");
	assert.deepEqual(await ok("all", "purgeRetention", 30), { deleted: 0, failed: [] });
	assert.ok(await ok(A, "getEmail", "old-letter"));
});

test("mail in Trash past the days is purged with its files; newer Trash, the Inbox and Drafts stay", async () => {
	await ok("-", "_sql", `UPDATE messages SET folder_changed_at = '${daysAgo(31)}' WHERE email_id = 'old-letter'`);
	await ok(A, "createEmail", "inbox", email("recent"), []);
	await ok(A, "trashOrDelete", "recent");
	await ok(A, "createEmail", "inbox", email("kept"), []);
	await ok(A, "createEmail", "draft", email("draft"), []);
	assert.deepEqual(await ok("all", "purgeRetention", 30), { deleted: 1, failed: [] });
	assert.equal(await ok(A, "getEmail", "old-letter"), null);
	assert.equal(await bucket.head("attachments/old-letter/att1/a.pdf"), null, "its file is deleted from R2");
	for (const id of ["recent", "kept", "draft"]) assert.ok(await ok(A, "getEmail", id), id);
});

test("Spam that arrived there counts from its date", async () => {
	await ok(A, "createEmail", "spam", email("spam-old", { date: daysAgo(40) }), []);
	await ok(A, "createEmail", "spam", email("spam-new", { date: daysAgo(2) }), []);
	assert.deepEqual(await ok("all", "purgeRetention", 30), { deleted: 1, failed: [] });
	assert.equal(await ok(A, "getEmail", "spam-old"), null);
	assert.ok(await ok(A, "getEmail", "spam-new"));
});

test("the cron purges only when prefs set trashDays, and the setting is in Console > General", () => {
	const cron = readFileSync(new URL("../workers/cron.ts", import.meta.url), "utf8");
	assert.match(cron, /if \(!prefs\.trashDays\) return null;/);
	assert.match(cron, /purgeRetention\(prefs\.trashDays, now\)/);
	const migration = readFileSync(new URL("../migrations/0010_folder_changed_at.sql", import.meta.url), "utf8");
	assert.match(migration, /CREATE TRIGGER messages_folder_changed AFTER UPDATE OF folder_id ON messages/);
	const modals = readFileSync(new URL("../app/components/postal/Modals.tsx", import.meta.url), "utf8");
	assert.match(modals, /<Setting title="Keep Trash and Spam">/);
});
