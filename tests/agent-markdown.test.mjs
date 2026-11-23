import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { NODE_REQUIRE } from "./helpers/node-require.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Packages stay external so the module and this test share one React.
const bundle = await build({
	entryPoints: ["app/components/postal/agent-markdown.tsx"], bundle: true, platform: "node", banner: NODE_REQUIRE, format: "esm",
	packages: "external", jsx: "automatic", write: false,
});
const tmp = new URL(`./agent-markdown.bundle.${process.pid}.mjs`, pathToFileURL(`${process.cwd()}/tests/`));
const { writeFile, rm } = await import("node:fs/promises");
await writeFile(tmp, bundle.outputFiles[0].text);
const { AgentMarkdown } = await import(tmp.href).finally(() => rm(tmp));

const render = (text) => renderToStaticMarkup(createElement(AgentMarkdown, { text }));

test("a markdown image in an agent reply does not load", () => {
	const html = render("Here you go ![logo](https://example.net/p.png?d=secret)");
	assert.doesNotMatch(html, /<img/i);
	assert.match(html, /<a href="https:\/\/example.net\/p.png\?d=secret"[^>]*>Image: logo<\/a>/);
	assert.match(html, /rel="noopener noreferrer"/);
});

test("reference images and images inside links render no img either", () => {
	assert.doesNotMatch(render("![x][r]\n\n[r]: https://example.net/a.gif"), /<img/i);
	assert.doesNotMatch(render("[![x](https://example.net/b.gif)](https://example.org)"), /<img/i);
	assert.match(render("![](https://example.net/c.gif)"), />Image: https:\/\/example.net\/c.gif</);
});

test("raw HTML images stay text", () => {
	assert.doesNotMatch(render('<img src="https://example.net/d.gif">'), /<img/i);
});

test("links still open in a new tab", () => {
	assert.match(render("[docs](https://example.com/docs)"), /<a href="https:\/\/example.com\/docs" target="_blank" rel="noopener noreferrer">docs<\/a>/);
});
