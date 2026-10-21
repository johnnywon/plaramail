import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { openD1 } from "./helpers/d1.mjs";

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

function rawMessage({ messageId = "delivery@example.net", attachment = false } = {}) {
	const headers = [
		"From: sender@example.net",
		"To: hello@example.com",
		...(messageId ? [`Message-ID: <${messageId}>`] : []),
		...(attachment ? [
			"MIME-Version: 1.0",
			'Content-Type: multipart/mixed; boundary="plaramail-boundary"',
		] : []),
		"Subject: Inbound test",
	];
	const body = attachment
		? [
			"--plaramail-boundary",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"Hello",
			"--plaramail-boundary",
			'Content-Type: text/plain; name="note.txt"',
			'Content-Disposition: attachment; filename="note.txt"',
			"Content-Transfer-Encoding: base64",
			"",
			"SGVsbG8=",
			"--plaramail-boundary--",
			"",
		].join("\r\n")
		: "Hello";
	const raw = new TextEncoder().encode(`${headers.join("\r\n")}\r\n\r\n${body}`);
	return {
		to: "hello@example.com",
		rawSize: raw.length,
		raw: new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } }),
		setReject: () => {},
	};
}

async function environment({ failCreate = false } = {}) {
	const d1 = await openD1();
	await d1.addMailboxes("hello@example.com");
	const puts = [];
	const deletes = [];
	let lookupCount = 0;
	const DB = {
		prepare: (text) => {
			if (/AND message_id = \?/.test(text)) lookupCount++;
			return d1.DB.prepare(text);
		},
		batch: async (list) => {
			if (failCreate && list.some((s) => /INSERT INTO messages\b/.test(s.text))) throw new Error("store failed");
			return d1.DB.batch(list);
		},
	};
	const env = {
		EMAIL_ADDRESSES: ["hello@example.com"],
		BUCKET: {
			head: async () => ({}),
			put: async (key) => puts.push(key),
			delete: async (keys) => deletes.push(...(Array.isArray(keys) ? keys : [keys])),
		},
		DB,
	};
	const stored = async () => Number((await d1.sql.first(`SELECT COUNT(*) AS n FROM messages WHERE folder_id = 'inbox'`)).n);
	return { env, stored, puts, deletes, get lookupCount() { return lookupCount; } };
}

async function deliver(env, message = rawMessage()) {
	return receiveEmail(message, env, { waitUntil: () => {} });
}

test("duplicate Message-IDs do not create another email or R2 object", async () => {
	const fixture = await environment();
	await deliver(fixture.env, rawMessage({ attachment: true }));
	await deliver(fixture.env, rawMessage({ attachment: true }));
	assert.equal(await fixture.stored(), 1);
	assert.equal(fixture.puts.length, 1);
	assert.equal(fixture.deletes.length, 0);
});

test("messages without a Message-ID are always stored", async () => {
	const fixture = await environment();
	await deliver(fixture.env, rawMessage({ messageId: null }));
	await deliver(fixture.env, rawMessage({ messageId: null }));
	assert.equal(await fixture.stored(), 2);
	assert.equal(fixture.lookupCount, 0);
});

test("attachment objects are removed when storing the email fails", async () => {
	const fixture = await environment({ failCreate: true });
	await assert.rejects(deliver(fixture.env, rawMessage({ attachment: true })), /store failed/);
	assert.equal(fixture.puts.length, 1);
	assert.deepEqual(fixture.deletes, fixture.puts);
});
