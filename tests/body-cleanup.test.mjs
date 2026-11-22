import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// A body over BODY_INLINE_MAX goes to R2 before the D1 insert. When the insert fails, the object is removed.

const bundle = await build({
	entryPoints: ["workers/index.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { receiveEmail } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const { mailStore } = await loadTs("workers/store/index.ts");

const ME = "hello@example.com";
const BIG = `<p>${"x".repeat(600 * 1024)}</p>`;

async function environment({ failInsert = false } = {}) {
	const d1 = await openD1();
	await d1.addMailboxes(ME);
	const puts = [];
	const deletes = [];
	const DB = {
		prepare: (text) => d1.DB.prepare(text),
		batch: async (list) => {
			if (failInsert && list.some((s) => /INSERT INTO messages\b/.test(s.text))) throw new Error("store failed");
			return d1.DB.batch(list);
		},
	};
	const env = {
		EMAIL_ADDRESSES: [ME], DB,
		BUCKET: {
			head: async () => ({}),
			get: async () => null,
			put: async (key) => puts.push(key),
			delete: async (keys) => deletes.push(...[keys].flat()),
		},
	};
	return { d1, env, puts, deletes };
}

function bigMessage() {
	const raw = new TextEncoder().encode([
		"From: bob@example.net",
		`To: ${ME}`,
		`Message-ID: <${crypto.randomUUID()}@example.net>`,
		"Subject: Big",
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=utf-8",
		"",
		BIG,
	].join("\r\n"));
	return { to: ME, rawSize: raw.length, setReject: () => {}, raw: new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } }) };
}

test("a large received body is removed from R2 when the insert fails", async () => {
	const { env, puts, deletes } = await environment({ failInsert: true });
	await assert.rejects(receiveEmail(bigMessage(), env, { waitUntil: () => {} }), /store failed/);
	assert.equal(puts.length, 1);
	assert.match(puts[0], /^bodies\/.+\.html$/);
	assert.deepEqual(deletes, puts);
});

test("a large received body stays in R2 when the insert succeeds", async () => {
	const { env, puts, deletes } = await environment();
	await receiveEmail(bigMessage(), env, { waitUntil: () => {} });
	assert.equal(puts.length, 1);
	assert.deepEqual(deletes, []);
});

test("a failed insert does not remove the body of a message already stored with that id", async () => {
	const { env, puts, deletes } = await environment();
	const store = mailStore(env).mailbox(ME);
	const email = {
		id: "same-id", subject: "Big", sender: ME, recipient: "bob@example.net", cc: null, bcc: null,
		date: new Date().toISOString(), body: BIG, in_reply_to: null, email_references: null, thread_id: "same-id",
	};
	await store.createEmail("draft", email, []);
	await assert.rejects(store.createEmail("draft", email, []));
	assert.deepEqual(puts, ["bodies/same-id.html", "bodies/same-id.html"]);
	assert.deepEqual(deletes, []);
});
