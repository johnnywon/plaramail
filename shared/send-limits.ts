// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Send limits per address. The hourly and daily limits and the recipient cap
 * for people are fixed ceilings; agent limits are set in Console > Limits,
 * inside them. Enforced in workers/lib/send-budget.ts.
 */

export const SEND_LIMITS = {
	/** Every sender, per address. */
	hour: 20,
	day: 100,
	/** Recipients on one message, To, Cc and Bcc together. Email Sending allows 50. */
	recipients: 50,
} as const;

/** What Console > Limits sets. Saved to the deployment (R2 config/agent-limits.json). */
export interface AgentLimits {
	/** Sends a day per address by agents and MCP clients together. 0 stops agent sending. */
	agentDay: number;
	/** Recipients on one message an agent or MCP client sends. */
	agentRecipients: number;
	/** Auto-drafts a day per sender per address. Later mail from that sender is stored but not drafted. */
	autoDraftPerSender: number;
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = { agentDay: 20, agentRecipients: 10, autoDraftPerSender: 3 };

/** Allowed range for each limit. Agent sends can't pass the daily ceiling, nor recipients the per-message one. */
export const AGENT_LIMIT_RANGES: Record<keyof AgentLimits, { min: number; max: number }> = {
	agentDay: { min: 0, max: SEND_LIMITS.day },
	agentRecipients: { min: 1, max: SEND_LIMITS.recipients },
	autoDraftPerSender: { min: 0, max: 50 },
};

/** Limits from untrusted input: each known field is kept if it is a whole number in range, otherwise it comes from base. */
export function cleanAgentLimits(input: unknown, base: AgentLimits = DEFAULT_AGENT_LIMITS): AgentLimits {
	const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const pick = (key: keyof AgentLimits) => {
		const v = o[key];
		const { min, max } = AGENT_LIMIT_RANGES[key];
		return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : base[key];
	};
	return { agentDay: pick("agentDay"), agentRecipients: pick("agentRecipients"), autoDraftPerSender: pick("autoDraftPerSender") };
}

/** A limit as typed in Console > Limits, or null unless it is a whole number in range. Empty is not 0. */
export function parseAgentLimit(key: keyof AgentLimits, text: string): number | null {
	const trimmed = text.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const n = Number(trimmed);
	const { min, max } = AGENT_LIMIT_RANGES[key];
	return n >= min && n <= max ? n : null;
}

export const sameAgentLimits = (a: AgentLimits, b: AgentLimits) =>
	a.agentDay === b.agentDay && a.agentRecipients === b.agentRecipients && a.autoDraftPerSender === b.autoDraftPerSender;
