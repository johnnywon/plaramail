import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { RENAMED, renamedEnvError } from "../scripts/check-env.mjs";

// 0.9.5 renamed the build env vars. Only the earlier name set stops the build and the deploy.

test("nothing set, or the new names, pass", () => {
	assert.equal(renamedEnvError({}), null);
	assert.equal(renamedEnvError({ PLARAMAIL_WRANGLER_CONFIG: "../wrangler.jsonc", PLARAMAIL_DEMO: "1" }), null);
});

test("an earlier name alone is refused, naming the new one", () => {
	const error = renamedEnvError({ PLURAMAIL_WRANGLER_CONFIG: "../wrangler.jsonc", PLARAMAIL_DEMO: "1" });
	assert.match(error, /Rename PLURAMAIL_WRANGLER_CONFIG to PLARAMAIL_WRANGLER_CONFIG\./);
	assert.doesNotMatch(error, /DEMO/);
});

test("both names set pass, so a deploy script can set both during a move", () => {
	for (const [old, now] of Object.entries(RENAMED)) assert.equal(renamedEnvError({ [old]: "x", [now]: "x" }), null);
});

test("npm run deploy stops before it reads a config", () => {
	const run = spawnSync("npm", ["run", "--silent", "deploy"], { env: { ...process.env, PLURAMAIL_WRANGLER_CONFIG: "../wrangler.jsonc" }, encoding: "utf8" });
	assert.equal(run.status, 1);
	assert.match(run.stderr, /Rename PLURAMAIL_WRANGLER_CONFIG to PLARAMAIL_WRANGLER_CONFIG/);
	assert.doesNotMatch(run.stdout + run.stderr, /migrations apply|Run npm run build first/);
});

test("the build stops too", () => {
	assert.throws(
		() => execFileSync("npx", ["react-router", "build"], { env: { ...process.env, PLURAMAIL_DEMO: "1" }, stdio: "pipe" }),
		(e) => /Rename PLURAMAIL_DEMO to PLARAMAIL_DEMO/.test(String(e.stderr)),
	);
});
