import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const { app } = await loadTs("workers/index.ts");

async function config(env) {
	return (await app.request("http://localhost/api/v1/config", {}, { DOMAINS: "example.com", EMAIL_ADDRESSES: [], ...env })).json();
}

test("config lists domains and addresses; agents can run on new mail outside a demo", async () => {
	assert.deepEqual(await config({ DOMAINS: "example.com, example.org", EMAIL_ADDRESSES: ["a@example.com"] }), {
		domains: ["example.com", "example.org"], emailAddresses: ["a@example.com"], autoDraft: true, demo: false,
		version: pkg.version, deployedAt: null,
	});
});

test("config names the running version and when it was deployed, for the colophon", async () => {
	const body = await config({ DOMAINS: "example.com", EMAIL_ADDRESSES: ["a@example.com"], CF_VERSION_METADATA: { id: "v1", timestamp: "2026-10-16T10:00:00.000Z" } });
	assert.equal(body.version, pkg.version);
	assert.equal(body.deployedAt, "2026-10-16T10:00:00.000Z");
});

test("the dev seed route does not exist outside local development", async () => {
	const response = await app.request("http://localhost/api/v1/dev/seed", {
		method: "POST",
		headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
		body: "{}",
	}, {});
	assert.equal(response.status, 404);
});
