// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * What came of the mail an agent took (WON-529), for Recent work and for Test
 * on past mail's "Then". workers/lib/agent-work.ts reads it.
 *
 * - waiting: its draft is still in Drafts.
 * - sent: its reply went, as the agent wrote it (or the agent sent it in Send).
 * - edited: a person changed the reply, then sent it.
 * - discarded: the draft is gone and nothing was sent.
 * - watched: Watch mode, or an action agent's Watch; done: an action agent acted.
 * - skipped, failed, running: the run's own state.
 * - none: the agent didn't take it (no run, or another agent took it).
 */
export type WorkOutcome = "waiting" | "sent" | "edited" | "discarded" | "watched" | "done" | "skipped" | "failed" | "running" | "none";

/** Whether the agent handled the message: it wrote, sent or (for an action agent) acted. */
export const handled = (o: WorkOutcome) => o === "waiting" || o === "sent" || o === "edited" || o === "discarded" || o === "watched" || o === "done";

export const WORK_LABELS: Record<WorkOutcome, string> = {
	waiting: "Waiting", sent: "Sent", edited: "Edited, sent", discarded: "Discarded", watched: "Watched", done: "Done",
	skipped: "Skipped", failed: "Failed", running: "Running", none: "Not taken",
};

/** One of an agent's runs with the message's subject and what came of it. */
export interface WorkRow {
	emailId: string;
	mailboxId: string;
	sender: string;
	subject: string;
	outcome: WorkOutcome;
	reason: string | null;
	draftId: string | null;
	createdAt: string;
}

/**
 * Whether a Test result disagrees with what happened when the message arrived: it would take one
 * the agent didn't, or leave one it did. A setup change shows up here first.
 */
export function differs(r: { outcome: string; then?: WorkOutcome }): boolean {
	if (!r.then || r.then === "running") return false;
	if (r.outcome === "took") return !handled(r.then);
	if (r.outcome === "left" || r.outcome === "skipped") return handled(r.then);
	return false;
}
