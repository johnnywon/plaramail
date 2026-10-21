// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// 0.9.5 renamed the build env vars. A deploy repo that still sets only the earlier names would
// build with this repo's example config and brand, and deploy a Worker named after it.
// vite.config.ts and `npm run deploy` stop on that. Run directly, it exits 1 with the message.
import { fileURLToPath } from "node:url";

export const RENAMED = {
	PLURAMAIL_WRANGLER_CONFIG: "PLARAMAIL_WRANGLER_CONFIG",
	PLURAMAIL_PUBLIC_DIR: "PLARAMAIL_PUBLIC_DIR",
	PLURAMAIL_DEMO: "PLARAMAIL_DEMO",
	PLURAMAIL_PERSIST: "PLARAMAIL_PERSIST",
};

/**
 * The message for env vars set only under their earlier name, or null.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function renamedEnvError(env) {
	const stale = Object.entries(RENAMED).filter(([old, now]) => env[old] !== undefined && env[now] === undefined);
	if (!stale.length) return null;
	return `Rename ${stale.map(([old, now]) => `${old} to ${now}`).join(", ")}. 0.9.5 no longer reads the earlier names (CHANGELOG.md, 0.9.5, Upgrading).`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const error = renamedEnvError(process.env);
	if (error) {
		console.error(error);
		process.exit(1);
	}
}
