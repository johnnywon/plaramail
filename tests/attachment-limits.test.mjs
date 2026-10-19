import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-215: Email Sending takes messages up to 5 MiB. The composer and the Worker both refuse a larger one.

const { MESSAGE_BYTES_MAX, encodedBytes, messageBytes, messageSizeError, base64Bytes } = await loadTs("shared/message-size.ts");
const { sendMail } = await loadTs("workers/lib/send.ts");

test("files count at their encoded size", () => {
	assert.equal(encodedBytes(0), 0);
	assert.equal(encodedBytes(3), 6); // 4 base64 characters and a line break
	assert.equal(encodedBytes(57), 78); // one full 76-character line
	assert.ok(encodedBytes(3_000_000) > 4_000_000);
});

test("a 3.5 MB file fits and a 4 MB file does not", () => {
	assert.equal(messageSizeError(messageBytes({ html: "<p>Hi</p>", fileBytes: [3_500_000] })), null);
	const error = messageSizeError(messageBytes({ html: "<p>Hi</p>", fileBytes: [4_000_000] }));
	assert.match(error, /^This message is 5\.3 MB with its attachments encoded\. Mail can be up to 5 MB\.$/);
	assert.equal(messageSizeError(MESSAGE_BYTES_MAX), null);
});

test("base64Bytes reads a file's size from its content", () => {
	assert.equal(base64Bytes(Buffer.from("hello").toString("base64")), 5);
	assert.equal(base64Bytes(Buffer.alloc(1000).toString("base64")), 1000);
});

test("sendMail refuses a message over 5 MiB before it spends any send budget", async () => {
	let budget = 0;
	const stub = {
		takeSendBudget: async () => { budget++; return { ok: true, id: 1 }; },
		claimSendKey: async () => ({ state: "new" }),
	};
	const big = Buffer.alloc(4_000_000).toString("base64");
	const result = await sendMail({ EMAIL: { send: async () => { throw new Error("sent"); } } }, "a@example.com", stub, {
		to: "b@example.org", from: "a@example.com", subject: "Big", html: "<p>Big</p>",
		attachments: [{ content: big, filename: "big.bin", type: "application/octet-stream", disposition: "attachment" }],
	}, { kind: "new" }, {});
	assert.equal(result.ok, false);
	assert.equal(result.status, 400);
	assert.match(result.error, /Mail can be up to 5 MB\./);
	assert.equal(budget, 0);
});

test("the composer checks size before sending and on every way files come in", () => {
	const compose = readFileSync(new URL("../app/components/postal/compose.ts", import.meta.url), "utf8");
	assert.match(compose, /const tooLarge = composeSizeError\(state\.files, html\);\n\t\t\tif \(tooLarge\) throw new ComposeError\(tooLarge\);/);
	const win = readFileSync(new URL("../app/components/postal/ComposeWindow.tsx", import.meta.url), "utf8");
	assert.match(win, /onPasteCapture=/);
	assert.match(win, /if \(!files\.length \|\| e\.clipboardData\.getData\("text\/html"\)\) return;/, "a Finder copy with its name as plain text still attaches");
	assert.match(win, /onDropCapture=/);
	assert.match(win, /const addFiles = async/);
	assert.equal((win.match(/addFiles\(/g) ?? []).length, 3); // the picker, paste and drop
	assert.doesNotMatch(win, /readFiles\(list\)\;\n\t*patch/);
});
