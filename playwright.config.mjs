// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// npm run test:browser: the mail view in Chromium at desktop and 375px, against a dev server
// on tests/browser/wrangler.ci.jsonc (local bindings only, filled with the sample inbox).
import { defineConfig } from "@playwright/test";

const PORT = 5199;
const CONFIG = "tests/browser/wrangler.ci.jsonc";
const STATE = ".wrangler/browser-test";

export default defineConfig({
	testDir: "tests/browser",
	globalSetup: "./tests/browser/warm-up.mjs",
	timeout: 60_000,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["list"], ["github"]] : "list",
	use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
	projects: [
		{ name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
		{ name: "375px", use: { browserName: "chromium", viewport: { width: 375, height: 812 }, hasTouch: true } },
	],
	webServer: {
		command: `npx wrangler d1 migrations apply DB --local -c ${CONFIG} --persist-to ${STATE} && PLARAMAIL_WRANGLER_CONFIG=${CONFIG} PLARAMAIL_PERSIST=${STATE} npx react-router dev --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
});
