// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** The MCP server's paths and OAuth scopes. Docs and the Access bypass rule name these paths. */
export const MCP_ROUTE = "/mcp";
export const MCP_TOKEN_ENDPOINT = "/mcp/oauth/token";
export const MCP_REGISTER_ENDPOINT = "/mcp/oauth/register";
export const AUTHORIZE_ENDPOINT = "/authorize";

/** Read, organize, draft and delete mail. Every token has it. */
export const SCOPE_MAIL = "mail";
/** Send mail: send_draft, reply_to_email and send_email. Ticked on the consent page, off by default. */
export const SCOPE_SEND = "mail.send";
export const MCP_SCOPES = [SCOPE_MAIL, SCOPE_SEND] as const;

/** What a grant carries to the MCP server (`this.props` in EmailMCP). */
export interface McpProps extends Record<string, unknown> {
	userId: string;
	clientId: string;
	clientName: string;
	scopes: string[];
}

/** Whether this grant may send: the scope was granted and MCP_SEND_ENABLED isn't "false". */
export function canSend(props: Partial<McpProps> | undefined, env: { MCP_SEND_ENABLED?: string }): boolean {
	return !!props?.scopes?.includes(SCOPE_SEND) && env.MCP_SEND_ENABLED !== "false";
}
