import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// A message frame runs only its own scripts. If the sanitiser missed something,
// an inline script or event handler from the mail still can't run.
test("the message frame allows scripts by nonce, not unsafe-inline", () => {
	const source = readFileSync("app/components/EmailIframe.tsx", "utf8");
	const csp = source.split("\n").find((line) => line.includes('http-equiv="Content-Security-Policy"')) ?? "";
	assert.match(csp, /script-src 'nonce-\$\{nonce\}'/);
	assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
	const scripts = source.match(/<script\b[^>]*>/g) ?? [];
	assert.ok(scripts.length >= 2);
	for (const tag of scripts) assert.equal(tag, '<script nonce="${nonce}">');
});
