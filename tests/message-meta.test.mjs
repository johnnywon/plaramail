import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { NODE_REQUIRE } from "./helpers/node-require.mjs";

const bundle = await build({
	entryPoints: ["workers/lib/message-meta.ts"],
	bundle: true,
	platform: "node", banner: NODE_REQUIRE,
	format: "esm",
	write: false,
});
const { htmlToText, parseSender, listHeaders, BODY_TEXT_LIMIT } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("htmlToText drops markup, style and script, decodes entities, collapses space", () => {
	const html = `<style>p{color:red}</style><p>Hello&nbsp;<b>there</b> &amp; you</p>\n\n<script>alert(1)</script><div>A &lt;tag&gt; &quot;q&quot; &#39;s&#39; &#8217;</div>`;
	assert.equal(htmlToText(html), `Hello there & you A <tag> "q" 's' ’`);
});

test("htmlToText keeps plain text and caps length", () => {
	assert.equal(htmlToText("plain  text\nbody"), "plain text body");
	assert.equal(htmlToText("x".repeat(BODY_TEXT_LIMIT + 50)).length, BODY_TEXT_LIMIT);
	assert.equal(htmlToText(null), "");
});

test("parseSender reads the display name from the from header", () => {
	const headers = JSON.stringify([{ key: "from", value: `"Ann B" <Ann@Example.org>` }]);
	assert.deepEqual(parseSender("ann@example.org", headers), { addr: "ann@example.org", name: "Ann B", domain: "example.org" });
	assert.deepEqual(parseSender("bob@x.example.net", JSON.stringify([{ key: "from", value: "Bob Smith <bob@x.example.net>" }])), { addr: "bob@x.example.net", name: "Bob Smith", domain: "x.example.net" });
});

test("parseSender falls back to the stored sender", () => {
	assert.deepEqual(parseSender("Bob@X.example.net", null), { addr: "bob@x.example.net", name: "", domain: "x.example.net" });
	assert.deepEqual(parseSender("bob@x.example.net", "not json"), { addr: "bob@x.example.net", name: "", domain: "x.example.net" });
	assert.deepEqual(parseSender("bob@x.example.net", JSON.stringify([{ key: "from", value: "bob@x.example.net" }])), { addr: "bob@x.example.net", name: "", domain: "x.example.net" });
});

test("listHeaders extracts list id and unsubscribe targets", () => {
	const headers = JSON.stringify([
		{ key: "list-id", value: "News <news.example.com>" },
		{ key: "list-unsubscribe", value: "<mailto:u@example.com?subject=unsub>, <https://example.com/u?id=1>" },
		{ key: "list-unsubscribe-post", value: "List-Unsubscribe=One-Click" },
	]);
	assert.deepEqual(listHeaders(headers), {
		list_id: "news.example.com",
		unsubscribe: JSON.stringify({ urls: ["mailto:u@example.com?subject=unsub", "https://example.com/u?id=1"], oneClick: true }),
	});
	assert.deepEqual(listHeaders(null), { list_id: null, unsubscribe: null });
	assert.deepEqual(listHeaders(JSON.stringify([{ key: "subject", value: "x" }])), { list_id: null, unsubscribe: null });
});
