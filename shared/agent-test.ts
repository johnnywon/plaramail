// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Test on past mail (WON-530): an agent runs on received mail it already has,
 * and nothing is sent and no draft is saved. The run lives in
 * workers/agent/test-run.ts; the Console shows it on the agent's page.
 */

/** Messages a test takes when no number is given: the latest for the agent's addresses. */
export const TEST_DEFAULT = 25;
/** The most messages one test runs on. */
export const TEST_MAX = 50;

/**
 * took: the agent took the message (a reply agent wrote its reply, an action agent would act).
 * left: its rules or its job don't fit. skipped: a safety check stopped it before the model ran.
 * failed: the run errored, or the reply failed the draft check.
 */
export type TestOutcome = "pending" | "running" | "took" | "left" | "skipped" | "failed";

export interface TestResult {
	position: number;
	emailId: string;
	mailboxId: string;
	sender: string;
	subject: string;
	date: string;
	outcome: TestOutcome;
	reason: string | null;
	/** The reply it would have written, plain text. */
	reply: string | null;
	inputTokens: number;
	outputTokens: number;
}

export interface AgentTest {
	id: string;
	agentId: string;
	search: string;
	state: "running" | "done" | "stopped";
	model: string | null;
	inputTokens: number;
	outputTokens: number;
	/** USD, null when the model has no listed price. */
	cost: number | null;
	startedAt: string;
	finishedAt: string | null;
	/** setupKey of the agent when the run started. Null for runs from before 0.10. */
	setup: string | null;
	results: TestResult[];
}

/** The parts of an agent that change what it does with mail. Name and limits don't. */
export interface AgentSetupFields {
	job: string;
	addresses: readonly string[];
	rules: readonly { field: string; op: string; value: string }[];
	instructions: string;
	exampleReply: string;
	does: string;
	labelId: string | null;
}

/**
 * A short fingerprint of an agent's setup, kept with each Test run. When it no
 * longer matches, the run tested a setup the agent doesn't have any more.
 */
export function setupKey(a: AgentSetupFields): string {
	const text = JSON.stringify([
		a.job.trim(), [...a.addresses].map((x) => x.toLowerCase()).sort(),
		a.rules.map((r) => [r.field, r.op, r.value.trim().toLowerCase()]),
		a.instructions.trim(), a.exampleReply.trim(), a.does, a.labelId ?? null,
	]);
	// FNV-1a, twice with different seeds, for 64 bits without async crypto.
	const fnv = (seed: number) => {
		let h = seed >>> 0;
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		return h.toString(16).padStart(8, "0");
	};
	return fnv(0x811c9dc5) + fnv(0x01000193);
}

export interface TestCounts {
	total: number;
	took: number;
	left: number;
	skipped: number;
	failed: number;
	/** Not tested yet: pending or running. */
	waiting: number;
}

export function testCounts(results: readonly Pick<TestResult, "outcome">[]): TestCounts {
	const counts: TestCounts = { total: results.length, took: 0, left: 0, skipped: 0, failed: 0, waiting: 0 };
	for (const r of results) {
		if (r.outcome === "pending" || r.outcome === "running") counts.waiting++;
		else counts[r.outcome]++;
	}
	return counts;
}
