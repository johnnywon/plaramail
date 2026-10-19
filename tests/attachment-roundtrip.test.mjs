import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { openD1 } from "./helpers/d1.mjs";

// #59: a text attachment gained a 0x0a on every trip. The send side hands the file's bytes to
// the Email Sending binding unchanged (email-sender.ts); the mail service writes the MIME. On
// the way in, postal-mime 2.x kept the CRLF in front of the next boundary as part content
// (RFC 2046 5.1.1 gives it to the boundary). These tests carry a file through the send-side
// code, through MIME in each transfer encoding a sender may use, and back out of the
// receive path, byte for byte.

const load = async (entry) => {
	const out = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false });
	return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const { parseMail } = await load("workers/lib/parse-mail.ts");
const { sendEmail } = await load("workers/email-sender.ts");
const { receiveEmail } = await load("workers/index.ts");

const FILE = Buffer.from("QA text line XK7731Q\n"); // the 21 bytes from the issue

/** Quoted-printable as a sender writes it for text: line breaks become CRLF, long lines get soft breaks. */
function qp(bytes) {
	const lines = bytes.toString("latin1").split("\n");
	return lines.map((line) => {
		let out = "";
		for (const ch of line) out += /[\t\x20-\x3c\x3e-\x7e]/.test(ch) ? ch : `=${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
		const wrapped = [];
		while (out.length > 75) { wrapped.push(`${out.slice(0, 75)}=`); out = out.slice(75); }
		return [...wrapped, out].join("\r\n");
	}).join("\r\n");
}

/** The part body in a transfer encoding. Text line breaks go on the wire as CRLF. */
const ENCODINGS = {
	"7bit": (b) => b.toString("latin1").replace(/\n/g, "\r\n"),
	"quoted-printable": qp,
	base64: (b) => b.toString("base64").replace(/.{76}/g, "$&\r\n"),
};

/** A message as the mail service could build it: a text body, then the file. The body ends with the CRLF that starts the boundary. */
function mime(file, encoding, { filename = "notes.txt", type = "text/plain" } = {}) {
	return [
		"From: a@example.com", "To: b@example.org", "Subject: File", "Message-ID: <rt-1@example.com>", "MIME-Version: 1.0",
		'Content-Type: multipart/mixed; boundary="b1"', "",
		"--b1", "Content-Type: text/plain; charset=utf-8", "", "See the file.",
		"--b1", `Content-Type: ${type}; name="${filename}"`, `Content-Disposition: attachment; filename="${filename}"`,
		`Content-Transfer-Encoding: ${encoding}`, "", ENCODINGS[encoding](file),
		"--b1--", "",
	].join("\r\n");
}

/** The message as bytes: each character of `mime()` is one byte. */
function wire(file, encoding, options) {
	return Buffer.from(mime(file, encoding, options), "latin1");
}

const bytesOf = (content) => Buffer.from(typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content));

const FILES = {
	"the issue's file": FILE,
	"no final newline": Buffer.from("no newline at the end"),
	"blank lines at the end": Buffer.from("two\n\n\n"),
	"a long line with a soft break last": Buffer.from(`${"x".repeat(150)}`),
	"a long line then a newline": Buffer.from(`${"y".repeat(150)}\n`),
	"an = at the end": Buffer.from("a=b="),
	"utf-8": Buffer.from("café ünïcode\n"),
	"empty": Buffer.alloc(0),
};

for (const encoding of Object.keys(ENCODINGS)) {
	for (const [name, file] of Object.entries(FILES)) {
		test(`a ${encoding} text attachment comes out byte for byte: ${name}`, async () => {
			const parsed = await parseMail(wire(file, encoding));
			assert.equal(parsed.attachments.length, 1);
			assert.deepEqual(bytesOf(parsed.attachments[0].content), file);
		});
	}
}

test("the line break before the boundary stays out of the text body too", async () => {
	const parsed = await parseMail(wire(FILE, "7bit"));
	assert.equal(parsed.text, "See the file.");
});

test("a single-part message keeps its final line break, which no boundary owns", async () => {
	const parsed = await parseMail("From: a@example.com\r\nContent-Type: text/plain\r\n\r\nHello\r\n");
	assert.equal(parsed.text, "Hello\n");
});

test("binary attachments still come out byte for byte", async () => {
	const bin = Buffer.from(Uint8Array.from({ length: 256 }, (_, i) => i));
	const parsed = await parseMail(wire(bin, "base64", { filename: "smoke.bin", type: "application/octet-stream" }));
	assert.deepEqual(bytesOf(parsed.attachments[0].content), bin);
});

/** Hand a file to the Email Sending binding the way sendMail does, and return the bytes the binding got. */
async function handedToBinding(file) {
	let message;
	await sendEmail({ send: async (m) => { message = m; return { messageId: "x" }; } }, {
		to: "b@example.org", from: "a@example.com", subject: "File", text: "See the file.",
		attachments: [{ content: file.toString("base64"), filename: "notes.txt", type: "text/plain", disposition: "attachment" }],
	});
	return Buffer.from(message.attachments[0].content);
}

/** Deliver raw mail to hello@example.com and return the bytes stored for its attachment. */
async function receivedBytes(raw) {
	const d1 = await openD1();
	const puts = new Map();
	const env = {
		EMAIL_ADDRESSES: ["hello@example.com"], DB: d1.DB,
		BUCKET: { head: async () => ({}), get: async () => null, put: async (key, value) => { puts.set(key, Buffer.from(new Uint8Array(value))); }, delete: async () => {} },
	};
	const bytes = Buffer.from(raw.replace("To: b@example.org", "To: hello@example.com"), "latin1");
	await receiveEmail({
		to: "hello@example.com", rawSize: bytes.length, setReject: () => {},
		raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
	}, env, { waitUntil: () => {} });
	const stored = [...puts.entries()].filter(([key]) => key.startsWith("attachments/"));
	assert.equal(stored.length, 1);
	const row = await d1.sql.first(`SELECT size FROM attachments`);
	assert.equal(row.size, stored[0][1].length, "the saved size matches the bytes");
	return stored[0][1];
}

for (const encoding of Object.keys(ENCODINGS)) {
	test(`send, receive and forward keep a ${encoding} text attachment at 21 bytes`, async () => {
		const sent = await handedToBinding(FILE);
		assert.deepEqual(sent, FILE, "the binding gets the file's own bytes");
		const received = await receivedBytes(mime(sent, encoding));
		assert.deepEqual(received, FILE, "the recipient's copy");
		// A forward reads the stored file back and sends it again (send.ts forwardedAttachments).
		const forwarded = await receivedBytes(mime(await handedToBinding(received), encoding));
		assert.deepEqual(forwarded, FILE, "the forwarded copy");
	});
}
