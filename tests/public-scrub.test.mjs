// The repo is public. Source files carry the license header, and code and tests name no real
// Cloudflare Access team: hosts are example.com, example.org, example.net or the placeholder in
// .dev.vars.example. The sample inbox in workers/lib/dev-seed is fiction and is not checked here.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function files(dir, ext) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path, ext);
		return ext.some((e) => path.endsWith(e)) ? [path] : [];
	});
}

const HEADER = `// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
`;

test("every source file starts with the license header", () => {
	const missing = ["app", "workers", "shared"]
		.flatMap((dir) => files(dir, [".ts", ".tsx"]))
		.filter((file) => !file.endsWith(".d.ts") && !readFileSync(file, "utf8").startsWith(HEADER));
	assert.deepEqual(missing, [], "add the header from any other source file");
});

test("no real Cloudflare Access team in code, tests or docs", () => {
	const found = ["app", "workers", "shared", "tests", "scripts", "docs"]
		.flatMap((dir) => files(dir, [".ts", ".tsx", ".mjs", ".sh", ".md", ".json", ".jsonc"]))
		.filter((file) => !file.includes(join("workers", "lib", "dev-seed")))
		.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/([a-z0-9-]+)\.cloudflareaccess\.com/g)]
			.filter(([, team]) => team !== "your-team")
			.map(([host]) => `${file}: ${host}`));
	assert.deepEqual(found, []);
});
