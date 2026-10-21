// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { jwtVerify } from "jose";
import { createRequestHandler } from "react-router";
import { runCron } from "./cron";
import { consumeAutoDrafts } from "./agent/queue";
import type { AutoDraftJob } from "./agent/runs";
import { accessConfigError, accessJwks, getAccessUrls } from "./lib/access-config";
import { recordError } from "./lib/alerts";
import { DEMO, demoBlocksPath } from "./lib/demo";
import { errorResponse } from "./lib/error-page";
import { foreignOrigin } from "./lib/csrf";
import { checkHealth, healthResponse } from "./lib/health";
import { withSecurityHeaders } from "./lib/security-headers";
import { app as apiApp, receiveEmail } from "./index";
import { authorize } from "./mcp/authorize";
import { withMcpOAuth } from "./mcp/oauth";
import type { Env } from "./types";

export { EmailAgent } from "./agent";
export { EmailMCP } from "./mcp";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

// Main app that wraps the API and adds React Router fallback
const app = new Hono<{ Bindings: Env; Variables: { viewer: string } }>();
app.use("*", async (c, next) => {
	await next();
	c.res = withSecurityHeaders(c.res);
});

// A request that throws is recorded for the alert mail, then answered with the error page.
app.onError((err, c) => {
	console.error("request failed:", c.req.method, c.req.path, err.message, err.stack);
	c.executionCtx.waitUntil(recordError(c.env, "fetch", `${c.req.method} ${c.req.path}: ${err.message}`));
	return errorResponse(c.req.raw, 500, "Something went wrong", "The Worker hit an error. It has been logged.");
});

// Before the Access check: smoke and uptime monitors reach it through the deployment's Access bypass.
app.get("/health", async (c) => {
	const health = await checkHealth(c.env);
	if (!health.ok) console.error("health check failed:", JSON.stringify(health));
	return healthResponse(health);
});

// Cloudflare Access JWT validation middleware (production only)
app.use("*", async (c, next) => {
	// Skip validation in development. A demo build is open to anyone and has no MCP server or agent.
	if (DEMO && demoBlocksPath(c.req.path)) {
		return c.json({ error: "The agent and MCP server are off in the demo" }, 403);
	}
	if (import.meta.env.DEV || DEMO) {
		c.set("viewer", "local");
		return next();
	}

	const { POLICY_AUD, TEAM_DOMAIN } = c.env;

	// Fail closed in production if Access is not configured, or still has the deploy button's placeholders.
	const configError = accessConfigError({ POLICY_AUD, TEAM_DOMAIN });
	if (configError) {
		return errorResponse(c.req.raw, 500, "Access is not set up",
			configError);
	}

	const token = c.req.header("cf-access-jwt-assertion");
	if (!token) {
		return errorResponse(c.req.raw, 403, "Not signed in", "Missing required CF Access JWT");
	}

	try {
		const { issuer, certsUrl } = getAccessUrls(TEAM_DOMAIN);
		const { payload } = await jwtVerify(token, accessJwks(certsUrl), {
			issuer,
			audience: POLICY_AUD,
			algorithms: ["RS256"],
		});
		// A person's token has their email; a service token has only its common name.
		c.set("viewer", String(payload.email ?? payload.common_name ?? payload.sub ?? "access"));
	} catch {
		return errorResponse(c.req.raw, 403, "Sign in again", "Invalid or expired Access token");
	}

	// Authorization model note: once a teammate passes the shared Cloudflare
	// Access policy, they can access all mailboxes in this app by design.
	return next();
});

// The MCP server and its OAuth endpoints are answered by withMcpOAuth below, before this app.
// The consent page is here, behind Access like the rest of the app.
app.on(["GET", "POST"], "/authorize", async (c) => {
	if (!c.env.OAUTH_PROVIDER) return c.notFound();
	if (c.req.method === "POST" && foreignOrigin(c.req.raw)) return c.text("Cross-origin request refused", 403);
	return authorize(c.req.raw, c.env.OAUTH_PROVIDER, c.get("viewer"));
});

// Mount the API routes
app.route("/", apiApp);

// Agent WebSocket routing - must be before React Router catch-all
app.all("/agents/*", async (c) => {
	if (foreignOrigin(c.req.raw)) return c.text("Cross-origin request refused", 403);
	const response = await routeAgentRequest(c.req.raw, c.env);
	if (response) return response;
	return c.text("Agent not found", 404);
});

// React Router catch-all: serves the SPA for all non-API routes
app.all("*", (c) => {
	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
	});
});

// Export the Hono app as the default export with an email handler
export default {
	// A demo has no MCP server, so no OAuth either.
	fetch: DEMO ? app.fetch : withMcpOAuth({ fetch: app.fetch }),
	async email(
		event: { to: string; raw: ReadableStream; rawSize: number; setReject(reason: string): void },
		env: Env,
		ctx: ExecutionContext,
	) {
		try {
			await receiveEmail(event, env, ctx);
		} catch (e) {
			console.error("Failed to process incoming email:", (e as Error).message, (e as Error).stack);
			ctx.waitUntil(recordError(env, "email", `to ${event.to}: ${(e as Error).message}`));
			// Re-throw so Cloudflare's email routing can retry delivery or bounce the message.
			// Swallowing the error would silently drop the email.
			throw e;
		}
	},
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		// The scheduled time, not the clock: a run that starts a minute late still counts as on the hour.
		ctx.waitUntil(runCron(env, controller.scheduledTime).catch((e) => {
			console.error("cron failed:", (e as Error).message);
			return recordError(env, "cron", e);
		}));
	},
	async queue(batch: MessageBatch<AutoDraftJob>, env: Env) {
		await consumeAutoDrafts(batch, env);
	},
};
