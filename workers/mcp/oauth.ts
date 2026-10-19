// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { foreignOrigin } from "../lib/csrf";
import { withSecurityHeaders } from "../lib/security-headers";
import type { Env } from "../types";
import { EmailMCP } from "./index";
import { bindSessions, narrowProps } from "./session";
import { MCP_ROUTE, MCP_SCOPES, MCP_TOKEN_ENDPOINT, MCP_REGISTER_ENDPOINT, AUTHORIZE_ENDPOINT, SCOPE_MAIL } from "./scopes";

/**
 * OAuth 2.1 for the MCP server. A client finds the server from the 401 on /mcp,
 * registers itself, sends the owner to /authorize (the consent page, behind
 * Cloudflare Access), then calls /mcp with a bearer token. Tokens and clients
 * live in the OAUTH_KV namespace.
 *
 * The resource and token endpoints sit under /mcp so one Access bypass rule
 * covers them, with /.well-known/oauth-*. /authorize stays behind Access.
 */

type Handler = { fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> };

/** Only /mcp itself and its two OAuth endpoints exist under /mcp. */
export function isMcpLookalike(pathname: string): boolean {
	return pathname.startsWith(MCP_ROUTE) && pathname !== MCP_ROUTE && pathname !== MCP_TOKEN_ENDPOINT && pathname !== MCP_REGISTER_ENDPOINT;
}

const mcp = bindSessions<Env>(EmailMCP.serve(MCP_ROUTE, { binding: "EMAIL_MCP" }));

// The Worker answers on workers.dev and on custom domains. Each origin is its own
// issuer and resource, so a token only works on the hostname that issued it.
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(origin: string, web: Handler): OAuthProvider<Env> {
	const known = providers.get(origin);
	if (known) return known;
	const provider = new OAuthProvider<Env>({
		apiRoute: MCP_ROUTE,
		apiHandler: mcp,
		defaultHandler: web,
		authorizeEndpoint: AUTHORIZE_ENDPOINT,
		tokenEndpoint: MCP_TOKEN_ENDPOINT,
		clientRegistrationEndpoint: MCP_REGISTER_ENDPOINT,
		scopesSupported: [...MCP_SCOPES],
		requiredScopes: [SCOPE_MAIL],
		resourceMetadata: {
			resource: `${origin}${MCP_ROUTE}`,
			authorization_servers: [origin],
			resource_name: "PluraMail",
			bearer_methods_supported: ["header"],
		},
		clientIdMetadataDocumentEnabled: true,
		tokenExchangeCallback: narrowProps,
		accessTokenTTL: 60 * 60,
		refreshTokenTTL: 30 * 24 * 60 * 60,
		onError({ status, code, internal }) {
			console.warn("MCP OAuth error", { status, code, reason: internal?.reason });
		},
	});
	providers.set(origin, provider);
	return provider;
}

const RESOURCE_METADATA = `/.well-known/oauth-protected-resource${MCP_ROUTE}`;

/**
 * The provider lists only required scopes in the protected resource metadata. List every
 * scope, as the authorization server metadata does, so a client reading RFC 9728 learns
 * that mail.send exists. `mail` stays the only required one (the 401 challenge's scope).
 */
async function withAllScopes(response: Response): Promise<Response> {
	if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
	const metadata = (await response.json()) as Record<string, unknown>;
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return new Response(JSON.stringify({ ...metadata, scopes_supported: [...MCP_SCOPES] }), { status: response.status, headers });
}

/** The Worker's fetch with OAuth in front: /mcp and the OAuth endpoints go to the provider, the rest to `web`. */
export function withMcpOAuth(web: Handler): Handler["fetch"] {
	return async (request, env, ctx) => {
		const url = new URL(request.url);
		const own = url.pathname.startsWith(MCP_ROUTE) || url.pathname.startsWith("/.well-known/");
		if (isMcpLookalike(url.pathname)) return withSecurityHeaders(new Response("Not found", { status: 404 }));
		// A page on another site can't drive the server from someone's browser (DNS rebinding included).
		if (url.pathname === MCP_ROUTE && foreignOrigin(request)) return withSecurityHeaders(new Response("Cross-origin request refused", { status: 403 }));
		let response = await providerFor(url.origin, web).fetch(request, env, ctx);
		if (url.pathname === RESOURCE_METADATA && request.method === "GET") response = await withAllScopes(response);
		return own ? withSecurityHeaders(response) : response;
	};
}
