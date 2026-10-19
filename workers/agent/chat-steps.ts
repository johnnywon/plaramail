/**
 * The chat panel's step budget (#29). A run gets CHAT_STEP_LIMIT model steps.
 * The last one has no tools, so a run that hits the limit ends on a written
 * answer that says it stopped, instead of a half-finished "Now the next one."
 */

export const CHAT_STEP_LIMIT = 20;

/** The note the model gets for its last step. */
export function stepLimitNote(limit = CHAT_STEP_LIMIT): string {
	return `This is your last step: you have used ${limit - 1} of ${limit} steps and cannot call tools now. ` +
		`Start your reply with "Stopped after ${limit - 1} steps." Then say what you finished and what is left, ` +
		`and that the user can ask you to continue. Do not say that unfinished work is done.`;
}

/** `prepareStep` for streamText: no tools and the note above on the last step. */
export function chatPrepareStep(system: string, limit = CHAT_STEP_LIMIT) {
	return ({ stepNumber }: { stepNumber: number }) =>
		stepNumber >= limit - 1
			? { toolChoice: "none" as const, system: `${system}\n\n${stepLimitNote(limit)}` }
			: {};
}
