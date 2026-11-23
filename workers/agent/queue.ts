// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Auto-draft on Cloudflare Queues: the producer side for inbound mail, and the consumer. See ./runs.ts. */
import { readAgentLimits } from "../lib/agent-limits";
import { toolDiscardDraft } from "../lib/tools";
import { recordsSql } from "../store";
import type { Env } from "../types";
import { AUTO_DRAFT_MAX_RETRIES, type AutoDraftJob, type AutoDraftTarget, attemptRun, recordRun, retryDelay } from "./runs";

/** The DRAFT_QUEUE binding. Optional: without it auto-draft runs once in waitUntil. */
export function draftQueue(env: Env): Queue<AutoDraftJob> | undefined {
	return (env as unknown as { DRAFT_QUEUE?: Queue<AutoDraftJob> }).DRAFT_QUEUE;
}

/** One attempt, drafting through the address's agent. */
export function processAutoDraft(env: Env, job: AutoDraftJob, final: boolean) {
	return attemptRun(recordsSql(env), job, (target) => {
		const agent = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(target.mailboxId));
		return agent.handleNewEmail(target);
	}, { final, discardDraft: (mailboxId, draftId) => toolDiscardDraft(env, mailboxId, draftId) });
}

/** Record the run for new inbound mail and hand it to the queue. */
export async function startAutoDraft(env: Env, ctx: ExecutionContext, target: AutoDraftTarget) {
	const { autoDraftPerSender } = await readAgentLimits(env);
	const run = await recordRun(recordsSql(env), target, Date.now(), autoDraftPerSender);
	if (!run) return;
	if (run.state === "skipped") {
		console.log(`Auto-draft skipped for ${target.emailId}: ${run.reason}`);
		return;
	}
	const queue = draftQueue(env);
	if (queue) {
		await queue.send({ emailId: target.emailId });
		return;
	}
	ctx.waitUntil(processAutoDraft(env, { emailId: target.emailId }, true)
		.catch((e) => console.error("Auto-draft failed:", (e as Error).message)));
}

/** The queue consumer. A failed attempt retries with backoff; the queue dead-letters it after the last. */
export async function consumeAutoDrafts(batch: MessageBatch<AutoDraftJob>, env: Env) {
	for (const message of batch.messages) {
		const final = message.attempts > AUTO_DRAFT_MAX_RETRIES;
		try {
			const outcome = await processAutoDraft(env, message.body, final);
			if (outcome === "retry") message.retry({ delaySeconds: retryDelay(message.attempts) });
			else if (outcome === "done") message.ack();
			else message.retry({ delaySeconds: outcome.wait });
		} catch (e) {
			console.error("Auto-draft attempt failed:", (e as Error).message);
			message.retry({ delaySeconds: retryDelay(message.attempts) });
		}
	}
}
