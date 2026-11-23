import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { statements } from "./helpers/schema.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// End to end in local workerd: a scheduled send waits as a draft and the cron sends it.

const MAILBOX = "a@example.com";
let mf;

before(async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/cron-worker.ts"], bundle: true, format: "esm", platform: "neutral",
		conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"], external: ["cloudflare:workers"],
		write: false, logLevel: "silent",
	});
	mf = new Miniflare({
		modules: true,
		script: bundle.outputFiles[0].text,
		compatibilityDate: "2025-11-28",
		compatibilityFlags: ["nodejs_compat"],
		bindings: { EMAIL_ADDRESSES: [MAILBOX] },
		r2Buckets: ["BUCKET"],
		d1Databases: ["DB"],
	});
	for (const s of statements(D1_SCHEMA)) await call("_sql", s);
	await call("register", MAILBOX);
});

after(async () => {
	await mf?.dispose();
});

async function call(op, ...args) {
	const response = await mf.dispatchFetch("http://test/", { method: "POST", body: JSON.stringify({ op, args }) });
	const body = await response.json();
	if (body.error !== undefined) throw new Error(`${op}: ${body.error}`);
	return body.ok;
}

const ok = (op, ...args) => call(op, MAILBOX, ...args);
const cron = async () => (await call("cron", Date.now()))[0];

const message = (fields = {}) => ({
	to: "bob@example.org", from: MAILBOX, subject: "Later", html: "<p>Sent later</p>", ...fields,
});

test("the cron sends a due scheduled message and deletes its draft", async () => {
	// A pending send far in the future stays put.
	const later = await ok("scheduleSend", {
		sendAt: new Date(Date.now() + 3_600_000).toISOString(), mode: "new", email: message({ subject: "Next hour" }),
	});
	// The store trusts the route's validation, so a past time is due at once.
	const due = await ok("scheduleSend", {
		sendAt: new Date(Date.now() - 1_000).toISOString(), mode: "new", email: message(),
	});
	assert.equal((await ok("getEmail", due.id)).folder_id, "draft");

	assert.deepEqual((await cron()).scheduled.sent, [due.id]);
	assert.equal(await ok("getEmail", due.id), null);
	const sent = await ok("getEmails", { folder: "sent" });
	assert.deepEqual(sent.map((e) => e.subject), ["Later"]);
	assert.equal(sent[0].recipient, "bob@example.org");
	assert.equal((await call("sent")).length, 1);
	// The cron sends under the draft's key, so the UI or agent sending the same draft gets the first send back.
	assert.deepEqual(await ok("claimSendKey", `draft:${due.id}`), { state: "sent", id: sent[0].id });

	const pending = await ok("listScheduled");
	assert.deepEqual(pending.map((row) => row.emailId), [later.id]);
	assert.equal((await ok("getEmail", later.id)).folder_id, "draft");
	assert.equal(await ok("cancelScheduled", later.id), true);
});

test("replacing a draft and cancelling a schedule", async () => {
	const first = await ok("scheduleSend", {
		sendAt: new Date(Date.now() + 3_600_000).toISOString(), mode: "new", email: message({ subject: "v1" }),
	});
	const second = await ok("scheduleSend", {
		sendAt: new Date(Date.now() + 3_600_000).toISOString(), draftId: first.id, mode: "new", email: message({ subject: "v2" }),
	});
	assert.equal(await ok("getEmail", first.id), null);
	assert.equal((await ok("getEmail", second.id)).subject, "v2");
	assert.ok(!(await ok("listScheduled")).some((row) => row.emailId === first.id));

	assert.equal(await ok("cancelScheduled", second.id), true);
	assert.equal(await ok("cancelScheduled", second.id), false);
	assert.equal((await ok("getEmail", second.id)).folder_id, "draft");
});

test("a scheduled reply threads with the original", async () => {
	const original = {
		id: "orig-1", subject: "Question", sender: "bob@example.org", recipient: MAILBOX, date: new Date().toISOString(),
		body: "<p>?</p>", thread_id: "thread-1", message_id: "orig-1@example.org",
	};
	await ok("createEmail", "inbox", original, []);
	const draft = await ok("scheduleSend", {
		sendAt: new Date(Date.now() - 1_000).toISOString(), mode: "reply", originalId: original.id,
		email: message({ subject: "Re: Question" }),
	});
	const stored = await ok("getEmail", draft.id);
	assert.equal(stored.thread_id, "thread-1");
	assert.equal(stored.in_reply_to, "orig-1");

	assert.deepEqual((await cron()).scheduled.sent, [draft.id]);
	const thread = await ok("getThreadEmails", "thread-1");
	const reply = thread.find((e) => e.folder_id === "sent");
	assert.equal(reply.in_reply_to, "orig-1@example.org");
	assert.equal(thread.find((e) => e.id === "orig-1").read, true);
});
