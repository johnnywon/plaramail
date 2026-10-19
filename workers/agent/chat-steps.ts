// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The chat panel's step budget (#29). A run gets CHAT_STEP_LIMIT model steps.
 * The last one has no tools, so a run that hits the limit ends on a written
 * answer that says it stopped, instead of a half-finished "Now the next one."
 */

import type { UIMessageChunk } from "ai";

export const CHAT_STEP_LIMIT = 20;

/** The note the model gets for its last step. */
export function stepLimitNote(limit = CHAT_STEP_LIMIT): string {
	return `This is your last step: you have used ${limit - 1} of ${limit} steps and cannot call tools now. ` +
		`Start your reply with "Stopped after ${limit - 1} steps." Then say what you finished and what is left, ` +
		`and that the user can ask you to continue. Do not say that unfinished work is done.`;
}

/**
 * `prepareStep` for streamText: no tools and the note above on the last step.
 * `activeTools: []` leaves the tools out of the request, because Workers AI
 * doesn't pass `toolChoice: "none"` on and the model could still call one.
 */
export function chatPrepareStep(system: string, limit = CHAT_STEP_LIMIT) {
	return ({ stepNumber }: { stepNumber: number }) =>
		stepNumber >= limit - 1
			? { toolChoice: "none" as const, activeTools: [] as never[], system: `${system}\n\n${stepLimitNote(limit)}` }
			: {};
}

/** The line the panel shows when a run ran out of steps partway through. */
export function stepLimitLine(limit = CHAT_STEP_LIMIT): string {
	return `Stopped after ${limit} steps. Ask me to continue.`;
}

/**
 * Adds stepLimitLine as a text part before the stream's finish when the run
 * ended on tool calls: the model still had work to do when the steps ran out.
 * AIChatAgent saves the part with the message, so the line stays after a reload.
 */
export function withStepLimitLine(stream: ReadableStream<UIMessageChunk>, limit = CHAT_STEP_LIMIT): ReadableStream<UIMessageChunk> {
	return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
		transform(chunk, controller) {
			if (chunk.type === "finish" && chunk.finishReason === "tool-calls") {
				const id = `step-limit-${crypto.randomUUID()}`;
				controller.enqueue({ type: "text-start", id });
				controller.enqueue({ type: "text-delta", id, delta: stepLimitLine(limit) });
				controller.enqueue({ type: "text-end", id });
			}
			controller.enqueue(chunk);
		},
	}));
}
