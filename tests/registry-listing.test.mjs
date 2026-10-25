// server.json is the MCP Registry listing. The registry keeps one entry per version, so the listing
// moves with package.json, and the remote stays a template because every deployment has its own host.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const server = JSON.parse(readFileSync("server.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("server.json version matches package.json", () => {
	assert.equal(server.version, pkg.version);
});

test("server.json fits the registry's limits", () => {
	assert.match(server.name, /^io\.github\.[a-z0-9-]+\/plaramail$/);
	assert.ok(server.description.length <= 100, `description is ${server.description.length} characters`);
});

test("the remote is the /mcp endpoint on the deployment's own host", () => {
	assert.deepEqual(
		server.remotes.map((r) => [r.type, r.url]),
		[["streamable-http", "https://{host}/mcp"]],
	);
	assert.equal(server.remotes[0].variables.host.isRequired, true);
});
