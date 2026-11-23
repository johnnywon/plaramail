import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Builds the app twice: PLARAMAIL_DEMO=1 must carry the sample inbox and the demo gate, a normal build must carry
// neither. The normal build runs last, so build/ is left as a normal build. Run with npm run test:build.

const SEED = /Cobalt Cloud|seed-mail-v|seed-alex-v|Partwell|sample-link|ensureDevMail|dev\/seed/;
const GATE = /Sending is off in the demo|This address does not take mail/;

function build(env) {
	execFileSync("npx", ["react-router", "build"], { env: { ...process.env, ...env }, stdio: "ignore" });
	const files = readdirSync("build/server", { recursive: true }).map(String).filter((f) => f.endsWith(".js"));
	return files.map((f) => ({ f, text: readFileSync(join("build/server", f), "utf8") }));
}
const matching = (files, re) => files.filter(({ text }) => re.test(text)).map(({ f }) => f);

test("a demo build carries the sample inbox and the demo gate", () => {
	const files = build({ PLARAMAIL_DEMO: "1" });
	assert.ok(matching(files, SEED).length > 0, "sample inbox missing");
	assert.ok(matching(files, /seed-alex-v/).length > 0, "Alex profile missing");
	assert.ok(matching(files, GATE).length > 0, "demo gate missing");
});

test("a normal build carries neither", () => {
	const files = build({ PLARAMAIL_DEMO: "" });
	assert.deepEqual(matching(files, SEED), []);
	assert.deepEqual(matching(files, GATE), []);
});
