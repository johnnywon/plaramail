// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { McpProps } from "./scopes";

/**
 * MCP sessions belong to the token that opened them. A session's tools are set
 * once, from the first token's scopes, so a later token with other scopes (a
 * reconnect without Send, a narrowed token) must not reuse the session: it gets
 * "Session not found" and starts its own. The owner is kept in OAUTH_KV.
 */

type Kv = Pick<KVNamespace, "get" | "put">;
type Handler<E> = { fetch(request: Request, env: E, ctx: ExecutionContext): Response | Promise<Response> };

/** As long as a refresh token lives; a session older than that starts again. */
export const SESSION_TTL_S = 30 * 24 * 60 * 60;
const key = (sessionId: string) => `mcp-session:${sessionId}`;

/** Who a session belongs to: the grant's user and client and the token's scopes. */
export function sessionOwner(props: Partial<McpProps> | undefined): string {
	return [props?.userId ?? "", props?.clientId ?? "", [...(props?.scopes ?? [])].sort().join(" ")].join("|");
}

const sessionNotFound = () => new Response(
	JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }),
	{ status: 404, headers: { "Content-Type": "application/json" } },
);

/** Wrap the MCP handler so a session only answers the token that opened it. */
export function bindSessions<E extends { OAUTH_KV: Kv }>(inner: Handler<E>): Handler<E> {
	return {
		async fetch(request, env, ctx) {
			const owner = sessionOwner((ctx as ExecutionContext & { props?: McpProps }).props);
			const sessionId = request.headers.get("mcp-session-id");
			if (sessionId && (await env.OAUTH_KV.get(key(sessionId))) !== owner) return sessionNotFound();
			const response = await inner.fetch(request, env, ctx);
			const opened = response.headers.get("mcp-session-id");
			if (!sessionId && opened) await env.OAUTH_KV.put(key(opened), owner, { expirationTtl: SESSION_TTL_S });
			return response;
		},
	};
}

/** A token narrowed at the token endpoint carries only the scopes it was given. */
export function narrowProps(options: { props: McpProps; requestedScope: string[] }): { accessTokenProps: McpProps } | undefined {
	const scopes = options.props.scopes.filter((s) => options.requestedScope.includes(s));
	return scopes.length === options.props.scopes.length ? undefined : { accessTokenProps: { ...options.props, scopes } };
}
