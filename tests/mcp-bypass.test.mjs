import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// Console > MCP checks the Access bypass for /mcp and /health (WON-596).

const { BYPASS_PATHS, checkBypass } = await loadTs("app/components/postal/mcp-access.ts");

const ORIGIN = "https://mail.example.com";
const json = (status, body) => ({ status, type: "basic", json: async () => body });
const redirect = { status: 0, type: "opaqueredirect", json: async () => { throw new Error("opaque"); } };
const META = json(200, { resource: `${ORIGIN}/mcp` });

/** A fetch that answers each path from `answers` and records how it was asked. */
function fakeFetch(answers) {
	const calls = [];
	const get = async (url, init) => {
		calls.push([url, init]);
		const path = url.slice(ORIGIN.length);
		const answer = answers[path];
		if (answer instanceof Error) throw answer;
		return answer ?? json(404, {});
	};
	return Object.assign(get, { calls });
}

test("the bypass covers /mcp, /.well-known and /health, as docs/setup.md says", () => {
	assert.deepEqual([...BYPASS_PATHS], ["/mcp", "/.well-known", "/health"]);
	const setup = readFileSync("docs/setup.md", "utf8");
	for (const path of BYPASS_PATHS) assert.ok(setup.includes(`- \`${path}\``), `${path} is in the setup steps`);
	const tab = readFileSync("app/components/postal/McpTab.tsx", "utf8");
	assert.match(tab, /BYPASS_PATHS\.map/, "the page lists every path");
});

test("both open: nothing to show", async () => {
	const get = fakeFetch({ "/.well-known/oauth-protected-resource/mcp": META, "/health": json(200, { ok: true, d1: "ok", r2: "ok" }) });
	assert.deepEqual(await checkBypass(ORIGIN, get), { mcp: true, health: true });
	for (const [, init] of get.calls) assert.deepEqual(init, { credentials: "omit", redirect: "manual", cache: "no-store" }, "asked without this page's session");
});

test("Access still blocks /health after /mcp was bypassed", async () => {
	const get = fakeFetch({ "/.well-known/oauth-protected-resource/mcp": META, "/health": redirect });
	assert.deepEqual(await checkBypass(ORIGIN, get), { mcp: true, health: false });
});

test("Access blocks everything", async () => {
	const get = fakeFetch({ "/.well-known/oauth-protected-resource/mcp": redirect, "/health": redirect });
	assert.deepEqual(await checkBypass(ORIGIN, get), { mcp: false, health: false });
});

test("a failing store still means /health got through Access", async () => {
	const get = fakeFetch({ "/.well-known/oauth-protected-resource/mcp": META, "/health": json(503, { ok: false, d1: "ok", r2: "failed" }) });
	assert.equal((await checkBypass(ORIGIN, get)).health, true);
});

test("a network error or a page that isn't the app counts as blocked", async () => {
	const get = fakeFetch({ "/.well-known/oauth-protected-resource/mcp": new TypeError("Failed to fetch"), "/health": { status: 200, type: "basic", json: async () => { throw new SyntaxError("not JSON"); } } });
	assert.deepEqual(await checkBypass(ORIGIN, get), { mcp: false, health: false });
	const login = fakeFetch({ "/.well-known/oauth-protected-resource/mcp": json(302, {}), "/health": json(302, {}) });
	assert.deepEqual(await checkBypass(ORIGIN, login), { mcp: false, health: false });
});
