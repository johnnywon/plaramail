// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Msg, esc } from "../kit";
import type { StoryClock } from "./clock";
import { keepLinksLocal, prose } from "./html";

/** A message as the story writes it: a New York wall-clock time, and for a reply the line it quotes. */
export interface Slot extends Omit<Msg, "at"> {
	/** "2026-10-08T23:37", New York time, before the story moves (clock.ts). */
	at: string;
	/** The part of the parent this reply quotes. Only that part, not the whole conversation. */
	quote?: string;
}

/** Slots as stored messages: exact times, the quoted parent under each reply, links kept in the app. */
export function toMsgs(c: StoryClock, slots: Slot[]): Msg[] {
	const byKey = new Map(slots.map((s) => [s.key, s]));
	return slots.map(({ at, quote, ...s }) => {
		let html = s.html;
		if (quote) {
			const parent = byKey.get(s.replyTo ?? "");
			if (!parent) throw new Error(`${s.key} quotes a parent it doesn't have`);
			html += `<div class="gmail_quote"><p>On ${esc(c.long(c.at(parent.at)))}, ${esc(parent.from.name)} &lt;${esc(parent.from.addr)}&gt; wrote:</p><blockquote>${prose(quote)}</blockquote></div>`;
		}
		return { ...s, at: c.at(at), html: keepLinksLocal(html) };
	});
}
