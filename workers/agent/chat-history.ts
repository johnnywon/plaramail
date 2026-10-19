/**
 * What the chat agent sends of its stored conversation (#65). The panel keeps
 * every message, old tool output included, and the model gets the history on
 * every step of a run. Before a run the history is cut down:
 *
 * - The last KEEP_TURNS requests (a user message and everything after it) go whole.
 * - Older tool results longer than STUB_OVER characters become a short stub.
 *   The calls stay, so the model still knows what it did.
 * - Reasoning from earlier replies is dropped.
 * - If the history is still over HISTORY_BUDGET characters, the oldest
 *   requests are dropped whole until it fits. The last request always stays.
 */

import type { ModelMessage } from "ai";

export const KEEP_TURNS = 2;
/** Older tool results up to this many characters stay as they are. */
export const STUB_OVER = 300;
/** About 30 K tokens. */
export const HISTORY_BUDGET = 120_000;
export const TOOL_OUTPUT_STUB = "Output left out: it was for an earlier request. Call the tool again if you need it.";

export interface PruneOptions {
	keepTurns?: number;
	budget?: number;
}

/** Characters a message list takes as JSON, a stand-in for its token count. */
export function historySize(messages: ModelMessage[]): number {
	return JSON.stringify(messages).length;
}

/** Index of each user message: where each request starts. */
function turnStarts(messages: ModelMessage[]): number[] {
	const starts: number[] = [];
	messages.forEach((m, i) => { if (m.role === "user") starts.push(i); });
	return starts;
}

function withoutReasoning(message: ModelMessage): ModelMessage | null {
	if (message.role !== "assistant" || typeof message.content === "string") return message;
	const content = message.content.filter((part) => part.type !== "reasoning");
	return content.length ? { ...message, content } : null;
}

function stubbed(message: ModelMessage): ModelMessage {
	if (message.role !== "tool") return message;
	return {
		...message,
		content: message.content.map((part) =>
			part.type === "tool-result" && JSON.stringify(part.output).length > STUB_OVER
				? { ...part, output: { type: "text" as const, value: TOOL_OUTPUT_STUB } }
				: part),
	};
}

export function pruneHistory(messages: ModelMessage[], { keepTurns = KEEP_TURNS, budget = HISTORY_BUDGET }: PruneOptions = {}): ModelMessage[] {
	const starts = turnStarts(messages);
	const cut = starts.length > keepTurns ? starts[starts.length - keepTurns] : 0;
	let pruned: ModelMessage[] = [];
	messages.forEach((m, i) => {
		const kept = withoutReasoning(i < cut ? stubbed(m) : m);
		if (kept) pruned.push(kept);
	});

	// Over budget: drop the oldest requests whole, so no tool result loses its call.
	while (historySize(pruned) > budget) {
		const next = turnStarts(pruned);
		if (next.length < 2) break;
		pruned = pruned.slice(next[1]);
	}
	return pruned;
}
