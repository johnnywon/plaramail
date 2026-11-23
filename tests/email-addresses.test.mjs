import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const { configuredAddresses } = await loadTs("workers/lib/addresses.ts");

test("EMAIL_ADDRESSES reads as a JSON array or a comma-separated string", () => {
	assert.deepEqual(configuredAddresses({ EMAIL_ADDRESSES: ["a@example.com", " b@example.org "] }), ["a@example.com", "b@example.org"]);
	assert.deepEqual(configuredAddresses({ EMAIL_ADDRESSES: "a@example.com, b@example.org," }), ["a@example.com", "b@example.org"]);
	assert.deepEqual(configuredAddresses({}), []);
});

test("the deploy button asks for EMAIL_ADDRESSES", () => {
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.ok(pkg.cloudflare.bindings.EMAIL_ADDRESSES?.description);
});
