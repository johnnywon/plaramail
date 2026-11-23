import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { NODE_REQUIRE } from "./helpers/node-require.mjs";
import { createStaticHandler } from "react-router";

// The catch-all route bundled as the app sees it: "~" is app/, packages stay external.
// It's written under node_modules so its imports resolve to the same react-router as this test's.
const bundle = await build({
	entryPoints: ["app/routes/not-found.tsx"], bundle: true, platform: "node", banner: NODE_REQUIRE, format: "esm", write: false,
	jsx: "automatic", packages: "external", alias: { "~": "./app", shared: "./shared" }, loader: { ".svg": "text" },
});
const out = "node_modules/.cache/pm-tests/not-found.mjs";
mkdirSync("node_modules/.cache/pm-tests", { recursive: true });
writeFileSync(out, bundle.outputFiles[0].text);
const notFound = await import(new URL(`../${out}`, import.meta.url).href);

test("an unknown path answers 404, not 200", async () => {
	const handler = createStaticHandler([{ id: "not-found", path: "*", loader: notFound.loader }]);
	const context = await handler.query(new Request("http://localhost/nope"));
	assert.equal(context.statusCode, 404);
});
