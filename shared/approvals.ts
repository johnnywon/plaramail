// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The approval queue (WON-532). Each agent and each MCP client has its own
 * Hold for approval switch. While it is on, the sends and bulk changes it
 * makes wait in Console > Approvals until a person approves or drops them.
 * The queue itself is in workers/lib/approvals.ts.
 */

/** A bulk change is one call that moves, trashes, labels or marks more than this many messages. */
export const BULK_OVER = 25;
/** How long a queued item waits before it is dropped. */
export const QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
/** Hold is on by default for an agent's first days in Send. */
export const SEND_HOLD_DAYS = 7;

export type HoldKind = "agent" | "mcp";
export type QueueKind = "send" | "bulk";
export type QueueState = "waiting" | "running" | "approved" | "failed" | "dropped";

export interface QueueItem {
	id: string;
	kind: QueueKind;
	actor: HoldKind;
	sourceId: string;
	sourceName: string | null;
	tool: string;
	mailboxId: string | null;
	summary: string;
	/** Messages a bulk change covers. */
	messages: number | null;
	state: QueueState;
	/** What happened: the send's or change's result, the error, or why it was dropped. */
	result: string | null;
	createdAt: string;
	expiresAt: string;
	decidedAt: string | null;
}

/** Whether one call's change is big enough to hold. */
export const isBulk = (messages: number) => messages > BULK_OVER;

/**
 * An agent's hold when nobody has set it: on for its first SEND_HOLD_DAYS
 * days in Send, off otherwise.
 */
export function agentHoldDefault(agent: { mode: string; sendSince: string | null }, now = Date.now()): boolean {
	if (agent.mode !== "send" || !agent.sendSince) return false;
	const since = Date.parse(agent.sendSince);
	return Number.isFinite(since) && now - since < SEND_HOLD_DAYS * 86_400_000;
}
