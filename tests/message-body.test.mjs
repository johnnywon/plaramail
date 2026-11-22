import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { NODE_REQUIRE } from "./helpers/node-require.mjs";

// The reader's message body: text-only mail is app-written HTML, and inline images are for HTML mail.
const bundle = await build({
	entryPoints: ["app/lib/utils.ts"], bundle: true, platform: "node", banner: NODE_REQUIRE, format: "esm", write: false,
	alias: { "~": `${process.cwd()}/app` },
});
const tmp = new URL(`./message-body.bundle.${process.pid}.mjs`, pathToFileURL(`${process.cwd()}/tests/`));
const { writeFile, rm } = await import("node:fs/promises");
await writeFile(tmp, bundle.outputFiles[0].text);
const { messageBodyHtml, rewriteInlineImages } = await import(tmp.href).finally(() => rm(tmp));

const links = (html) => [(html.match(/<a /g) ?? []).length, (html.match(/<\/a>/g) ?? []).length];

test("text-only mail skips the inline image rewrite, so a Content-ID can't break its links", () => {
	const body = "see https://evil.example/cid:Z for details\nand https://a.example/style=position:fixed// ok\n";
	const att = [{ id: "a1", disposition: "inline", content_id: '<Z">https://evil.example/cid:Z</a>>' }];
	const html = messageBodyHtml(body, "m@example.com", "e1", att);
	const [open, close] = links(html);
	assert.equal(open, 2);
	assert.equal(close, 2);
	assert.doesNotMatch(html, /attachments\/a1/);
});

test("HTML mail still gets its inline images", () => {
	const html = messageBodyHtml('<p>Hi</p><img src="cid:logo@example.com">', "m@example.com", "e1", [{ id: "a1", disposition: "inline", content_id: "<logo@example.com>" }]);
	assert.match(html, /src="\/api\/v1\/mailboxes\/m@example.com\/emails\/e1\/attachments\/a1"/);
});

test("a Content-ID with quotes or brackets is never written into HTML mail", () => {
	const out = rewriteInlineImages('<img src="cid:x"><a href="cid:x">', "m", "e", [{ id: "a1", disposition: "inline", content_id: '<x" onload="y>' }]);
	assert.equal(out, '<img src="cid:x"><a href="cid:x">');
});
