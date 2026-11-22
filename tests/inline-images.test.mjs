import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { openD1 } from "./helpers/d1.mjs";

// Images that an HTML body shows through cid: and that come without a Content-Disposition.

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

const ME = "hello@example.com";

function message({ multipart = "related", html = '<p>Hi <img src="cid:logo@example.net"></p>', disposition = null }) {
	const raw = [
		"From: bob@example.net",
		`To: ${ME}`,
		`Message-ID: <${crypto.randomUUID()}@example.net>`,
		"Subject: Logo",
		"MIME-Version: 1.0",
		`Content-Type: multipart/${multipart}; boundary="R"`,
		"",
		"--R",
		"Content-Type: text/html; charset=utf-8",
		"",
		html,
		"--R",
		'Content-Type: image/png; name="logo.png"',
		"Content-Transfer-Encoding: base64",
		"Content-ID: <logo@example.net>",
		...(disposition ? [`Content-Disposition: ${disposition}; filename="logo.png"`] : []),
		"",
		"iVBORw0KGgo=",
		"--R--",
		"",
	].join("\r\n");
	const bytes = new TextEncoder().encode(raw);
	return { to: ME, rawSize: bytes.length, setReject: () => {}, raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) };
}

async function receive(options) {
	const d1 = await openD1();
	await d1.addMailboxes(ME);
	const env = {
		EMAIL_ADDRESSES: [ME], DB: d1.DB,
		BUCKET: { head: async () => ({}), get: async () => null, put: async () => {}, delete: async () => {} },
	};
	await receiveEmail(message(options), env, { waitUntil: () => {} });
	return {
		attachment: await d1.sql.first(`SELECT content_id, disposition FROM attachments`),
		message: await d1.sql.first(`SELECT has_attachment FROM messages`),
	};
}

test("a multipart/related image with a Content-ID and no Content-Disposition is stored inline", async () => {
	const { attachment, message } = await receive({});
	assert.deepEqual({ ...attachment }, { content_id: "<logo@example.net>", disposition: "inline" });
	assert.equal(message.has_attachment, 0);
});

test("a part with a Content-ID and no Content-Disposition is inline only when the HTML shows its cid", async () => {
	const shown = await receive({ multipart: "mixed" });
	assert.equal(shown.attachment.disposition, "inline");
	assert.equal(shown.message.has_attachment, 0);
	for (const multipart of ["mixed", "related"]) {
		const notShown = await receive({ multipart, html: "<p>See the file.</p>" });
		assert.equal(notShown.attachment.disposition, "attachment", multipart);
		assert.equal(notShown.message.has_attachment, 1, multipart);
	}
});

test("a Content-Disposition the sender gave is kept", async () => {
	const { attachment, message } = await receive({ disposition: "attachment" });
	assert.equal(attachment.disposition, "attachment");
	assert.equal(message.has_attachment, 1);
});
