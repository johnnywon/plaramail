// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Send limits per address. Everyone shares the hourly and daily limits;
 * agents and MCP clients also have their own daily cap and recipient cap,
 * set in Console > Limits (lib/agent-limits.ts). The check and the count are one SQL statement (see
 * D1Mailbox.takeSendBudget), so two sends can't both take the last slot.
 */

import { type AgentLimits, DEFAULT_AGENT_LIMITS, SEND_LIMITS } from "../../shared/send-limits";

/** Who asked for the send. Scheduled sends were scheduled by a person. */
export type SendActor = "person" | "agent" | "mcp";

export const isAgent = (actor: SendActor) => actor !== "person";

export function countRecipients(...lists: (string | string[] | undefined | null)[]): number {
	return lists
		.flatMap((list) => (Array.isArray(list) ? list : (list ?? "").split(",")))
		.map((a) => a.trim())
		.filter(Boolean).length;
}

/** Null when the message is within the recipient cap. */
export function recipientLimitError(actor: SendActor, count: number, limits: AgentLimits = DEFAULT_AGENT_LIMITS): string | null {
	const max = isAgent(actor) ? Math.min(limits.agentRecipients, SEND_LIMITS.recipients) : SEND_LIMITS.recipients;
	if (count <= max) return null;
	return isAgent(actor)
		? `Too many recipients: max ${max} per message from agents and MCP`
		: `Too many recipients: max ${max} per message`;
}

/** The message for a refused send, from the counts at the time. */
export function budgetError(actor: SendActor, counts: { hour: number; day: number; agentDay: number }, agentDay: number = DEFAULT_AGENT_LIMITS.agentDay): string {
	if (counts.hour >= SEND_LIMITS.hour) return `Rate limit exceeded: max ${SEND_LIMITS.hour} emails per hour per mailbox`;
	if (counts.day >= SEND_LIMITS.day) return `Rate limit exceeded: max ${SEND_LIMITS.day} emails per day per mailbox`;
	if (isAgent(actor) && counts.agentDay >= agentDay) {
		return agentDay === 0
			? "Agent sending is off: set a daily limit in Console > Limits"
			: `Agent send limit reached: max ${agentDay} emails per day per mailbox from agents and MCP`;
	}
	return "Rate limit exceeded";
}
