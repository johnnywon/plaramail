import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/sqlite.mjs";

// Draft reply from the reader's reply bar (#60): the ask waits for the agent's connection,
// is sent again once if nothing starts, then fails with an error, and an empty reply opened
// only for drafting is never saved as a draft that hides the Draft reply button.

const ds = await loadTs("app/components/postal/draft-start.ts");

test("the ask waits for an open connection", () => {
	assert.equal(ds.canSend(1), true, "OPEN");
	for (const state of [0, 2, 3, undefined]) assert.equal(ds.canSend(state), false, `readyState ${state}`);
});

test("a draft that doesn't start is asked again once, then fails", () => {
	const W = ds.DRAFT_START_MS;
	const cases = [
		[{ started: true, elapsed: W * 5, tries: 1 }, "started"],
		[{ started: false, elapsed: W - 1, tries: 1 }, "wait"],
		[{ started: false, elapsed: W, tries: 1 }, "retry"],
		[{ started: false, elapsed: W - 1, tries: 2 }, "wait"],
		[{ started: false, elapsed: W, tries: 2 }, "fail"],
		[{ started: true, elapsed: W, tries: 2 }, "started"],
	];
	for (const [input, want] of cases) assert.equal(ds.draftStartStep(input), want, JSON.stringify(input));
	assert.ok(W >= 5_000 && W <= 15_000, "a few seconds, not the whole draft");
});

test("a reply's own text leaves out the quote and markup", () => {
	assert.equal(ds.ownText("<p></p><blockquote><p>On Monday Ann wrote: hi</p></blockquote>"), "");
	assert.equal(ds.ownText("<p>&nbsp;</p><br><blockquote>old</blockquote>"), "");
	assert.equal(ds.ownText("<p>Thanks, see you then.</p><blockquote>old</blockquote>"), "Thanks, see you then.");
	assert.equal(ds.ownText(""), "");
});

test("an empty reply opened for drafting isn't saved", () => {
	assert.equal(ds.skipSave(true, "<p></p>"), true);
	assert.equal(ds.skipSave(true, "<p>Draft text</p>"), false);
	assert.equal(ds.skipSave(false, "<p></p>"), false, "a reply opened with Reply saves as before");
});

test("the composer and runner use the queue, and the reader offers Draft reply on an empty draft", () => {
	const compose = readFileSync("app/components/postal/ComposeWindow.tsx", "utf8");
	assert.match(compose, /useState\(!!props\.initial\.askAgent\)/, "Drafting… shows from the first paint");
	assert.match(compose, /skipSave\(openedToDraft\.current, s\.html\)/);
	const agent = readFileSync("app/components/postal/Agent.tsx", "utf8");
	assert.match(agent, /canSend\(/);
	assert.match(agent, /draftStartStep\(/);
	assert.match(agent, /<Suspense fallback=\{null\}>/, "the runner's first load doesn't hold the composer's render");
	const reader = readFileSync("app/components/postal/Reader.tsx", "utf8");
	assert.match(reader, /ownText\(draft\.body/);
});
