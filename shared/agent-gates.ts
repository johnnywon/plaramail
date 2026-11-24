// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * What an agent needs before it moves up a rung (WON-531). The gates block the
 * move: the Console disables it and the API refuses it. Moving down is always
 * allowed. The record behind each gate comes from workers/lib/agent-evidence.ts.
 *
 * - Watch to Draft (and Watch to On for an action agent): 10 messages matched
 *   and none failed in the last 7 days.
 * - Draft to Send: a Test run of 20 or more messages with no failures, on the
 *   agent's setup as it is now (a setup change needs a new run), at least
 *   10 agent drafts sent with 8 of every 10 sent without edits, and no safety
 *   check failures in the last 7 days.
 */

export const GATES = {
	/** Messages matched in the last 7 days before Watch moves up. */
	matched: 10,
	/** Messages a Test run needs before Draft moves to Send. */
	tested: 20,
	/** Agent drafts sent before Draft moves to Send. */
	sent: 10,
	/** Of the drafts sent, the share sent without edits. */
	unedited: 0.8,
} as const;

/** The record an agent's gates read. */
export interface AgentEvidence {
	/** The last 7 days of live runs. */
	week: { matched: number; failed: number };
	/** The agent's latest Test run, or null when it has none. */
	test: { id: string; state: "running" | "done" | "stopped"; tested: number; failed: number; startedAt: string; finishedAt: string | null; current: boolean } | null;
	/** Agent drafts a person sent, and how many went without edits. */
	drafts: { sent: number; unedited: number };
	/** Safety checks that stopped this agent's mail or replies in the last 7 days, newest first. */
	safety: { count: number; latest: { at: string; reason: string }[] };
}

export interface GateCheck {
	id: "matched" | "week-failed" | "test" | "drafts-sent" | "unedited" | "safety";
	label: string;
	/** The record it reads, in a few words. */
	record: string;
	met: boolean;
	/** How far along, 0 to 1. */
	value: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const ratio = (n: number, of: number) => (of > 0 ? Math.min(1, Math.max(0, n / of)) : 0);

/** Watch to Draft, and Watch to On. Labels and records stay short: the Console shows them side by side. */
function watchGate(e: AgentEvidence): GateCheck[] {
	return [
		{
			id: "matched", label: `${GATES.matched} matched in 7 days`, record: `${e.week.matched.toLocaleString()} of ${GATES.matched}`,
			met: e.week.matched >= GATES.matched, value: ratio(e.week.matched, GATES.matched),
		},
		{
			id: "week-failed", label: "None failed in 7 days", record: e.week.failed ? `${plural(e.week.failed, "run")} failed` : "0 failed",
			met: e.week.failed === 0, value: e.week.failed === 0 ? 1 : 0,
		},
	];
}

/** Draft to Send. */
function sendGate(e: AgentEvidence): GateCheck[] {
	const t = e.test;
	const testDone = !!t && t.state !== "running";
	// A run on a setup the agent no longer has doesn't count: run Test again (WON-529).
	const testMet = testDone && t.current && t.tested >= GATES.tested && t.failed === 0;
	const share = e.drafts.sent ? e.drafts.unedited / e.drafts.sent : 0;
	return [
		{
			id: "test", label: `Test on ${GATES.tested}, none failed`,
			record: !t ? "No run yet" : !t.current ? "Setup changed" : t.state === "running" ? `Running, ${t.tested} done` : `${t.tested} tested, ${t.failed ? `${t.failed} failed` : "0 failed"}`,
			met: testMet, value: testMet ? 1 : t && t.current && t.failed === 0 ? ratio(t.tested, GATES.tested) : 0,
		},
		{
			id: "drafts-sent", label: `${GATES.sent} drafts sent`, record: `${e.drafts.sent.toLocaleString()} of ${GATES.sent}`,
			met: e.drafts.sent >= GATES.sent, value: ratio(e.drafts.sent, GATES.sent),
		},
		{
			id: "unedited", label: `${Math.round(GATES.unedited * 10)} of 10 sent unedited`,
			record: e.drafts.sent ? `${e.drafts.unedited} of ${e.drafts.sent}` : "None sent",
			met: e.drafts.sent > 0 && share >= GATES.unedited, value: ratio(share, GATES.unedited),
		},
		{
			id: "safety", label: "No safety failures in 7 days",
			record: e.safety.count ? `${e.safety.count} failed` : "0 failed",
			met: e.safety.count === 0, value: e.safety.count === 0 ? 1 : 0,
		},
	];
}

/** Rungs from the bottom: a reply agent's, then an action agent's. */
const LADDERS = { reply: ["watch", "draft", "send"], action: ["watch", "on"] } as const;

/** How high a mode sits on its ladder, or -1 when it isn't on it. */
export function rungOf(mode: string, action: boolean): number {
	return (LADDERS[action ? "action" : "reply"] as readonly string[]).indexOf(mode);
}

/** The checks for moving from `from` up to `to`. Empty when the move is down, sideways or unknown. */
export function gateChecks(from: string, to: string, action: boolean, evidence: AgentEvidence): GateCheck[] {
	const a = rungOf(from, action);
	const b = rungOf(to, action);
	if (a < 0 || b <= a) return [];
	// Skipping a rung needs every gate on the way.
	const checks: GateCheck[] = [];
	if (a === 0) checks.push(...watchGate(evidence));
	if (!action && b === 2) checks.push(...sendGate(evidence));
	return checks;
}

/** Why the move is refused, or null when every check is met. */
export function gateRefusal(checks: readonly GateCheck[]): string | null {
	const missing = checks.filter((c) => !c.met);
	if (missing.length === 0) return null;
	return `Not yet. Still needed: ${missing.map((c) => c.label.charAt(0).toLowerCase() + c.label.slice(1)).join("; ")}.`;
}
