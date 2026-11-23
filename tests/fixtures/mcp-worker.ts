// Test-only worker: the MCP server at /mcp behind OAuth, the consent page at /authorize
// (signed in as owner@example.com), plus routes that apply the schema and create a mailbox with mail.
export { EmailMCP } from "../../workers/mcp";
import { authorize } from "../../workers/mcp/authorize";
import { withMcpOAuth } from "../../workers/mcp/oauth";
import { mailStore } from "../../workers/store";
import type { Env } from "../../workers/types";

const web = {
	async fetch(request: Request, env: Env) {
		const url = new URL(request.url);
		if (url.pathname === "/authorize") return authorize(request, env.OAUTH_PROVIDER!, "owner@example.com");
		if (url.pathname === "/_sql") {
			await env.DB.prepare(await request.text()).run();
			return Response.json({ ok: true });
		}
		if (url.pathname === "/_seed") {
			const { mailbox, emails } = (await request.json()) as { mailbox: string; emails: Record<string, unknown>[] };
			await mailStore(env).mailboxes.put(mailbox, {});
			const stub = mailStore(env).mailbox(mailbox);
			for (const email of emails) await stub.createEmail("inbox", email as never, []);
			return Response.json({ ok: true });
		}
		return new Response("Not found", { status: 404 });
	},
};

export default { fetch: withMcpOAuth(web) };
