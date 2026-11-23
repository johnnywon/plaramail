import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { statements } from "./helpers/schema.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// The one-minute cron sends scheduled mail.

const A = "a@example.com";
const SCHEMA = D1_SCHEMA;
const T0 = Date.parse("2026-01-01T00:00:00Z");
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
		bindings: { EMAIL_ADDRESSES: [A] },
		r2Buckets: ["BUCKET"],
		d1Databases: ["DB"],
	});
	for (const s of statements(SCHEMA)) await call("_sql", s);
	await call("register", A);
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

async function schedule(subject, sendAt) {
	const result = await call("scheduleSend", A, {
		sendAt: new Date(sendAt).toISOString(), mode: "new",
		email: { to: "c@example.net", from: A, subject, html: `<p>${subject}</p>` },
	});
	assert.ok(result.id, JSON.stringify(result));
	return result.id;
}

const rows = (sql) => call("rows", sql);

test("a due message sends once, even with two runs at the same time", async () => {
	const due = await schedule("due", T0 + 60_000);
	const later = await schedule("later", T0 + 3_600_000);
	const [first, second] = await call("cron", T0 + 90_000, T0 + 90_000);
	assert.deepEqual([...first.scheduled.sent, ...second.scheduled.sent], [due]);
	const sent = await call("sent");
	assert.equal(sent.length, 1);
	assert.equal(sent[0].subject, "due");
	assert.equal(await call("getEmail", A, due), null, "the draft is gone");
	assert.equal((await rows(`SELECT count(*) AS n FROM messages WHERE folder_id = 'sent' AND subject = 'due'`))[0].n, 1, "a copy is in Sent");
	assert.deepEqual((await call("listScheduled", A)).map((r) => r.emailId), [later], "the later one waits");
	assert.deepEqual((await call("cron", T0 + 120_000))[0].scheduled, { sent: [], failed: [] });
});

test("a failed send retries in 15 minutes and stops after three attempts", async () => {
	await call("cancelScheduled", A, (await call("listScheduled", A))[0].emailId);
	const id = await schedule("flaky", T0 + 60_000);
	await call("fail", true);
	try {
		let now = T0 + 60_000;
		for (let attempt = 1; attempt <= 3; attempt++) {
			assert.deepEqual((await call("cron", now))[0].scheduled.failed, [id], `attempt ${attempt}`);
			const [row] = await call("listScheduled", A);
			assert.equal(row.attempts, attempt);
			assert.match(row.error, /binding down/);
			if (attempt < 3) {
				assert.equal(row.sendAt, new Date(now + 15 * 60_000).toISOString());
				assert.deepEqual((await call("cron", now + 60_000))[0].scheduled.failed, [], "not before the retry time");
				now += 15 * 60_000;
			}
		}
		assert.deepEqual((await call("cron", now + 3_600_000))[0].scheduled, { sent: [], failed: [] }, "no fourth attempt");
		assert.ok(await call("getEmail", A, id), "the draft stays for the user to fix");
	} finally {
		await call("fail", false);
	}
	assert.deepEqual(await call("sent"), []);
	await call("cancelScheduled", A, id);
});

test("a send that may have gone out is not retried", async () => {
	const id = await schedule("timeout", T0 + 60_000);
	await call("fail", "unknown");
	try {
		assert.deepEqual((await call("cron", T0 + 60_000))[0].scheduled.failed, [id]);
		const [row] = await call("listScheduled", A);
		assert.equal(row.attempts, 3, "no attempts left");
		assert.match(row.error, /binding timed out/);
		assert.deepEqual((await call("cron", T0 + 3_600_000))[0].scheduled, { sent: [], failed: [] }, "no retry");
		const [key] = await rows(`SELECT state, error FROM send_keys WHERE key = 'draft:${id}'`);
		assert.deepEqual(key, { state: "sending", error: "binding timed out" });
	} finally {
		await call("fail", false);
	}
	assert.equal((await call("sent")).length, 1, "delivered once");
	await call("cancelScheduled", A, id);
});

test("deleting the draft drops its schedule", async () => {
	const id = await schedule("deleted", T0 + 60_000);
	await call("deleteEmail", A, id);
	assert.deepEqual(await call("listScheduled", A), []);
	assert.deepEqual((await call("cron", T0 + 90_000))[0].scheduled.sent, []);
	assert.deepEqual(await call("sent"), []);
});

test("a stale claim from a run that died is taken over", async () => {
	const id = await schedule("stale", T0 + 60_000);
	await call("_sql", `UPDATE scheduled_sends SET claimed_at = '${new Date(T0 + 61_000).toISOString()}' WHERE email_id = '${id}'`);
	assert.deepEqual((await call("cron", T0 + 120_000))[0].scheduled.sent, [], "a fresh claim is left alone");
	assert.deepEqual((await call("cron", T0 + 61_000 + 10 * 60_000 + 1))[0].scheduled.sent, [id]);
	assert.equal((await call("sent")).length, 1);
});
