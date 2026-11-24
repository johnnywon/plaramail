import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Console > MCP shows each connected app's addresses and narrows them (WON-533).

const { app } = await loadTs("workers/index.ts");
const grants = await loadTs("workers/mcp/grants.ts");

const headers = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
const ALL = ["a@example.com", "b@example.com", "c@example.com"];

async function setup() {
	const d1 = await openD1();
	await d1.addMailboxes(...ALL);
	const revoked = [];
	const items = [
		{ id: "old", clientId: "c1", scope: ["mail"], metadata: { clientName: "Old app" }, createdAt: 1, userId: "local" },
		{ id: "new", clientId: "c2", scope: ["mail", "mail.send"], metadata: { clientName: "New app", addresses: ["a@example.com", "b@example.com"] }, createdAt: 2, userId: "local" },
	];
	const OAUTH_PROVIDER = {
		listUserGrants: async (user) => ({ items: user === "local" ? items : [] }),
		revokeGrant: async (id) => { revoked.push(id); },
	};
	const env = { DB: d1.DB, EMAIL_ADDRESSES: ALL, BUCKET: { get: async () => null, put: async () => {} }, OAUTH_PROVIDER };
	const send = async (method, path, body) => {
		const response = await app.request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
		return { status: response.status, body: await response.json().catch(() => null) };
	};
	return { d1, send, revoked };
}

test("connected apps list their addresses; an older grant has every address", async () => {
	const { send } = await setup();
	const { body } = await send("GET", "/api/v1/mcp/apps");
	const byId = Object.fromEntries(body.apps.map((a) => [a.id, a]));
	assert.deepEqual([byId.old.every, byId.old.addresses], [true, ALL]);
	assert.deepEqual([byId.new.every, byId.new.addresses], [false, ["a@example.com", "b@example.com"]]);
});

test("an app can be narrowed to some of its addresses, never widened or emptied", async () => {
	const { d1, send } = await setup();
	assert.equal((await send("PUT", "/api/v1/mcp/apps/new/addresses", { addresses: [] })).status, 400);
	assert.equal((await send("PUT", "/api/v1/mcp/apps/new/addresses", { addresses: ["c@example.com"] })).status, 400);
	assert.equal((await send("PUT", "/api/v1/mcp/apps/nobody/addresses", { addresses: ["a@example.com"] })).status, 404);
	const ok = await send("PUT", "/api/v1/mcp/apps/new/addresses", { addresses: ["b@example.com"] });
	assert.equal(ok.status, 200, JSON.stringify(ok.body));
	assert.deepEqual((await grants.storedAddresses(d1.sql, ["new"])).get("new"), ["b@example.com"]);
	assert.equal((await send("PUT", "/api/v1/mcp/apps/new/addresses", { addresses: ["a@example.com"] })).status, 400, "a narrowed app can't get one back");

	assert.equal((await send("PUT", "/api/v1/mcp/apps/old/addresses", { addresses: ["c@example.com"] })).status, 200);
	const old = (await send("GET", "/api/v1/mcp/apps")).body.apps.find((a) => a.id === "old");
	assert.deepEqual([old.every, old.addresses], [false, ["c@example.com"]]);
});

test("revoking an app forgets its narrowing", async () => {
	const { d1, send, revoked } = await setup();
	await send("PUT", "/api/v1/mcp/apps/new/addresses", { addresses: ["a@example.com"] });
	await send("DELETE", "/api/v1/mcp/apps/new");
	assert.deepEqual(revoked, ["new"]);
	assert.equal((await grants.storedAddresses(d1.sql, ["new"])).size, 0);
});
