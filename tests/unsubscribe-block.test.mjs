import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// One-click List-Unsubscribe and block sender (WON-217).

const { unsubscribeTargets, unsubscribeMethod, isPublicHttpsUrl } = await loadTs("shared/unsubscribe.ts");
const { postOneClick } = await loadTs("workers/lib/unsubscribe.ts");
const { app, receiveEmail } = await loadTs("workers/index.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");

const A = "a@example.com";
const headers = (list) => JSON.stringify(list.map(([key, value]) => ({ key, value })));
const ONE_CLICK = headers([
	["from", "News <news@example.org>"],
	["list-unsubscribe", "<mailto:leave@example.org?subject=unsubscribe>, <https://example.org/u/42>"],
	["list-unsubscribe-post", "List-Unsubscribe=One-Click"],
]);

// ── Reading the headers ─────────────────────────────────────────

test("one-click needs an https URL and the Post header", () => {
	assert.deepEqual(unsubscribeTargets(ONE_CLICK), {
		url: "https://example.org/u/42",
		mailto: { to: "leave@example.org", subject: "unsubscribe", body: "" },
		oneClick: true,
	});
	assert.equal(unsubscribeMethod(unsubscribeTargets(ONE_CLICK)), "one-click");
	const noPost = headers([["list-unsubscribe", "<https://example.org/u/42>"]]);
	assert.equal(unsubscribeMethod(unsubscribeTargets(noPost)), "link");
	const httpPost = headers([["list-unsubscribe", "<http://example.org/u/42>"], ["list-unsubscribe-post", "List-Unsubscribe=One-Click"]]);
	assert.equal(unsubscribeTargets(httpPost).oneClick, false, "one-click is https only");
	assert.equal(unsubscribeMethod(unsubscribeTargets(httpPost)), "link");
});

test("a page comes before a mailto; a mailto alone opens the composer", () => {
	const both = headers([["List-Unsubscribe", "<mailto:leave@example.org>, <https://example.org/u>"]]);
	assert.equal(unsubscribeMethod(unsubscribeTargets(both)), "link");
	const mailto = headers([["List-Unsubscribe", "<mailto:Leave@Example.org?Subject=stop%20please&body=remove%20me>"]]);
	assert.deepEqual(unsubscribeTargets(mailto), { url: null, mailto: { to: "leave@example.org", subject: "stop please", body: "remove me" }, oneClick: false });
	assert.equal(unsubscribeMethod(unsubscribeTargets(mailto)), "mailto");
});

test("no usable List-Unsubscribe means no Unsubscribe", () => {
	for (const raw of [null, "", "not json", "[]", headers([["list-unsubscribe", "<ftp://example.org/x>"]]), headers([["list-unsubscribe", "<mailto:nobody>"]])]) {
		assert.equal(unsubscribeTargets(raw), null, String(raw));
		assert.equal(unsubscribeMethod(unsubscribeTargets(raw)), null);
	}
});

test("only public https URLs are posted to", () => {
	for (const url of ["https://example.org/u", "https://lists.example.net:443/u?x=1", "https://93.184.216.34/u"]) assert.equal(isPublicHttpsUrl(url), true, url);
	for (const url of [
		"http://example.org/u", "ftp://example.org/u", "not a url",
		"https://localhost/u", "https://app.localhost/u", "https://intranet/u", "https://printer.local/u", "https://db.internal/u",
		"https://127.0.0.1/u", "https://10.1.2.3/u", "https://172.16.0.1/u", "https://192.168.1.1/u", "https://169.254.169.254/latest",
		"https://100.64.0.1/u", "https://0.0.0.0/u", "https://0x7f.1/u", "https://2130706433/u",
		"https://[::1]/u", "https://[fd00::1]/u", "https://[::ffff:127.0.0.1]/u",
		"https://user:pass@example.org/u", "https://example.org:8443/u",
	]) assert.equal(isPublicHttpsUrl(url), false, url);
});

test("the one-click POST is form-encoded, follows no redirects and counts only 2xx", async () => {
	const calls = [];
	const answer = (status) => async (url, init) => {
		calls.push({ url, init });
		return new Response(null, { status });
	};
	assert.deepEqual(await postOneClick("https://example.org/u/42", answer(200)), { ok: true, status: 200 });
	const { url, init } = calls[0];
	assert.equal(url, "https://example.org/u/42");
	assert.equal(init.method, "POST");
	assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
	assert.equal(init.body, "List-Unsubscribe=One-Click");
	assert.equal(init.redirect, "manual");
	assert.deepEqual(await postOneClick("https://example.org/u/42", answer(302)), { ok: false, status: 302, error: "The list answered 302" });
	assert.deepEqual(await postOneClick("https://example.org/u/42", async () => { throw new TypeError("network"); }), { ok: false, status: null, error: "Could not reach the list" });
	calls.length = 0;
	assert.equal((await postOneClick("https://127.0.0.1/u", answer(200))).refused, true);
	assert.equal(calls.length, 0, "a private host is never fetched");
});

// ── The API ─────────────────────────────────────────────────────

async function environment() {
	const d1 = await openD1();
	await d1.addMailboxes(A);
	const bucket = { head: async () => ({}), get: async () => null, put: async () => {}, delete: async () => {} };
	const mailbox = new D1Mailbox(d1.sql, bucket, A);
	const store = (id, raw, sender = "news@example.org") => mailbox.createEmail("inbox", {
		id, subject: "Weekly", sender, recipient: A, date: new Date().toISOString(), body: "<p>hi</p>",
		thread_id: id, message_id: `${id}@example.org`, raw_headers: raw,
	}, []);
	await store("one-click", ONE_CLICK);
	await store("private", headers([["list-unsubscribe", "<https://192.168.1.10/u>"], ["list-unsubscribe-post", "List-Unsubscribe=One-Click"]]));
	await store("mailto", headers([["list-unsubscribe", "<mailto:leave@example.org?subject=unsubscribe>"]]));
	await store("link", headers([["list-unsubscribe", "<https://example.org/prefs>"]]));
	await store("plain", "[]", "ann@example.net");
	await store("own", "[]", A);
	const env = { EMAIL_ADDRESSES: [A], BUCKET: bucket, DB: d1.DB };
	const activity = () => d1.exec(`SELECT mailbox_id, actor, action, tool, target, summary, ok FROM agent_activity ORDER BY id`);
	return { d1, env, activity };
}

const same = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const call = (env, method, path) => app.request(`http://localhost/api/v1${path}`, { method, headers: same, ...(method === "POST" ? { body: "{}" } : {}) }, env);

/** Replace fetch for one block, recording what the Worker sends. */
async function withFetch(respond, run) {
	const real = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return respond(url, init);
	};
	try {
		await run(calls);
	} finally {
		globalThis.fetch = real;
	}
}

test("Unsubscribe posts one-click from the Worker and records it", async () => {
	const { env, activity } = await environment();
	await withFetch(() => new Response("", { status: 200 }), async (calls) => {
		const response = await call(env, "POST", `/mailboxes/${A}/emails/one-click/unsubscribe`);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { method: "one-click", ok: true, status: 200, host: "example.org" });
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, "https://example.org/u/42");
		assert.equal(calls[0].init.body, "List-Unsubscribe=One-Click");
	});
	assert.deepEqual(activity(), [{
		mailbox_id: A, actor: "person", action: "settings", tool: "unsubscribe", target: "one-click",
		summary: "news@example.org · one-click to example.org · 200", ok: 1,
	}]);
});

test("a failed one-click is a 502 and logged as failed", async () => {
	const { env, activity } = await environment();
	await withFetch(() => new Response("", { status: 500 }), async () => {
		const response = await call(env, "POST", `/mailboxes/${A}/emails/one-click/unsubscribe`);
		assert.equal(response.status, 502);
		assert.equal((await response.json()).error, "The list answered 500");
	});
	assert.equal(activity()[0].ok, 0);
});

test("a private one-click URL is refused without a request", async () => {
	const { env } = await environment();
	await withFetch(() => new Response("", { status: 200 }), async (calls) => {
		const response = await call(env, "POST", `/mailboxes/${A}/emails/private/unsubscribe`);
		assert.equal(response.status, 400);
		assert.equal(calls.length, 0);
	});
});

test("mailto and link unsubscribes answer what to open and make no request", async () => {
	const { env, activity } = await environment();
	await withFetch(() => new Response("", { status: 200 }), async (calls) => {
		let response = await call(env, "POST", `/mailboxes/${A}/emails/mailto/unsubscribe`);
		assert.deepEqual(await response.json(), { method: "mailto", ok: true, mailto: { to: "leave@example.org", subject: "unsubscribe", body: "" } });
		response = await call(env, "POST", `/mailboxes/${A}/emails/link/unsubscribe`);
		assert.deepEqual(await response.json(), { method: "link", ok: true, url: "https://example.org/prefs" });
		response = await call(env, "POST", `/mailboxes/${A}/emails/plain/unsubscribe`);
		assert.equal(response.status, 400);
		response = await call(env, "POST", `/mailboxes/${A}/emails/missing/unsubscribe`);
		assert.equal(response.status, 404);
		assert.equal(calls.length, 0);
	});
	assert.deepEqual(activity().map((r) => r.summary), [
		"news@example.org · opened a mail to leave@example.org",
		"news@example.org · opened example.org",
	]);
});

test("unsubscribe and block are refused cross-site", async () => {
	const { env } = await environment();
	for (const path of ["emails/one-click/unsubscribe", "emails/plain/block"]) {
		const response = await app.request(`http://localhost/api/v1/mailboxes/${A}/${path}`, {
			method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "cross-site", origin: "https://evil.example" }, body: "{}",
		}, env);
		assert.equal(response.status, 403, path);
	}
});

function rawMessage(from, subject) {
	const raw = new TextEncoder().encode(`From: ${from}\r\nTo: ${A}\r\nSubject: ${subject}\r\nMessage-ID: <${subject.replace(/\W/g, "")}@example.net>\r\n\r\nHello`);
	return { rawSize: raw.length, raw: new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } }) };
}

test("a blocked sender's new mail goes to Trash, read; unblocking sends it to the Inbox again", async () => {
	const { d1, env, activity } = await environment();
	const deliver = (from, subject) => receiveEmail({ to: A, ...rawMessage(from, subject), setReject: () => {} }, env, { waitUntil: () => {} });
	const where = (subject) => d1.exec(`SELECT folder_id, read FROM messages WHERE subject = ?`, subject)[0];

	let response = await call(env, "POST", `/mailboxes/${A}/emails/plain/block`);
	assert.equal(response.status, 200);
	const blocked = await response.json();
	assert.equal(blocked.address, "ann@example.net");
	assert.equal(blocked.mailboxId, A);
	// Blocking again keeps one row.
	assert.equal((await call(env, "POST", `/mailboxes/${A}/emails/plain/block`)).status, 200);

	assert.deepEqual(await (await call(env, "GET", `/mailboxes/${A}/blocked-senders`)).json(), [{ address: "ann@example.net", createdAt: blocked.createdAt }]);
	assert.deepEqual(await (await call(env, "GET", `/blocked-senders`)).json(), [{ mailboxId: A, address: "ann@example.net", createdAt: blocked.createdAt }]);

	await deliver("Ann <Ann@Example.net>", "Blocked one");
	await deliver("bob@example.net", "Not blocked");
	assert.deepEqual(where("Blocked one"), { folder_id: "trash", read: 1 });
	assert.deepEqual(where("Not blocked"), { folder_id: "inbox", read: 0 });

	response = await call(env, "DELETE", `/mailboxes/${A}/blocked-senders/${encodeURIComponent("ann@example.net")}`);
	assert.deepEqual(await response.json(), { removed: true });
	assert.equal((await call(env, "DELETE", `/mailboxes/${A}/blocked-senders/ann@example.net`)).status, 404);
	await deliver("ann@example.net", "After unblock");
	assert.deepEqual(where("After unblock"), { folder_id: "inbox", read: 0 });

	assert.deepEqual(activity().map((r) => [r.tool, r.summary]), [
		["block_sender", "ann@example.net"],
		["block_sender", "ann@example.net"],
		["unblock_sender", "ann@example.net"],
	]);
});

test("a block is per address, and your own addresses can't be blocked", async () => {
	const { d1, env } = await environment();
	await d1.addMailboxes("b@example.com");
	assert.equal((await call(env, "POST", `/mailboxes/${A}/emails/own/block`)).status, 400);
	assert.equal((await call(env, "POST", `/mailboxes/${A}/emails/missing/block`)).status, 404);
	await call(env, "POST", `/mailboxes/${A}/emails/plain/block`);
	const other = new D1Mailbox(d1.sql, env.BUCKET, "b@example.com");
	assert.equal(await other.isBlockedSender("ann@example.net"), false);
	assert.equal(await new D1Mailbox(d1.sql, env.BUCKET, A).isBlockedSender(" ANN@example.net "), true);
});
