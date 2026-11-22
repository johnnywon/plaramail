import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// The agent model routes answer a bad body with 400 and a message, not the
// Worker's error page.

const { app } = await loadTs("workers/index.ts");

const headers = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const env = { EMAIL_ADDRESSES: ["a@example.com"], BUCKET: { get: async () => null, put: async () => {} } };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

async function send(method, path, body) {
	const response = await app.request(`http://localhost${path}`, { method, headers, body }, env, ctx);
	return { status: response.status, body: await response.json().catch(() => null) };
}

const ROUTES = [
	["PUT", "/api/v1/agent-model", { selected: { provider: "nope", id: "x" } }],
	["POST", "/api/v1/agent-model/test", { provider: "nope", id: "x" }],
];

for (const [method, path, unknownProvider] of ROUTES) {
	test(`${method} ${path} refuses a bad body with 400`, async () => {
		for (const body of ["{not json", "", JSON.stringify(unknownProvider)]) {
			const r = await send(method, path, body);
			assert.equal(r.status, 400, `${body} -> ${r.status}`);
			assert.equal(typeof r.body?.error, "string", body);
		}
	});
}
