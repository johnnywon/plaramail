// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	/** "true" makes the cron convert attachments to searchable text. Costs Workers AI calls per file. */
	ATTACHMENT_SEARCH?: string;
	/** "off" in .dev.vars keeps the local dev server from filling the inbox with sample mail. */
	DEV_SEED?: string;
	/** Local QA and demo builds: which sample inbox to write. `alex` for the Alex Rivera profile; anything else is the default. */
	SEED_PROFILE?: string;
	/** Demo builds: model calls allowed per UTC day across all visitors (workers/lib/demo.ts). */
	DEMO_AI_DAILY?: string;
	/** "false" takes the send tools away from every MCP client, whatever its grant. */
	MCP_SEND_ENABLED?: string;
	/** Where the hourly alert mail goes when something fails (workers/lib/alerts.ts). Unset sends none. */
	ALERT_TO?: string;
	/** Set by the OAuth provider (workers/mcp/oauth.ts) for /authorize and Console > MCP. Absent on a demo. */
	OAUTH_PROVIDER?: OAuthHelpers;
}
