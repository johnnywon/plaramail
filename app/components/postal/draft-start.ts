// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Starting a "Draft reply" request (#60). The request waits for the agent's
 * connection, is sent again once if nothing starts, then fails with an error.
 */

/** How long a request waits for the agent to start answering before it's sent again, then given up. */
export const DRAFT_START_MS = 8_000;

/** WebSocket.OPEN. */
const OPEN = 1;

/** Whether the agent's connection is open to take the request. */
export function canSend(readyState: number | undefined): boolean {
	return readyState === OPEN;
}

/** What to do at a check: the agent started, keep waiting, send again, or give up. `tries` counts sends so far. */
export function draftStartStep({ started, elapsed, tries }: { started: boolean; elapsed: number; tries: number }): "started" | "wait" | "retry" | "fail" {
	if (started) return "started";
	if (elapsed < DRAFT_START_MS) return "wait";
	return tries < 2 ? "retry" : "fail";
}

/** The quoted original at the end of a reply body. */
const QUOTE_AT_END = /(\s*<br\s*\/?>\s*)?<blockquote[\s\S]*<\/blockquote>\s*$/i;

/** A reply body's own text: no quote, no markup. */
export function ownText(html: string): string {
	return html
		.replace(QUOTE_AT_END, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;| /g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** A composer opened only for the agent to draft holds nothing to save until it or the user writes in the body. */
export function skipSave(openedToDraft: boolean, html: string): boolean {
	return openedToDraft && !ownText(html);
}
