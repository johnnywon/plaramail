import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-213: Send holds the message for a few seconds with Undo in the toast.

const { UNDO_SEND_MS, holdSend, heldSends, warnBeforeUnload } = await loadTs("app/components/postal/send-hold.ts");

/** Timers the test runs by hand. */
function fakeTimers() {
	const queue = new Map();
	let next = 1;
	return {
		set: (fn, ms) => { const id = next++; queue.set(id, { fn, ms }); return id; },
		clear: (id) => queue.delete(id),
		fire: () => { for (const [id, { fn }] of queue) { queue.delete(id); fn(); } },
		queue,
	};
}

test("the hold is a few seconds", () => {
	assert.ok(UNDO_SEND_MS >= 3000 && UNDO_SEND_MS <= 10000);
});

test("nothing is sent until the hold runs out, then it is sent once", async () => {
	const timers = fakeTimers();
	let sent = 0;
	const hold = holdSend(async () => { sent++; }, 5000, timers);
	assert.equal(sent, 0);
	assert.equal(heldSends(), 1);
	assert.equal([...timers.queue.values()][0].ms, 5000);
	timers.fire();
	assert.equal(await hold.done, "sent");
	assert.equal(sent, 1);
	assert.equal(heldSends(), 0);
	assert.equal(hold.undo(), false);
});

test("undo in the hold cancels the send", async () => {
	const timers = fakeTimers();
	let sent = 0;
	const hold = holdSend(async () => { sent++; }, 5000, timers);
	assert.equal(hold.undo(), true);
	assert.equal(await hold.done, "undone");
	timers.fire();
	assert.equal(sent, 0);
	assert.equal(heldSends(), 0);
	assert.equal(hold.undo(), false);
});

test("a failed send rejects", async () => {
	const timers = fakeTimers();
	const hold = holdSend(async () => { throw new Error("quota"); }, 5000, timers);
	timers.fire();
	await assert.rejects(hold.done, /quota/);
	assert.equal(heldSends(), 0);
});

test("the page asks before closing while a send is held", () => {
	const timers = fakeTimers();
	const event = () => { const e = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; return e; };
	const idle = event();
	warnBeforeUnload(idle);
	assert.equal(idle.prevented, false);
	const hold = holdSend(async () => {}, 5000, timers);
	const busy = event();
	warnBeforeUnload(busy);
	assert.equal(busy.prevented, true);
	hold.undo();
});

test("the mail view's composers send through the held sender", () => {
	const mail = readFileSync(new URL("../app/components/postal/PostalMail.tsx", import.meta.url), "utf8");
	assert.equal((mail.match(/sender=\{heldSender\}/g) ?? []).length, 2);
	assert.doesNotMatch(mail, /sender=\{sender\}/);
	assert.match(mail, /sender\.check\(state\);\n\t\t\tconst hold = holdSend\(/);
	const win = readFileSync(new URL("../app/components/postal/ComposeWindow.tsx", import.meta.url), "utf8");
	assert.match(win, /props\.onClosed\(held \? null : sentText\(stateRef\.current\)\)/);
	assert.doesNotMatch(win, /TODO\(roadmap\): undo send/);
});
