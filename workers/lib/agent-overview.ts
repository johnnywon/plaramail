// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Console > Overview: each address's sends against its limits, and the last day of auto-draft runs and failed agent actions. */

import type { AgentLimits } from "../../shared/send-limits";
import type { Sql } from "../store/sql";
import { type ActivityRow, listActivity } from "./activity";

export interface AddressUsage {
	mailboxId: string;
	/** Sends in the last hour and day, by anyone. */
	hour: number;
	day: number;
	/** Sends in the last day by agents and MCP clients. */
	agentDay: number;
}

export interface AgentOverview {
	limits: AgentLimits;
	addresses: AddressUsage[];
	/** Auto-draft runs started in the last day, by state. */
	runs: Record<string, number>;
	/** Agent actions that failed in the last day. */
	failed: number;
	/** The newest five of those. */
	failures: ActivityRow[];
	/** Agent actions in the last day. */
	actions: number;
}

export async function agentOverview(sql: Sql, mailboxIds: string[], limits: AgentLimits, now = Date.now()): Promise<AgentOverview> {
	const hour = new Date(now - 3_600_000).toISOString();
	const day = new Date(now - 86_400_000).toISOString();
	const [usage, runs, actions] = await sql.batch([
		{
			sql: `SELECT mailbox_id, COALESCE(SUM(at >= ?), 0) AS hour, COUNT(*) AS day, COALESCE(SUM(actor != 'person'), 0) AS agent_day
				FROM send_budget WHERE at >= ? GROUP BY mailbox_id`,
			params: [hour, day],
		},
		{ sql: `SELECT state, COUNT(*) AS n FROM auto_draft_runs WHERE created_at >= ? GROUP BY state`, params: [day] },
		{ sql: `SELECT COUNT(*) AS n, COALESCE(SUM(ok = 0), 0) AS failed FROM agent_activity WHERE at >= ?`, params: [day] },
	]);
	const byMailbox = new Map(usage.map((r) => [String(r.mailbox_id), r]));
	const failed = Number(actions[0]?.failed ?? 0);
	const recent = failed > 0 ? (await listActivity(sql, { failed: true, since: day, limit: 5 })).entries : [];
	return {
		limits,
		addresses: mailboxIds.map((mailboxId) => {
			const r = byMailbox.get(mailboxId);
			return { mailboxId, hour: Number(r?.hour ?? 0), day: Number(r?.day ?? 0), agentDay: Number(r?.agent_day ?? 0) };
		}),
		runs: Object.fromEntries(runs.map((r) => [String(r.state), Number(r.n)])),
		failed,
		failures: recent,
		actions: Number(actions[0]?.n ?? 0),
	};
}
