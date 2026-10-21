// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Undo send (WON-213). Send holds the message in the browser for
 * UNDO_SEND_MS, then sends it. Undo in that time cancels it. The draft is
 * saved before the hold starts and deleted only after the send, so a tab
 * closed during the hold leaves the message in Drafts; while a hold runs, the
 * browser asks before the page closes. Scheduled send can't hold this
 * briefly: it needs 30 seconds of lead and its cron runs once a minute.
 */

export const UNDO_SEND_MS = 5000;

export interface Hold {
	/** Cancel the send. False once it has started. */
	undo(): boolean;
	/** "sent" after the send, "undone" after undo; rejects when the send fails. */
	done: Promise<"sent" | "undone">;
}

const pending = new Set<Hold>();

/** How many sends are waiting out their hold. */
export function heldSends(): number {
	return pending.size;
}

interface Timers {
	set: (fn: () => void, ms: number) => unknown;
	clear: (t: unknown) => void;
}
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

/** Run `send` after `ms` unless undone first. */
export function holdSend(send: () => Promise<void>, ms = UNDO_SEND_MS, timers: Timers = realTimers): Hold {
	let held = true;
	let settle!: (v: "sent" | "undone") => void;
	let fail!: (e: unknown) => void;
	const done = new Promise<"sent" | "undone">((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});
	const hold: Hold = {
		undo() {
			if (!held) return false;
			held = false;
			timers.clear(timer);
			pending.delete(hold);
			settle("undone");
			return true;
		},
		done,
	};
	const timer = timers.set(() => {
		held = false;
		send().then(
			() => { pending.delete(hold); settle("sent"); },
			(e) => { pending.delete(hold); fail(e); },
		);
	}, ms);
	pending.add(hold);
	return hold;
}

/** Keep the page from closing silently while a send is held. */
export function warnBeforeUnload(e: BeforeUnloadEvent) {
	if (!heldSends()) return;
	e.preventDefault();
	e.returnValue = "";
}
