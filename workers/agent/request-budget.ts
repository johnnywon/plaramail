// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * A size limit on every model request (WON-593). pruneHistory (chat-history.ts)
 * cuts the stored history once before a run, but a run's own steps add tool
 * output, and one request can be larger than the whole budget. boundRequest
 * runs in prepareStep, so it applies to every step's request, not only the first.
 *
 * Sizes are characters of the messages as JSON, a stand-in for tokens (about
 * four characters each). The system prompt and the tool definitions are
 * counted against the same budget. In order, until the request fits:
 *
 * 1. Earlier requests go whole, oldest first, as in pruneHistory.
 * 2. Tool results in the current request become a stub, oldest first. The
 *    latest KEEP_RESULTS stay. The call stays with its stubbed result.
 * 3. Any tool result still over RESULT_MAX is cut to its start, with a note.
 * 4. The user's message, if over USER_TEXT_MAX, keeps its start and end with
 *    a note saying how much was left out of the middle.
 *
 * Every cut says so in the text the model reads, so it can tell the person or
 * ask for less. A request still over budget after all four goes as it is: the
 * limit never drops the request itself or a tool call's result.
 */

import type { ModelMessage } from "ai";
import { historySize } from "./chat-history";

/** About 40 K tokens for the whole chat request: system, tools and messages. */
export const CHAT_REQUEST_BUDGET = 160_000;
/** About 20 K tokens for a drafting run's request. */
export const DRAFT_REQUEST_BUDGET = 80_000;
/** The latest tool results in the current request that are never stubbed. */
export const KEEP_RESULTS = 2;
/** The most one tool result can take once stubbing is not enough. */
export const RESULT_MAX = 24_000;
/** The most of a person's message that goes, start and end kept. */
export const USER_TEXT_MAX = 40_000;

export const RESULT_STUB = "Output left out to keep this request under its size limit. Call the tool again, asking for less, if you need it.";

/** A note in the text that `n` characters were cut. */
export const cutNote = (n: number, where: "end" | "middle") =>
	`[${n} characters left out of the ${where} to keep this request under its size limit]`;

/** `text` cut to `max` characters: its start, or its start and end, with a note saying so. */
export function clipText(text: string, max: number, keep: "start" | "both" = "start"): string {
	if (text.length <= max) return text;
	const cut = text.length - max;
	if (keep === "start") return `${text.slice(0, max)}\n${cutNote(cut, "end")}`;
	const head = Math.ceil(max * 0.75);
	return `${text.slice(0, head)}\n${cutNote(cut, "middle")}\n${text.slice(text.length - (max - head))}`;
}

/** Characters the system prompt and tool definitions take, counted against the budget. */
export function fixedSize(system: string, tools: Record<string, { description?: string; inputSchema?: unknown }> = {}): number {
	let size = system.length;
	for (const [name, tool] of Object.entries(tools)) {
		size += name.length + (tool.description?.length ?? 0);
		try {
			size += JSON.stringify(tool.inputSchema ?? {}).length;
		} catch {
			size += 200;
		}
	}
	return size;
}

const lastUser = (messages: ModelMessage[]) => {
	for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i;
	return -1;
};

type ToolMessage = Extract<ModelMessage, { role: "tool" }>;
type ToolPart = ToolMessage["content"][number];

const outputSize = (part: ToolPart) => (part.type === "tool-result" ? JSON.stringify(part.output).length : 0);

function mapResults(messages: ModelMessage[], from: number, fn: (part: ToolPart, index: number) => ToolPart): ModelMessage[] {
	let index = 0;
	return messages.map((m, i) => {
		if (i < from || m.role !== "tool") return m;
		return { ...m, content: m.content.map((part) => (part.type === "tool-result" ? fn(part, index++) : part)) };
	});
}

function textOf(output: unknown): string {
	const o = output as { type?: string; value?: unknown };
	if (o?.type === "text" || o?.type === "error-text") return String(o.value ?? "");
	return JSON.stringify(o?.type === "json" || o?.type === "error-json" ? o.value : output);
}

/** The messages of one request, cut to fit `budget` characters less `fixed`. See the module comment for the order. */
export function boundRequest(messages: ModelMessage[], budget: number, fixed = 0): ModelMessage[] {
	const room = Math.max(budget - fixed, 0);
	if (historySize(messages) <= room) return messages;

	// 1. Earlier requests, oldest first.
	let out = messages;
	while (historySize(out) > room) {
		const starts = out.flatMap((m, i) => (m.role === "user" ? [i] : []));
		if (starts.length < 2) break;
		out = out.slice(starts[1]);
	}
	if (historySize(out) <= room) return out;

	// 2. Tool results in this request, oldest first, except the latest KEEP_RESULTS.
	const from = Math.max(lastUser(out), 0);
	const total = out.slice(from).flatMap((m) => (m.role === "tool" ? m.content.filter((p) => p.type === "tool-result") : [])).length;
	for (let n = 0; n < total - KEEP_RESULTS && historySize(out) > room; n++) {
		out = mapResults(out, from, (part, i) => (i === n && outputSize(part) > RESULT_STUB.length + 40
			? { ...part, output: { type: "text" as const, value: RESULT_STUB } } as ToolPart
			: part));
	}
	if (historySize(out) <= room) return out;

	// 3. Results still over RESULT_MAX, cut to their start.
	out = mapResults(out, from, (part) => (outputSize(part) > RESULT_MAX && part.type === "tool-result"
		? { ...part, output: { type: "text" as const, value: clipText(textOf(part.output), RESULT_MAX) } } as ToolPart
		: part));
	if (historySize(out) <= room) return out;

	// 4. The person's own message, start and end kept.
	return out.map((m, i) => {
		if (i !== from || m.role !== "user") return m;
		if (typeof m.content === "string") return { ...m, content: clipText(m.content, USER_TEXT_MAX, "both") };
		return { ...m, content: m.content.map((part) => (part.type === "text" ? { ...part, text: clipText(part.text, USER_TEXT_MAX, "both") } : part)) };
	});
}
