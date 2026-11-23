import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Scheduling and cancelling through the API. The cron that sends due mail is
// tested in cron.test.mjs.

const { app } = await loadTs("workers/index.ts");
const sched = await loadTs("workers/lib/scheduled-send.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");

const MAILBOX = "a@example.com";

// -- Route validation -------------------------------------------------

async function routeEnv() {
	const d1 = await openD1();
	const box = new D1Mailbox(d1.sql, {}, MAILBOX);
	await box.createEmail("inbox", {
		id: "o1", subject: "Lunch", sender: "bob@example.org", recipient: MAILBOX, date: new Date().toISOString(), body: "", thread_id: "t-o1",
	}, []);
	return {
		d1,
		env: { EMAIL_ADDRESSES: [MAILBOX], BUCKET: { head: async () => ({}) }, DB: d1.DB },
		scheduled: async () => d1.exec(`SELECT email_id, send_at, payload FROM scheduled_sends`).map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
	};
}

async function schedule(body, route) {
	route ??= await routeEnv();
	const response = await app.request(`http://localhost/api/v1/mailboxes/${MAILBOX}/scheduled`, {
		method: "POST",
		headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	}, route.env);
	return { status: response.status, json: await response.json() };
}

const email = (fields = {}) => ({ to: "bob@example.org", from: MAILBOX, subject: "Hi", text: "Hello", ...fields });
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

test("scheduling refuses a time in the past or under 30 seconds out", async () => {
	const route = await routeEnv();
	for (const sendAt of [new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 5_000).toISOString()]) {
		const { status, json } = await schedule({ sendAt, mode: "new", email: email() }, route);
		assert.equal(status, 400);
		assert.match(json.error, /30 seconds/);
	}
	const tooFar = await schedule({ sendAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), mode: "new", email: email() }, route);
	assert.equal(tooFar.status, 400);
	assert.match(tooFar.json.error, /366 days/);
	assert.deepEqual(await route.scheduled(), []);
});

test("scheduling validates the sender, the mode and the payload size", async () => {
	const route = await routeEnv();
	const wrongSender = await schedule({ sendAt: inMinutes(10), mode: "new", email: email({ from: "c@example.net" }) }, route);
	assert.equal(wrongSender.status, 400);
	assert.match(wrongSender.json.error, /From address/);

	const noOriginal = await schedule({ sendAt: inMinutes(10), mode: "reply", email: email() }, route);
	assert.equal(noOriginal.status, 400);
	assert.match(noOriginal.json.error, /original_id/);

	const big = await schedule({ sendAt: inMinutes(10), mode: "new", email: email({ text: "x".repeat(1_600_000) }) }, route);
	assert.equal(big.status, 413);
	assert.deepEqual(await route.scheduled(), []);
});

test("scheduling refuses more than 50 recipients, as sending does", async () => {
	const route = await routeEnv();
	const people = (n, at) => Array.from({ length: n }, (_, i) => `p${i}@${at}`);
	const tooMany = await schedule({
		sendAt: inMinutes(10), mode: "new", email: email({ to: people(40, "example.org"), cc: people(11, "example.net") }),
	}, route);
	assert.equal(tooMany.status, 400);
	assert.match(tooMany.json.error, /Too many recipients: max 50 per message/);
	assert.deepEqual(await route.scheduled(), []);
	const fifty = await schedule({ sendAt: inMinutes(10), mode: "new", email: email({ to: people(50, "example.org") }) }, route);
	assert.equal(fifty.status, 201);
});

test("a valid schedule reaches the mailbox and answers 201", async () => {
	const route = await routeEnv();
	const sendAt = inMinutes(60);
	const { status, json } = await schedule({ sendAt, mode: "reply-all", original_id: "o1", email: email() }, route);
	assert.equal(status, 201);
	assert.equal(json.sendAt, sendAt);
	const [row] = await route.scheduled();
	assert.equal(row.email_id, json.id);
	assert.equal(row.payload.mode, "reply-all");
	assert.equal(row.payload.original_id, "o1");
	assert.equal(route.d1.exec(`SELECT thread_id FROM messages WHERE email_id = ?`, json.id)[0].thread_id, "t-o1", "the draft joins the thread");
	assert.equal((await schedule({ sendAt, mode: "reply", original_id: "missing", email: email() }, route)).status, 404);
});

test("cancel answers cancelled or 404", async () => {
	const route = await routeEnv();
	const { json } = await schedule({ sendAt: inMinutes(60), mode: "new", email: email() }, route);
	const cancel = (id) => app.request(`http://localhost/api/v1/mailboxes/${MAILBOX}/scheduled/${id}`, {
		method: "DELETE", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
	}, route.env);
	const known = await cancel(json.id);
	assert.equal(known.status, 200);
	assert.deepEqual(await known.json(), { status: "cancelled" });
	assert.deepEqual(await route.scheduled(), []);
	assert.equal((await cancel("missing")).status, 404);
});

test("stored modes map to the send path", () => {
	assert.deepEqual(sched.sendModeOf({ mode: "new" }), { kind: "new" });
	assert.deepEqual(sched.sendModeOf({ mode: "reply-all", original_id: "o" }), { kind: "reply", originalId: "o" });
	assert.deepEqual(sched.sendModeOf({ mode: "reply", original_id: "o" }), { kind: "reply", originalId: "o" });
	assert.deepEqual(sched.sendModeOf({ mode: "forward", original_id: "o" }), { kind: "forward", originalId: "o" });
});

test("the scheduled list spans configured mailboxes, soonest first", async () => {
	const d1 = await openD1();
	await d1.addMailboxes("a@example.com", "b@example.com", "c@example.com");
	const draft = async (mailbox, id, sendAt, attempts = 0, error = null) => {
		await new D1Mailbox(d1.sql, {}, mailbox).createEmail("draft", { id, subject: "s", sender: mailbox, recipient: "x@example.org", date: sendAt, body: "", thread_id: id }, []);
		d1.exec(`INSERT INTO scheduled_sends (email_id, mailbox_id, send_at, payload, attempts, error) VALUES (?, ?, ?, '{}', ?, ?)`, id, mailbox, sendAt, attempts, error);
	};
	await draft("a@example.com", "a1", "2026-10-12T09:00:00.000Z");
	await draft("b@example.com", "b1", "2026-10-11T09:00:00.000Z", 3, "Rate limit exceeded");
	await draft("c@example.com", "c1", "2026-10-10T09:00:00.000Z");
	const env = { EMAIL_ADDRESSES: ["a@example.com", "b@example.com"], BUCKET: {}, DB: d1.DB };
	const response = await app.request("http://localhost/api/v1/mail/scheduled", {}, env);
	assert.deepEqual(await response.json(), [
		{ mailboxId: "b@example.com", emailId: "b1", sendAt: "2026-10-11T09:00:00.000Z", error: "Rate limit exceeded" },
		{ mailboxId: "a@example.com", emailId: "a1", sendAt: "2026-10-12T09:00:00.000Z", error: null },
	]);
});
