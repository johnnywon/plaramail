import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function readConfig() {
	const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
	// Strip line comments that start outside strings, then trailing commas.
	const json = text
		.split("\n")
		.map((line) => line.replace(/^(\s*)\/\/.*$/, "$1"))
		.join("\n")
		.replace(/,(\s*[\]}])/g, "$1");
	return JSON.parse(json);
}

test("every address belongs to a configured domain", () => {
	const { vars } = readConfig();
	const domains = new Set(vars.DOMAINS.split(","));
	for (const address of vars.EMAIL_ADDRESSES) assert.ok(domains.has(address.split("@")[1]), address);
});

test("mail has no Durable Object bindings", () => {
	const { durable_objects } = readConfig();
	assert.deepEqual(durable_objects.bindings.map((b) => b.name).sort(), ["EMAIL_AGENT", "EMAIL_MCP"]);
});

// Deployed migrations are permanent. Only append; never edit or reorder.
test("migrations are append-only and v5 deletes the mail classes", () => {
	const { migrations } = readConfig();
	assert.deepEqual(migrations, [
		{ tag: "v1", new_sqlite_classes: ["MailboxDO"] },
		{ tag: "v2", new_sqlite_classes: ["EmailAgent"] },
		{ tag: "v3", new_sqlite_classes: ["EmailMCP"] },
		{ tag: "v4", new_sqlite_classes: ["MailIndexDO"] },
		{ tag: "v5", deleted_classes: ["MailboxDO", "MailIndexDO"] },
	]);
});

test("the worker entry exports every bound Durable Object class", () => {
	const { durable_objects } = readConfig();
	const entry = readFileSync(new URL("../workers/app.ts", import.meta.url), "utf8");
	for (const { class_name } of durable_objects.bindings) {
		assert.match(entry, new RegExp(`export \\{ ${class_name} \\}`), class_name);
	}
});

test("mail is stored on D1", () => {
	const { vars, d1_databases } = readConfig();
	assert.equal(vars.STORAGE, undefined);
	const db = d1_databases?.find((d) => d.binding === "DB");
	assert.equal(db?.migrations_dir, "migrations");
});
