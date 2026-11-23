import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { loadTs } from "./helpers/sqlite.mjs";
import { openSql } from "./helpers/sql.mjs";

const { chunkByBytes, MAX_BATCH_BYTES } = await loadTs("workers/store/sql.ts");

// -- Every caller goes through the store ---------------------------------------

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
	});
}

test("only the store touches the mail database", () => {
	const offenders = files("workers")
		.filter((path) => !path.startsWith("workers/store/"))
		.filter((path) => /env\.DB\b|`mailboxes\//.test(readFileSync(path, "utf8")));
	assert.deepEqual(offenders, [], "use mailStore(env) from workers/store");
});

// -- node:sqlite Sql (the unit-test stand-in for D1) ---------------------------

test("the test Sql runs queries and batches", async () => {
	const { sql } = openSql();
	await sql.schema("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
	assert.deepEqual(await sql.run("INSERT INTO t (v) VALUES (?)", "a"), { changes: 1 });
	const results = await sql.batch([
		{ sql: "INSERT INTO t (v) VALUES (?)", params: ["b"] },
		{ sql: "SELECT count(*) AS n FROM t" },
	]);
	assert.deepEqual(results[1], [{ n: 2 }]);
	assert.deepEqual(await sql.first("SELECT v FROM t WHERE id = ?", 2), { v: "b" });
	assert.equal(await sql.first("SELECT v FROM t WHERE id = ?", 99), null);
});

test("a failing statement rolls back its whole batch", async () => {
	const { sql } = openSql();
	await sql.schema("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
	await assert.rejects(sql.batch([
		{ sql: "INSERT INTO t (v) VALUES (?)", params: ["kept?"] },
		{ sql: "INSERT INTO t (v) VALUES (NULL)" },
	]));
	assert.deepEqual(await sql.all("SELECT * FROM t"), []);
});

test("the test Sql refuses what D1 refuses", async () => {
	const { sql } = openSql();
	await sql.schema("CREATE TABLE t (v TEXT)");
	await assert.rejects(sql.run(`SELECT ${Array(101).fill("?").join(",")}`, ...Array(101).fill(1)), /too many SQL variables/);
	await assert.rejects(sql.run("BEGIN"), /transactions/);
	await assert.rejects(sql.run("INSERT INTO t VALUES (?)", "x".repeat(8_000_001)), /SQLITE_TOOBIG/);
	const big = "x".repeat(7_000_000);
	await assert.rejects(sql.batch(Array.from({ length: 5 }, () => ({ sql: "INSERT INTO t VALUES (?)", params: [big] }))), /32MiB/);
});

// -- Batching by bytes ---------------------------------------------------------

test("chunkByBytes keeps each batch under the byte cap", () => {
	const stmt = (n) => ({ sql: "INSERT INTO t VALUES (?)", params: ["x".repeat(n)] });
	const chunks = chunkByBytes([stmt(400), stmt(400), stmt(400)], 1000);
	assert.deepEqual(chunks.map((c) => c.length), [2, 1]);
	assert.deepEqual(chunkByBytes([stmt(5000)], 1000).map((c) => c.length), [1], "an oversized statement gets its own batch");
	assert.deepEqual(chunkByBytes([]), []);
	assert.ok(MAX_BATCH_BYTES < 32 * 1024 * 1024);
});

// -- d1Sql against a real (local) D1 -------------------------------------------

let mf;

before(async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/sql-worker.ts"], bundle: true, format: "esm", platform: "neutral",
		write: false, logLevel: "silent",
	});
	mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", d1Databases: ["DB"] });
});

after(async () => {
	await mf?.dispose();
});

async function d1(op, ...args) {
	const response = await mf.dispatchFetch("http://test/", { method: "POST", body: JSON.stringify({ op, args }) });
	return response.json();
}

test("d1Sql runs queries, batches and rolls back a failed batch on D1", async () => {
	assert.deepEqual(await d1("run", "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)"), { ok: { changes: 0 } });
	assert.deepEqual(await d1("run", "INSERT INTO t (v) VALUES (?)", "a"), { ok: { changes: 1 } });
	assert.deepEqual(await d1("first", "SELECT v FROM t WHERE id = ?", 1), { ok: { v: "a" } });
	assert.deepEqual(await d1("first", "SELECT v FROM t WHERE id = ?", 9), { ok: null });
	const batch = await d1("batch", [{ sql: "INSERT INTO t (v) VALUES (?)", params: ["b"] }, { sql: "SELECT count(*) AS n FROM t" }]);
	assert.deepEqual(batch.ok[1], [{ n: 2 }]);
	const failed = await d1("batch", [{ sql: "INSERT INTO t (v) VALUES (?)", params: ["c"] }, { sql: "INSERT INTO t (v) VALUES (NULL)" }]);
	assert.ok(failed.error, "the batch fails");
	assert.deepEqual(await d1("all", "SELECT v FROM t ORDER BY id"), { ok: [{ v: "a" }, { v: "b" }] });
	assert.deepEqual(await d1("batch", []), { ok: [] });
});
