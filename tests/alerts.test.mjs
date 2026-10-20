import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { statements } from "./helpers/schema.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// WON-220: /health checks D1 and R2, and the hourly alert mails ALERT_TO what failed.

const A = "a@example.com";
const TO = "ops@example.net";
const T0 = Date.parse("2026-01-01T00:00:00Z");
let mf;

before(async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/alerts-worker.ts"], bundle: true, format: "esm", platform: "neutral",
		conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"], external: ["cloudflare:workers"],
		write: false, logLevel: "silent",
	});
	mf = new Miniflare({
		modules: true,
		script: bundle.outputFiles[0].text,
		compatibilityDate: "2025-11-28",
		compatibilityFlags: ["nodejs_compat"],
		bindings: { EMAIL_ADDRESSES: [A], APP_NAME: "PlaraMail" },
		r2Buckets: ["BUCKET"],
		d1Databases: ["DB"],
	});
	for (const s of statements(D1_SCHEMA)) await call("_sql", [s]);
});

after(async () => {
	await mf?.dispose();
});

async function call(op, args = [], vars = {}) {
	const response = await mf.dispatchFetch("http://test/", { method: "POST", body: JSON.stringify({ op, args, vars }) });
	const body = await response.json();
	if (body.error !== undefined) throw new Error(`${op}: ${body.error}`);
	return body.ok;
}

test("health is 200 when D1 and R2 answer, 503 naming the store that failed", async () => {
	assert.deepEqual(await call("health"), { status: 200, body: { ok: true, d1: "ok", r2: "ok" } });
	assert.deepEqual(await call("health", [], { brokenBucket: true }), { status: 503, body: { ok: false, d1: "ok", r2: "failed" } });
});

test("no ALERT_TO, no mail", async () => {
	await call("record", ["fetch", "GET /x: boom", T0]);
	assert.equal(await call("alert", [T0 + 3_600_000]), null);
	assert.deepEqual(await call("sent"), []);
});

test("the alert lists errors since the last one, once", async () => {
	await call("record", ["email", "to a@example.com: parse failed", T0 + 60_000]);
	const result = await call("alert", [T0 + 3_600_000], { ALERT_TO: TO });
	assert.equal(result.errors, 2);
	const [mail, ...rest] = await call("sent");
	assert.equal(rest.length, 0);
	assert.equal(mail.to, TO);
	assert.equal(mail.from, A);
	assert.equal(mail.subject, "PlaraMail: 2 errors");
	assert.match(mail.text, /fetch  GET \/x: boom/);
	assert.match(mail.text, /email  to a@example.com: parse failed/);

	assert.equal(await call("alert", [T0 + 7_200_000], { ALERT_TO: TO }), null, "nothing new");
	assert.deepEqual(await call("sent"), []);
});

test("a failed health check mails even with no errors recorded", async () => {
	const result = await call("alert", [T0 + 10_800_000], { ALERT_TO: TO, brokenBucket: true });
	assert.equal(result.healthy, false);
	const [mail] = await call("sent");
	assert.equal(mail.subject, "PlaraMail: health check failed");
	assert.match(mail.text, /R2 failed: R2 unreachable/);
});

test("unsent errors stop at the cap and old rows are deleted", async () => {
	for (let i = 0; i < 205; i++) await call("record", ["cron", `step ${i}`, T0]);
	const [{ n }] = await call("rows", ["SELECT COUNT(*) AS n FROM error_log WHERE alerted_at IS NULL"]);
	assert.equal(n, 200);
	const result = await call("alert", [T0 + 3_600_000], { ALERT_TO: TO });
	assert.equal(result.errors, 200);
	const [mail] = await call("sent");
	assert.match(mail.text, /… and 180 more\./);
	await call("alert", [T0 + 31 * 86_400_000], { ALERT_TO: TO });
	const [{ left }] = await call("rows", ["SELECT COUNT(*) AS left FROM error_log"]);
	assert.equal(left, 0);
});
