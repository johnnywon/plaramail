// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { DraftNotes } from "../../../shared/draft-notes";
import { ownText } from "./draft-start";

/**
 * The agent's draft in the composer. It lands as a card under the writer's
 * text, never in it: the writer uses it, redrafts it or drops it. Send uses a
 * finished draft, drops one still being written, and never lets a rewrite
 * replace the writer's text. The agent never sends.
 */

export type Tone = "direct" | "friendly" | "formal";

export const TONES: [Tone, string][] = [["direct", "Direct"], ["friendly", "Friendly"], ["formal", "Formal"]];

/** Starting points for the request, by what the agent is asked to do. */
export const STARTS = {
	new: ["Ask for a time to talk", "Follow up", "Say thank you"],
	reply: ["Say yes", "Decline politely", "Ask for more detail"],
	rewrite: ["Tidy it up", "Make it shorter", "Make it warmer"],
	redraft: ["Shorter", "Warmer", "More formal"],
} as const;

export interface AgentDraft {
	/** writing: the agent has the request. done: the draft has landed. */
	status: "writing" | "done";
	/** write: a draft that joins the writer's text when used. rewrite: the writer's text rewritten, which replaces it only by Replace with this. */
	kind: "write" | "rewrite";
	/** The draft as HTML: escaped paragraphs from the agent's text, or a redraft's saved body. */
	html: string;
	request: string;
	tone?: Tone;
	/** The server draft the agent saved, deleted if the writer drops this one. */
	draftId?: string;
	notes?: DraftNotes;
	/** Which ask this is. A result for an older ask is dropped. */
	job: number;
}

/** The quoted original at the end of a reopened reply draft. */
const QUOTE_AT_END = /(\s*<br\s*\/?>\s*)?<blockquote[\s\S]*<\/blockquote>\s*$/i;

/** With text written, the agent rewrites it; otherwise it writes the message. */
export function draftKind(body: string): AgentDraft["kind"] {
	return ownText(body) ? "rewrite" : "write";
}

/**
 * The writer's body once they use the draft. A rewrite replaces their text;
 * a draft follows what they wrote. A quote at the end stays at the end.
 */
export function takeDraft(body: string, draft: Pick<AgentDraft, "kind" | "html">): string {
	const quote = body.match(QUOTE_AT_END)?.[0] ?? "";
	const own = quote ? body.slice(0, -quote.length) : body;
	if (draft.kind === "rewrite" || !ownText(own)) return `${draft.html}${quote}`;
	return `${own}${draft.html}${quote}`;
}

/**
 * What Send does with the agent's draft. A finished draft (not a rewrite)
 * goes with the message. A draft still being written, a rewrite and an empty
 * draft are dropped, and the writer's text goes as it is.
 */
export function bodyOnSend(body: string, draft: AgentDraft | null): { html: string; used: boolean; drop: boolean } {
	if (!draft) return { html: body, used: false, drop: false };
	if (draft.status !== "done" || draft.kind === "rewrite" || !ownText(draft.html)) return { html: body, used: false, drop: true };
	return { html: takeDraft(body, draft), used: true, drop: false };
}

/** The request and tone as the agent reads them, appended to its instructions. */
export function requestText({ request, tone, kind }: { request?: string; tone?: Tone; kind?: AgentDraft["kind"] }): string {
	const asked = request?.trim().replace(/\s+/g, " ");
	const parts = [
		kind === "rewrite" ? "Rewrite my text below as the draft, keeping what it says." : "",
		asked ? `What I want: ${asked}.`.replace(/([.!?])\.$/, "$1") : "",
		tone ? `Tone: ${tone}.` : "",
	];
	return parts.filter(Boolean).join(" ");
}
