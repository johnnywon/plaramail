import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// The figures system (shared/figures.ts): six characters at most, a unit that steps up instead of growing.

const f = await loadTs("shared/figures.ts");
const show = (x) => (x ? `${x.fig} ${x.unit}` : null);
const H = 3600, D = 24 * H, W = 7 * D;

test("counts step from commas to k to M, and the unit agrees with the value", () => {
	const msg = (n) => show(f.countFigure(n, "EMAIL", "EMAILS"));
	assert.equal(msg(1), "1 EMAIL");
	assert.equal(msg(0), "0 EMAILS");
	assert.equal(msg(12408), "12,408 EMAILS");
	assert.equal(msg(99999), "99,999 EMAILS");
	assert.equal(msg(248190), "248k EMAILS");
	assert.equal(msg(2418330), "2.4M EMAILS");
	assert.equal(msg(24183300), "24M EMAILS");
	assert.equal(msg(null), null);
	assert.equal(msg(Number.NaN), null);
});

test("bytes use decimal units and keep three significant figures", () => {
	assert.equal(show(f.bytesFigure(412e6)), "412 MB");
	assert.equal(show(f.bytesFigure(1.394e9)), "1.39 GB");
	assert.equal(show(f.bytesFigure(48.6e9)), "48.6 GB");
	assert.equal(show(f.bytesFigure(1284e9)), "1.28 TB");
	assert.equal(show(f.bytesFigure(52e3)), "52 KB");
	assert.equal(show(f.bytesFigure(600e3)), "600 KB");
	assert.equal(show(f.bytesFigure(0)), "0 KB");
});

test("bytes step up a unit instead of rounding to 1000 or a fourth digit", () => {
	const b = (n) => show(f.bytesFigure(n));
	assert.equal(b(999.4e3), "999 KB");
	assert.equal(b(999.6e3), "1 MB");
	assert.equal(b(999.4e6), "999 MB");
	assert.equal(b(999.6e6), "1.00 GB");
	assert.equal(b(9.994e9), "9.99 GB");
	assert.equal(b(9.996e9), "10.0 GB");
	assert.equal(b(99.96e9), "100 GB");
	assert.equal(b(999.6e9), "1.00 TB");
	assert.equal(b(9.996e12), "10.0 TB");
	assert.equal(b(999.6e12), "1.00 PB");
	assert.equal(b(null), null);
});

test("uptime moves from minutes to hours, days, weeks, months and years, rounding down", () => {
	const up = (s) => show(f.durationFigure(s));
	assert.equal(up(0), "0 MINS");
	assert.equal(up(60), "1 MIN");
	assert.equal(up(45 * 60), "45 MINS");
	assert.equal(up(H), "1 HR");
	assert.equal(up(3.5 * H), "3 HRS");
	assert.equal(up(47.9 * H), "47 HRS");
	assert.equal(up(2 * D), "2 DAYS");
	assert.equal(up(3 * D + 4 * H), "3.1 DAYS");
	assert.equal(up(13.99 * D), "13 DAYS");
	assert.equal(up(2 * W), "2 WKS");
	assert.equal(up(40 * D), "5.7 WKS");
	assert.equal(up(8 * W - 1), "7.9 WKS");
	assert.equal(up(8 * W), "1.8 MOS");
	assert.equal(up(91 * D), "2.9 MOS");
	assert.equal(up(366 * D), "12 MOS");
	assert.equal(up(730 * D), "23 MOS");
	assert.equal(up(731 * D), "2 YRS");
	assert.equal(up(3653 * D), "10 YRS");
	assert.equal(up(null), null);
});

test("every figure fits in six characters", () => {
	const samples = [0, 1, 9, 99, 99999, 100000, 999999, 1e6, 9.99e6, 9.99e7, 9.99e8];
	for (const n of samples) assert.ok(f.countFigure(n, "X", "XS").fig.length <= 6, String(n));
	for (let b = 1; b < 1e18; b *= 1.0007) assert.ok(f.bytesFigure(b).fig.length <= 4, String(b));
	for (let s = 0; s < 100 * 365 * D; s += 3607) assert.ok(f.durationFigure(s).fig.length <= 3, String(s));
});

test("time since a deploy, and what a screen reader hears", () => {
	assert.equal(f.secondsSince("2026-10-16T10:00:00.000Z", Date.parse("2026-10-16T12:00:00.000Z")), 7200);
	assert.equal(f.secondsSince(null), null);
	assert.equal(f.secondsSince("not a date"), null);
	assert.equal(f.figureLabel("Storage", { fig: "1.39", unit: "GB" }), "Storage: 1.39 gb");
	assert.equal(f.figureLabel("Uptime", null), "Uptime: unavailable");
});

test("storage status counts every message's bytes for the colophon", async () => {
	const { openD1 } = await import("./helpers/d1.mjs");
	const d1 = await openD1();
	const A = "hello@example.com";
	await d1.addMailboxes(A);
	const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
	const { d1StorageStatus } = await loadTs("workers/store/d1/status.ts");
	const box = new D1Mailbox(d1.sql, { delete: async () => {}, put: async () => {} }, A);
	for (const id of ["m1", "m2"]) await box.createEmail("inbox", { id, subject: "Hi", sender: "bob@example.net", recipient: A, date: "2026-10-01T10:00:00.000Z", body: "<p>Hello there</p>", thread_id: id }, []);
	const sum = Number(d1.exec(`SELECT SUM(size) AS s FROM messages`)[0].s);
	const status = await d1StorageStatus(d1.sql, [A]);
	assert.equal(status.messages, 2);
	assert.equal(status.bytes, sum);
	assert.ok(status.bytes > 0);
});
