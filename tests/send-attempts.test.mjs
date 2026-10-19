import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Send attempts (WON-206): pending -> sending -> sent or failed, keyed by idempotency key.

const { sendMail } = await loadTs("workers/lib/send.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");

const MAILBOX = "a@example.com";

const rejected = () => Object.assign(new Error("delivery down"), { code: "E_RECIPIENT_SUPPRESSED" });

async function harness({ failDelivery = 0, failStore = 0, hold = null, deliveryError = rejected } = {}) {
	const d1 = await openD1();
	const box = new D1Mailbox(d1.sql, {}, MAILBOX);
	const delivered = [];
	const stored = [];
	const moved = [];
	const row = (key) => d1.exec(`SELECT state, provider_id, email_id, error FROM send_keys WHERE key = ?`, key)[0];
	const env = {
		EMAIL: {
			send: async (message) => {
				if (hold) await hold;
				if (failDelivery > 0) { failDelivery--; throw deliveryError(); }
				delivered.push(message);
				return { messageId: `provider-${delivered.length}` };
			},
		},
		BUCKET: { put: async () => {} },
	};
	const stub = Object.assign(Object.create(box), {
		getEmail: async () => null,
		markThreadRead: async () => {},
		moveEmail: async (id, folder) => { moved.push({ id, folder }); return true; },
		createEmail: async (_folder, email) => {
			stored.push({ email, attempt: row(currentKey) });
			if (failStore > 0) { failStore--; throw new Error("storage down"); }
		},
	});
	for (const name of ["takeSendBudget", "refundSendBudget", "claimSendKey", "startSendKey", "recordSendProvider", "finishSendKey", "failSendKey"]) {
		stub[name] = box[name].bind(box);
	}
	let currentKey = null;
	const send = (key, fields = {}, options = {}) => {
		currentKey = key;
		return sendMail(env, MAILBOX, stub, { to: "bob@example.org", from: MAILBOX, subject: "Hi", text: "Hello", ...fields }, { kind: "new" }, { idempotencyKey: key, ...options });
	};
	return { d1, box, env, stub, send, delivered, stored, moved, row };
}

test("an attempt goes pending, sending, sent", async () => {
	const { box, row } = await harness();
	assert.deepEqual(await box.claimSendKey("k1", "h1"), { state: "new" });
	assert.equal(row("k1").state, "pending");
	assert.equal(await box.startSendKey("k1"), true);
	assert.equal(row("k1").state, "sending");
	await box.recordSendProvider("k1", "provider-9");
	await box.finishSendKey("k1", "email-1");
	assert.deepEqual(row("k1"), { state: "sent", provider_id: "provider-9", email_id: "email-1", error: null });
});

test("only one caller can start an attempt", async () => {
	const { box } = await harness();
	await box.claimSendKey("k1", "h1");
	const starts = await Promise.all([box.startSendKey("k1"), box.startSendKey("k1"), box.startSendKey("k1")]);
	assert.deepEqual(starts.filter(Boolean).length, 1);
});

test("the provider message ID is saved before the Sent copy", async () => {
	const h = await harness();
	const result = await h.send("k1");
	assert.equal(result.ok, true);
	assert.equal(h.stored.length, 1);
	assert.equal(h.stored[0].attempt.state, "sending");
	assert.equal(h.stored[0].attempt.provider_id, "provider-1");
	assert.equal(h.row("k1").state, "sent");
});

test("the same key with a different message is a conflict and sends nothing", async () => {
	const h = await harness();
	assert.equal((await h.send("k1")).ok, true);
	const reused = await h.send("k1", { subject: "Something else" });
	assert.equal(reused.ok, false);
	assert.equal(reused.status, 409);
	assert.match(reused.error, /different message/);
	assert.equal(h.delivered.length, 1);
	// The same message again is a duplicate, not a conflict.
	assert.equal((await h.send("k1")).duplicate, true);
});

test("a send left in sending returns its status instead of sending again", async () => {
	const h = await harness({ failStore: 1 });
	await assert.rejects(h.send("k1"), /storage down/);
	assert.equal(h.row("k1").state, "sending");
	const retry = await h.send("k1");
	assert.equal(retry.ok, false);
	assert.equal(retry.status, 409);
	assert.deepEqual(retry.attempt, { state: "sending", providerId: "provider-1" });
	assert.equal(h.delivered.length, 1);
});

test("a failed delivery marks the attempt failed, and a retry may change the message", async () => {
	const h = await harness({ failDelivery: 1 });
	await assert.rejects(h.send("k1"), /delivery down/);
	assert.equal(h.row("k1").state, "failed");
	assert.equal(h.row("k1").error, "delivery down");
	const retry = await h.send("k1", { subject: "Fixed" });
	assert.equal(retry.ok, true);
	assert.equal(h.delivered.length, 1);
	assert.equal(h.delivered[0].subject, "Fixed");
});

test("a delivery error that doesn't prove rejection leaves the attempt in sending", async () => {
	const h = await harness({ failDelivery: 1, deliveryError: () => new Error("timed out") });
	await assert.rejects(h.send("k1"), /timed out/);
	assert.deepEqual(h.row("k1"), { state: "sending", provider_id: null, email_id: null, error: "timed out" });
	assert.equal(h.d1.exec(`SELECT COUNT(*) AS n FROM send_budget`)[0].n, 1, "the slot is kept");
	const retry = await h.send("k1");
	assert.equal(retry.status, 409);
	assert.equal(retry.attempt.state, "sending");
});

test("a pending attempt whose caller died can be claimed again after a few minutes", async () => {
	const h = await harness();
	await h.box.claimSendKey("k1", "h1");
	assert.equal((await h.send("k1")).status, 409, "a fresh pending attempt blocks");
	h.d1.exec(`UPDATE send_keys SET updated_at = ? WHERE key = 'k1'`, new Date(Date.now() - 6 * 60_000).toISOString());
	const retry = await h.send("k1");
	assert.equal(retry.ok, true);
	assert.equal(h.delivered.length, 1);
	assert.equal(h.row("k1").state, "sent");
});

test("a stale sending attempt is never claimed again", async () => {
	const h = await harness({ failStore: 1 });
	await assert.rejects(h.send("k1"), /storage down/);
	h.d1.exec(`UPDATE send_keys SET updated_at = ? WHERE key = 'k1'`, new Date(Date.now() - 60 * 60_000).toISOString());
	assert.equal((await h.send("k1")).status, 409);
	assert.equal(h.delivered.length, 1);
});

test("a deferred delivery records the provider ID when it finishes", async () => {
	const h = await harness();
	let delivery;
	const result = await h.send("k1", {}, { defer: (p) => { delivery = p; } });
	assert.equal(result.ok, true);
	await delivery;
	assert.deepEqual(h.row("k1"), { state: "sent", provider_id: "provider-1", email_id: result.id, error: null });
});

test("a deferred send stays sending until delivery finishes", async () => {
	let release;
	const h = await harness({ hold: new Promise((r) => { release = r; }) });
	let delivery;
	await h.send("k1", {}, { defer: (p) => { delivery = p; } });
	assert.equal(h.row("k1").state, "sending");
	const retry = await h.send("k1");
	assert.equal(retry.status, 409);
	release();
	await delivery;
	assert.equal(h.row("k1").state, "sent");
	assert.equal(h.delivered.length, 1);
});

test("a failed deferred delivery fails the key, refunds the budget and moves the copy to Drafts", async () => {
	const h = await harness({ failDelivery: 1 });
	let delivery;
	const result = await h.send("k1", {}, { defer: (p) => { delivery = p; } });
	assert.equal(result.ok, true);
	await delivery;
	assert.equal(h.row("k1").state, "failed");
	assert.equal(h.row("k1").error, "delivery down");
	assert.deepEqual(h.moved, [{ id: result.id, folder: "draft" }]);
	assert.equal(h.d1.exec(`SELECT COUNT(*) AS n FROM send_budget`)[0].n, 0);
	// The key can be used again, and this time the message goes out.
	const retry = await h.send("k1", {}, { defer: (p) => { delivery = p; } });
	assert.equal(retry.ok, true);
	assert.notEqual(retry.duplicate, true);
	await delivery;
	assert.equal(h.delivered.length, 1);
	assert.equal(h.row("k1").state, "sent");
});

test("a deferred delivery error that doesn't prove rejection keeps the Sent copy and the attempt", async () => {
	const h = await harness({ failDelivery: 1, deliveryError: () => new Error("timed out") });
	let delivery;
	const result = await h.send("k1", {}, { defer: (p) => { delivery = p; } });
	await delivery;
	assert.deepEqual(h.row("k1"), { state: "sending", provider_id: null, email_id: null, error: "timed out" });
	assert.deepEqual(h.moved, []);
	assert.equal(h.d1.exec(`SELECT COUNT(*) AS n FROM send_budget`)[0].n, 1);
	assert.equal((await h.send("k1")).status, 409);
	assert.equal(result.ok, true);
});

test("a deferred send whose Sent copy fails to store fails the key and refunds the budget", async () => {
	const h = await harness({ failStore: 1 });
	await assert.rejects(h.send("k1", {}, { defer: () => {} }), /storage down/);
	assert.equal(h.row("k1").state, "failed");
	assert.equal(h.delivered.length, 0);
	assert.equal(h.d1.exec(`SELECT COUNT(*) AS n FROM send_budget`)[0].n, 0);
});

test("a reclaimed failed key starts a new seven days (WON-243)", async () => {
	const h = await harness({ failDelivery: 1 });
	await assert.rejects(h.send("k1"), /delivery down/);
	const old = new Date(Date.now() - 6.9 * 86_400_000).toISOString();
	h.d1.exec(`UPDATE send_keys SET created_at = ? WHERE key = 'k1'`, old);
	assert.equal((await h.send("k1")).ok, true);
	const { created_at } = h.d1.exec(`SELECT created_at FROM send_keys WHERE key = 'k1'`)[0];
	assert.ok(Date.parse(created_at) > Date.now() - 60_000, "created_at reset on reclaim");
	// Another key's claim prunes old keys; the reclaimed one stays, so a retry is still a duplicate.
	h.d1.exec(`UPDATE send_keys SET created_at = ? WHERE key = 'k1'`, new Date(Date.parse(created_at) - 0.2 * 86_400_000).toISOString());
	await h.box.claimSendKey("k2", "h2");
	assert.equal((await h.send("k1")).duplicate, true);
	assert.equal(h.delivered.length, 1);
});

test("the HTTP send route returns the open attempt with a 409 (WON-243)", async () => {
	const { handleSendEmail } = await loadTs("workers/routes/reply-forward.ts");
	const h = await harness({ failDelivery: 1, deliveryError: () => new Error("timed out") });
	await assert.rejects(h.send("k1"), /timed out/);
	const c = {
		env: h.env,
		var: { mailbox: h.stub },
		executionCtx: { waitUntil: () => {} },
		req: {
			param: (name) => (name === "mailboxId" ? MAILBOX : undefined),
			json: async () => ({ to: "bob@example.org", from: MAILBOX, subject: "Hi", text: "Hello" }),
			header: (name) => (name === "idempotency-key" ? "k1" : undefined),
		},
		json: (body, status) => ({ body, status }),
	};
	const res = await handleSendEmail(c);
	assert.equal(res.status, 409);
	assert.deepEqual(res.body.attempt, { state: "sending", providerId: null });
	assert.ok(res.body.error);
});

test("attachments reach the mail binding as the file's bytes, not base64 text (#28)", async () => {
	const h = await harness();
	const file = Uint8Array.from([..."plain text attachment for issue 28\n"].map((c) => c.charCodeAt(0)).concat([0, 0xff, 0x80]));
	const content = Buffer.from(file).toString("base64");
	const result = await h.send("k1", { attachments: [{ content, filename: "note.bin", type: "application/octet-stream", disposition: "attachment" }] });
	assert.equal(result.ok, true);
	const [sent] = h.delivered[0].attachments;
	assert.ok(sent.content instanceof Uint8Array);
	assert.deepEqual([...sent.content], [...file]);
	assert.equal(sent.filename, "note.bin");
});
