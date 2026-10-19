// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { errorResponse } from "../lib/error-page";
import { type McpProps, SCOPE_MAIL, SCOPE_SEND } from "./scopes";

/**
 * The consent page at /authorize. It sits behind Cloudflare Access like the app,
 * so whoever reaches it is signed in; `userId` is who that is. GET shows the page,
 * POST approves or declines. Mail access is always granted; sending only when
 * the box is ticked.
 */
export async function authorize(request: Request, oauth: OAuthHelpers, userId: string): Promise<Response> {
	try {
		if (request.method === "GET") {
			const authRequest = await oauth.parseAuthRequest(request);
			const details = await oauth.describeConsent(authRequest);
			const consent = await oauth.beginConsent(authRequest);
			consent.headers.set("Content-Type", "text/html; charset=utf-8");
			consent.headers.set("Cache-Control", "no-store");
			return new Response(consentHtml(details, consent.handle, userId), { headers: consent.headers });
		}
		if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });

		const form = await request.formData();
		const handle = String(form.get("handle") ?? "");
		if (form.get("decision") !== "approve") {
			const denied = await oauth.denyConsent(request, handle);
			return new Response(null, { status: 302, headers: denied.headers });
		}
		const scope = form.get("send") === "on" ? [SCOPE_MAIL, SCOPE_SEND] : [SCOPE_MAIL];
		const approved = await oauth.approveConsent(request, handle, { scope });
		const client = await oauth.lookupClient(approved.request.clientId);
		const clientName = client?.clientName || approved.request.clientId;
		const props: McpProps = { userId, clientId: approved.request.clientId, clientName, scopes: scope };
		const { redirectTo } = await oauth.completeAuthorization({
			request: approved.request,
			userId: encodeURIComponent(userId),
			metadata: { clientName },
			scope,
			props,
		});
		approved.headers.set("Location", redirectTo);
		return new Response(null, { status: 302, headers: approved.headers });
	} catch (e) {
		if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
		if (e instanceof AuthorizationError) return errorResponse(request, 400, "Can't connect this app", e.description);
		if (e instanceof CimdFetchError) return errorResponse(request, 400, "Can't connect this app", "The app's details could not be loaded.");
		console.error("MCP authorize failed:", (e as Error)?.message ?? e);
		return errorResponse(request, 400, "Can't connect this app", "This app's sign-in request could not be read.");
	}
}

const escape = (text: string) =>
	text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

/** The consent page: who is asking, where the tokens go, and what it may do. Everything from the client is escaped. */
export function consentHtml(details: ConsentDescription, handle: string, userId: string): string {
	const name = escape(details.clientName);
	const origin = details.clientDomain
		? `Published by <b>${escape(details.clientDomain)}</b>.`
		: "This app registered itself. Its name is not verified.";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect ${name}</title>
<style>
:root { color-scheme: dark; --base: #141518; --raised: #1b1c20; --line: #2a2c31; --t1: #f0f0ed; --t4: #c9c9c5; --t6: #8b8d93; --warn: #e2b54a; --primary: #e4e4e1; --on-primary: #141518; }
@media (prefers-color-scheme: light) { :root { color-scheme: light; --base: #f6f6f4; --raised: #ffffff; --line: #dcdcd8; --t1: #111214; --t4: #383a40; --t6: #5c5e64; --warn: #8a6510; --primary: #1b1c20; --on-primary: #f6f6f4; } }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--base); }
body { min-height: 100vh; min-height: 100dvh; display: flex; font: 13px/1.5 "Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif; color: var(--t4); }
main { margin: auto; width: 100%; max-width: 440px; padding: 48px 16px; display: flex; flex-direction: column; gap: 14px; }
.code { margin: 0; font: 500 11px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace; letter-spacing: .08em; color: var(--t6); text-transform: uppercase; }
h1 { margin: 0; font-size: 20px; font-weight: 600; color: var(--t1); overflow-wrap: anywhere; }
p { margin: 0; color: var(--t6); overflow-wrap: anywhere; }
b { color: var(--t1); font-weight: 600; }
.warn { color: var(--warn); }
fieldset { margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: var(--raised); }
label { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; color: var(--t1); }
label + label { border-top: 1px solid var(--line); }
label span { display: block; color: var(--t6); }
input { margin: 3px 0 0; accent-color: var(--primary); }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
button { height: 30px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--t1); font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
button[value="approve"] { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
</style>
</head>
<body>
<main>
<p class="code">PluraMail · MCP</p>
<h1>Connect ${name}?</h1>
<p>${origin} Access goes to <b>${escape(details.redirectHost)}</b>. Signed in as <b>${escape(userId)}</b>.</p>
${details.redirectIsLoopback ? '<p class="warn">This app runs on your computer. Continue only if you just started connecting it.</p>' : ""}
<form method="post">
<input type="hidden" name="handle" value="${escape(handle)}">
<fieldset>
<label><input type="checkbox" checked disabled><div>Read and organize mail<span>Search, read, label, move, draft and delete, on every address.</span></div></label>
<label><input type="checkbox" name="send"><div>Send mail<span>Send drafts, replies and new email from your addresses, within the send limits.</span></div></label>
</fieldset>
<div class="actions">
<button type="submit" name="decision" value="deny">Deny</button>
<button type="submit" name="decision" value="approve">Connect</button>
</div>
</form>
</main>
</body>
</html>`;
}
