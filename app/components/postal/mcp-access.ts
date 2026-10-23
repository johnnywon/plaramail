// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The paths Access must let through without a session: MCP clients sign in with the
 * app's own OAuth on /mcp and /.well-known, and uptime checks and `npm run smoke` read
 * /health (docs/setup.md, step 5).
 */
export const BYPASS_PATHS = ["/mcp", "/.well-known", "/health"] as const;

export interface BypassCheck {
	/** MCP clients can reach /mcp and its OAuth metadata. */
	mcp: boolean;
	/** /health answers without an Access session. */
	health: boolean;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const NO_SESSION: RequestInit = { credentials: "omit", redirect: "manual", cache: "no-store" };

/**
 * Fetch without this page's cookies, so Access treats the request as a client's. Access
 * answers a blocked path with a redirect to its login; the app's own answer is JSON.
 */
export async function checkBypass(origin: string, get: Fetch = (input, init) => fetch(input, init)): Promise<BypassCheck> {
	const json = async (path: string): Promise<Record<string, unknown> | null> => {
		try {
			const res = await get(`${origin}${path}`, NO_SESSION);
			if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return null;
			return (await res.json()) as Record<string, unknown>;
		} catch {
			return null;
		}
	};
	const [meta, health] = await Promise.all([json("/.well-known/oauth-protected-resource/mcp"), json("/health")]);
	return {
		mcp: meta?.resource === `${origin}/mcp`,
		// A 503 with a failed store still came from the app: Access let it through.
		health: typeof health?.ok === "boolean",
	};
}
