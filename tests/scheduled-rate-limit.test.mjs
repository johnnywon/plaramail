import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// A scheduled send refused by the hourly or daily limit waits for the limit
// instead of using up its attempts.

const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const { sendDueScheduled } = await loadTs("workers/store/d1/scheduled.ts");
const { SCHEDULE_MAX_ATTEMPTS, SCHEDULE_RETRY_MS } = await loadTs("workers/lib/scheduled-send.ts");

const MAILBOX = "a@example.com";

test("a scheduled send refused by the rate limit keeps its attempts and sends once the limit frees", async () => {
	const d1 = await openD1();
	await d1.addMailboxes(MAILBOX);
	const BUCKET = { put: async () => {}, get: async () => null, delete: async () => {} };
	const box = new D1Mailbox(d1.sql, BUCKET, MAILBOX);
	const sent = [];
	const env = { BUCKET, EMAIL: { send: async (m) => { sent.push(m); return { messageId: "p" }; } } };

	// The hourly limit is used up.
	for (let i = 0; i < 20; i++) assert.equal((await box.takeSendBudget("person", 1)).ok, true);
	const t0 = Date.now();
	const { id } = await box.scheduleSend({
		sendAt: new Date(t0 - 1000).toISOString(), mode: "new",
		email: { to: "bob@example.org", from: MAILBOX, subject: "S", text: "x" },
	});

	// More cron runs than there are attempts, all while the limit is full.
	for (let run = 0; run < SCHEDULE_MAX_ATTEMPTS + 2; run++) {
		const now = t0 + run * SCHEDULE_RETRY_MS + 1000;
		const { failed } = await sendDueScheduled(env, d1.sql, now);
		assert.deepEqual(failed, [id]);
		const row = d1.exec(`SELECT attempts, error, send_at FROM scheduled_sends WHERE email_id = ?`, id)[0];
		assert.equal(row.attempts, 0, "a rate limit refusal is not a failed attempt");
		assert.match(row.error, /Rate limit exceeded/);
		assert.equal(row.send_at, new Date(now + SCHEDULE_RETRY_MS).toISOString());
	}
	assert.equal(sent.length, 0);

	// The window frees up and the next run sends it.
	d1.exec(`DELETE FROM send_budget`);
	const later = t0 + (SCHEDULE_MAX_ATTEMPTS + 2) * SCHEDULE_RETRY_MS + 1000;
	assert.deepEqual((await sendDueScheduled(env, d1.sql, later)).sent, [id]);
	assert.equal(sent.length, 1);
	assert.deepEqual(d1.exec(`SELECT * FROM scheduled_sends`), []);
});
