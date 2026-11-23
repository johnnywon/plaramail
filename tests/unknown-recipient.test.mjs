import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { NODE_REQUIRE } from "./helpers/node-require.mjs";
import { openD1 } from "./helpers/d1.mjs";

const bundle = await build({
	entryPoints: ["workers/index.ts"],
	bundle: true,
	platform: "node", banner: NODE_REQUIRE,
	format: "esm",
	write: false,
});
const { receiveEmail } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function message() {
	const raw = new TextEncoder().encode("From: sender@example.net\r\nTo: hello@example.com\r\nSubject: Routing test\r\n\r\nHello");
	let reads = 0;
	return {
		rawSize: raw.length,
		raw: new ReadableStream({
			pull(controller) {
				reads++;
				controller.enqueue(raw);
				controller.close();
			},
		}, { highWaterMark: 0 }),
		get reads() { return reads; },
	};
}

async function environment(addresses) {
	const d1 = await openD1();
	return {
		env: { EMAIL_ADDRESSES: addresses, BUCKET: { head: async () => ({}) }, DB: d1.DB },
		stored: async () => Number((await d1.sql.first(`SELECT COUNT(*) AS n FROM messages`)).n),
	};
}

test("unknown envelope recipients are rejected before reading the message", async () => {
	const unconfigured = await environment(["allowed@example.com"]);
	const unconfiguredMessage = message();
	const unconfiguredRejections = [];
	await receiveEmail({
		to: "other@example.net",
		...unconfiguredMessage,
		setReject: (reason) => unconfiguredRejections.push(reason),
	}, unconfigured.env, { waitUntil: () => {} });
	assert.deepEqual(unconfiguredRejections, ["Unknown recipient"]);
	assert.equal(unconfiguredMessage.reads, 0);
	assert.equal(await unconfigured.stored(), 0);

	const missingMailbox = await environment([]);
	const missingMailboxMessage = message();
	const missingMailboxRejections = [];
	await receiveEmail({
		to: "unknown@example.org",
		...missingMailboxMessage,
		setReject: (reason) => missingMailboxRejections.push(reason),
	}, missingMailbox.env, { waitUntil: () => {} });
	assert.deepEqual(missingMailboxRejections, ["Unknown recipient"]);
	assert.equal(missingMailboxMessage.reads, 0);
	assert.equal(await missingMailbox.stored(), 0);

	const configured = await environment(["hello@example.com"]);
	const configuredMessage = message();
	const configuredRejections = [];
	await receiveEmail({
		to: "hello@example.com",
		...configuredMessage,
		setReject: (reason) => configuredRejections.push(reason),
	}, configured.env, { waitUntil: () => {} });
	assert.deepEqual(configuredRejections, []);
	assert.equal(await configured.stored(), 1);
});

test("a plus tag delivers to the configured address it is added to", async () => {
	const { env, stored } = await environment(["hello@example.com"]);
	const rejections = [];
	await receiveEmail({
		to: "Hello+m_42@example.com",
		...message(),
		setReject: (reason) => rejections.push(reason),
	}, env, { waitUntil: () => {} });
	assert.deepEqual(rejections, []);
	assert.equal(await stored(), 1);

	const other = [];
	await receiveEmail({
		to: "other+m_42@example.com",
		...message(),
		setReject: (reason) => other.push(reason),
	}, env, { waitUntil: () => {} });
	assert.deepEqual(other, ["Unknown recipient"]);
});

test("an address configured with a plus keeps its own mailbox", async () => {
	const { env, stored } = await environment(["hello@example.com", "hello+list@example.com"]);
	const rejections = [];
	await receiveEmail({
		to: "hello+list@example.com",
		...message(),
		setReject: (reason) => rejections.push(reason),
	}, env, { waitUntil: () => {} });
	assert.deepEqual(rejections, []);
	assert.equal(await stored(), 1);
});
