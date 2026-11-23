import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("a message frame passes up every key with its modifiers", () => {
	const source = readFileSync("app/components/EmailIframe.tsx", "utf8");
	const post = source.match(/parent\.postMessage\(\{ __emailIframeKey: true,([^}]*)\}/);
	assert.ok(post, "key message in the frame script");
	for (const field of ["key", "shiftKey", "metaKey", "ctrlKey", "altKey"]) assert.match(post[1], new RegExp(`\\b${field}: e\\.${field}\\b`), field);
	assert.doesNotMatch(source, /indexOf\(e\.key\)/, "no fixed key list in the frame");
});
