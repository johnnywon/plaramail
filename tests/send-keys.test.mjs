import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

const keys = await loadTs("workers/lib/send-keys.ts");
const { sendMail } = await loadTs("workers/lib/send.ts");
const { automatedMailReason } = await loadTs("workers/lib/message-meta.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");

const MAILBOX = "a@example.com";

async function keyStore(mailboxId = MAILBOX) {
	const d1 = await openD1();
	return { d1, box: new D1Mailbox(d1.sql, {}, mailboxId), other: new D1Mailbox(d1.sql, {}, "b@example.org") };
}

// -- Key table ---------------------------------------------------------

test("a key is claimed once, then reports the send that used it", async () => {
	const { box } = await keyStore();
	assert.deepEqual(await box.claimSendKey("k1"), { state: "new" });
	assert.deepEqual(await box.claimSendKey("k1"), { state: "pending", providerId: null });
	await box.finishSendKey("k1", "email-1");
	assert.deepEqual(await box.claimSendKey("k1"), { state: "sent", id: "email-1" });
});

test("keys belong to one mailbox", async () => {
	const { box, other } = await keyStore();
	await box.claimSendKey("k1");
	await box.finishSendKey("k1", "email-1");
	assert.deepEqual(await other.claimSendKey("k1"), { state: "new" });
});

test("a failed key can be claimed again; a sent key cannot be failed", async () => {
	const { box } = await keyStore();
	await box.claimSendKey("k1");
	await box.failSendKey("k1", "refused");
	assert.deepEqual(await box.claimSendKey("k1"), { state: "new" });
	await box.finishSendKey("k1", "email-1");
	await box.failSendKey("k1", "refused");
	assert.deepEqual(await box.claimSendKey("k1"), { state: "sent", id: "email-1" });
});

test("keys expire after a week", async () => {
	const { d1, box } = await keyStore();
	const old = new Date(Date.now() - keys.SEND_KEY_TTL_MS - 60_000).toISOString();
	d1.exec(`INSERT INTO send_keys (mailbox_id, key, state, email_id, created_at) VALUES (?, 'old', 'sent', 'email-1', ?)`, MAILBOX, old);
	assert.deepEqual(await box.claimSendKey("old"), { state: "new" });
});

test("checkSendKey refuses empty and overlong keys", () => {
	assert.equal(keys.checkSendKey("abc"), null);
	assert.match(keys.checkSendKey("  "), /empty/);
	assert.match(keys.checkSendKey("x".repeat(keys.SEND_KEY_MAX_LENGTH + 1)), /longer/);
});

// -- sendMail with a key -------------------------------------------------

async function harness({ rateLimit = null, failDelivery = 0, failStore = 0 } = {}) {
	const { box } = await keyStore();
	const delivered = [];
	const stored = [];
	const env = {
		EMAIL: {
			send: async (message) => {
				if (failDelivery > 0) { failDelivery--; throw Object.assign(new Error("delivery down"), { code: "E_RECIPIENT_SUPPRESSED" }); }
				delivered.push(message);
				return { messageId: `m${delivered.length}` };
			},
		},
		BUCKET: { put: async () => {} },
	};
	const stub = {
		getEmail: async () => null,
		createEmail: async (_folder, email) => {
			if (failStore > 0) { failStore--; throw new Error("storage down"); }
			stored.push(email);
		},
		markThreadRead: async () => {},
		takeSendBudget: async (actor, n) => (rateLimit ? { ok: false, error: rateLimit } : box.takeSendBudget(actor, n)),
		refundSendBudget: (id) => box.refundSendBudget(id),
		claimSendKey: (key, hash) => box.claimSendKey(key, hash),
		startSendKey: (key) => box.startSendKey(key),
		recordSendProvider: (key, id, error) => box.recordSendProvider(key, id, error),
		finishSendKey: (key, id) => box.finishSendKey(key, id),
		failSendKey: (key, error) => box.failSendKey(key, error),
	};
	const send = (key) =>
		sendMail(env, MAILBOX, stub, { to: "bob@example.org", from: MAILBOX, subject: "Hi", text: "Hello" }, { kind: "new" }, { idempotencyKey: key });
	return { send, delivered, stored, box };
}

test("the same key sends once and returns the first send's id", async () => {
	const h = await harness();
	const first = await h.send("k1");
	const second = await h.send("k1");
	assert.equal(first.ok, true);
	assert.deepEqual(second, { ok: true, id: first.id, duplicate: true });
	assert.equal(h.delivered.length, 1);
	assert.equal(h.stored.length, 1);
	assert.equal((await h.send("k2")).ok, true);
	assert.equal(h.delivered.length, 2);
});

test("a refused send fails its key, so it can be used again", async () => {
	const h = await harness({ rateLimit: "Rate limit exceeded" });
	assert.equal((await h.send("k1")).status, 429);
	assert.deepEqual(await h.box.claimSendKey("k1"), { state: "new" });
});

test("a failed delivery releases its key so a retry sends", async () => {
	const h = await harness({ failDelivery: 1 });
	await assert.rejects(h.send("k1"), /delivery down/);
	assert.equal((await h.send("k1")).ok, true);
	assert.equal(h.delivered.length, 1);
});

test("a send that delivered but did not store keeps its key, and a retry is refused", async () => {
	const h = await harness({ failStore: 1 });
	await assert.rejects(h.send("k1"), /storage down/);
	const retry = await h.send("k1");
	assert.equal(retry.ok, false);
	assert.equal(retry.status, 409);
	assert.equal(h.delivered.length, 1);
});

// -- Auto-draft guard ------------------------------------------------------

const headers = (pairs) => JSON.stringify(Object.entries(pairs).map(([key, value]) => ({ key, value })));

test("automatedMailReason flags lists, bulk, auto-replies and no-reply senders", () => {
	assert.equal(automatedMailReason(headers({ "auto-submitted": "auto-replied" }), "bob@example.org"), "Auto-Submitted: auto-replied");
	assert.equal(automatedMailReason(headers({ precedence: "bulk" }), "bob@example.org"), "Precedence: bulk");
	assert.equal(automatedMailReason(headers({ "list-id": "<news.example.org>" }), "bob@example.org"), "List-Id");
	assert.equal(automatedMailReason(headers({ "list-unsubscribe": "<https://example.org/u>" }), "bob@example.org"), "List-Unsubscribe");
	assert.equal(automatedMailReason(headers({ "x-autoreply": "yes" }), "bob@example.org"), "x-autoreply");
	assert.equal(automatedMailReason(headers({}), "no-reply@example.org"), "sender no-reply@example.org");
	assert.equal(automatedMailReason(headers({}), "MAILER-DAEMON@example.org"), "sender mailer-daemon@example.org");
	assert.equal(automatedMailReason(headers({}), "noreply+tag@example.org"), "sender noreply+tag@example.org");
});

test("automatedMailReason passes mail a person sent", () => {
	assert.equal(automatedMailReason(headers({ "auto-submitted": "no", precedence: "first-class" }), "bob@example.org"), null);
	assert.equal(automatedMailReason(headers({ subject: "Lunch?" }), "replyguy@example.org"), null);
	assert.equal(automatedMailReason(null, "bob@example.org"), null);
});
