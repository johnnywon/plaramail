import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// /authorize turns any error it doesn't know into the "Can't connect this app" page, never a bare 500 (#31).

// The OAuth library imports cloudflare:workers, which only workerd has; its WorkerEntrypoint isn't used here.
const bundle = await build({
	entryPoints: ["workers/mcp/authorize.ts"], bundle: true, platform: "node", format: "esm", write: false,
	plugins: [{ name: "workerd", setup(b) {
		b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "cloudflare:workers", namespace: "stub" }));
		b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class WorkerEntrypoint {}", loader: "js" }));
	} }],
});
const { authorize } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("an unknown error while reading the request shows Can't connect this app", async () => {
	const oauth = { parseAuthRequest: async () => { throw new Error("CIMD is enabled but 'global_fetch_strictly_public' compatibility flag is not set."); } };
	const request = new Request("https://mail.example.com/authorize?client_id=https://app.example.org/client.json", { headers: { accept: "text/html" } });
	const errors = [];
	const original = console.error;
	console.error = (...a) => errors.push(a.join(" "));
	try {
		const res = await authorize(request, oauth, "owner@example.com");
		assert.equal(res.status, 400);
		assert.match(await res.text(), /Can.{0,6}t connect this app/);
		assert.equal(errors.length, 1, "the cause is logged");
	} finally {
		console.error = original;
	}
});
