import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

const { app } = await loadTs("workers/index.ts");

const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const A = "a@example.com";

const calls = [];
async function environment() {
	const d1 = await openD1();
	await d1.addMailboxes(A);
	const bucket = {
		head: async () => ({}),
		get: async () => null,
		delete: async (keys) => calls.push(["r2.delete", keys]),
	};
	const mailbox = new D1Mailbox(d1.sql, bucket, A);
	const store = (folder, id, attachments = []) => mailbox.createEmail(folder, {
		id, subject: "Hello", sender: "ann@example.net", recipient: A, date: new Date().toISOString(), body: "<p>hi</p>",
		thread_id: id, message_id: `${id}@example.net`, raw_headers: "[]",
	}, attachments);
	await store("inbox", "e1");
	await store("trash", "in-trash", [{ id: "att", email_id: "in-trash", filename: "f.pdf", mimetype: "application/pdf", size: 1, content_id: null, disposition: "attachment" }]);
	return { EMAIL_ADDRESSES: [A], BUCKET: bucket, DB: d1.DB };
}

const json = { "content-type": "application/json" };

// The route answers 400 for an empty body, so 400 means the write got past the check.
async function post(headers) {
	return app.request("http://localhost/api/v1/mail/bulk/undo", { method: "POST", headers, body: "{}" }, await environment());
}

test("writes from the app itself pass", async () => {
	assert.equal((await post({ ...json, "sec-fetch-site": "same-origin" })).status, 400);
	assert.equal((await post({ ...json, "sec-fetch-site": "none" })).status, 400);
	assert.equal((await post({ ...json, origin: "http://localhost", "sec-fetch-site": "cross-site" })).status, 400);
});

test("cross-site and header-less writes are refused", async () => {
	assert.equal((await post({ ...json, "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status, 403);
	assert.equal((await post({ ...json, "sec-fetch-site": "same-site" })).status, 403);
	assert.equal((await post({ ...json })).status, 403);
});

test("writes without a JSON content type are refused", async () => {
	assert.equal((await post({ "sec-fetch-site": "same-origin", "content-type": "text/plain" })).status, 415);
	assert.equal((await post({ "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded" })).status, 415);
	assert.equal((await post({ "sec-fetch-site": "same-origin" })).status, 415);
});

test("reads are not checked", async () => {
	const response = await app.request("http://localhost/api/v1/mail?view=all", { headers: { "sec-fetch-site": "cross-site" } }, await environment());
	assert.equal(response.status, 200);
});

const same = { ...json, "sec-fetch-site": "same-origin" };

test("Delete moves to Trash, and deletes attachments only on a permanent delete", async () => {
	const env = await environment();
	calls.length = 0;
	let response = await app.request("http://localhost/api/v1/mailboxes/a@example.com/emails/e1", { method: "DELETE", headers: same }, env);
	assert.deepEqual(await response.json(), { status: "trashed" });
	assert.deepEqual(calls, [], "a move to Trash keeps the files");
	response = await app.request("http://localhost/api/v1/mailboxes/a@example.com/emails/in-trash", { method: "DELETE", headers: same }, env);
	assert.deepEqual(await response.json(), { status: "deleted" });
	assert.deepEqual(calls, [["r2.delete", ["attachments/in-trash/att/f.pdf"]]]);
	response = await app.request("http://localhost/api/v1/mailboxes/a@example.com/emails/missing", { method: "DELETE", headers: same }, env);
	assert.equal(response.status, 404);
});

test("mail params are validated before reaching the store", async () => {
	const env = await environment();
	const get = (query) => app.request(`http://localhost/api/v1/mail?${query}`, {}, env);
	assert.equal((await get("view=bogus")).status, 400);
	assert.equal((await get("cursor=@@@")).status, 400);
	assert.equal((await get("q=has:nonsense")).status, 400);
	const body = await (await get("view=all&address=a@example.com&limit=10")).json();
	assert.deepEqual(body.conversations.map((c) => c.email_id), ["e1"]);
});

test("agent connections from another origin are refused", async () => {
	const { foreignOrigin } = await loadTs("workers/lib/csrf.ts");
	const req = (origin) => new Request("https://mail.example.com/agents/email-agent/default", origin ? { headers: { origin } } : {});
	assert.equal(foreignOrigin(req("https://evil.example.net")), true);
	assert.equal(foreignOrigin(req("https://other.example.com")), true, "a sibling subdomain is another origin");
	assert.equal(foreignOrigin(req("null")), true);
	assert.equal(foreignOrigin(req("https://mail.example.com")), false);
	assert.equal(foreignOrigin(req()), false, "clients outside a browser send no Origin");
});
