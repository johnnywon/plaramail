import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Auto-draft on a queue (WON-205): one run per inbound message, retries with backoff, superseded by newer mail.

const runs = await loadTs("workers/agent/runs.ts");
const { consumeAutoDrafts, startAutoDraft } = await loadTs("workers/agent/queue.ts");
const { DEFAULT_AGENT_LIMITS } = await loadTs("shared/send-limits.ts");
const AUTO_DRAFT_SENDER_DAILY = DEFAULT_AGENT_LIMITS.autoDraftPerSender;

const MAILBOX = "a@example.com";
const target = (emailId, fields = {}) => ({ mailboxId: MAILBOX, emailId, threadId: "t1", sender: "bob@example.org", ...fields });
const state = (d1, emailId) => d1.exec(`SELECT state, attempts, reason, draft_id FROM auto_draft_runs WHERE email_id = ?`, emailId)[0];

test("each inbound message gets one run", async () => {
	const { sql } = await openD1();
	assert.deepEqual(await runs.recordRun(sql, target("e1")), { state: "queued", reason: null });
	assert.equal(await runs.recordRun(sql, target("e1")), null);
});

test("newer mail in the thread supersedes a run that hasn't finished", async () => {
	const d1 = await openD1();
	await runs.recordRun(d1.sql, target("e1"));
	await runs.recordRun(d1.sql, target("e2"));
	assert.equal(state(d1, "e1").state, "superseded");
	assert.equal(state(d1, "e2").state, "queued");
	assert.equal(await runs.claimRun(d1.sql, "e1"), null);
	// Other threads are left alone.
	await runs.recordRun(d1.sql, target("e3", { threadId: "t2" }));
	assert.equal(state(d1, "e2").state, "queued");
});

test("a sender gets a few auto-drafts a day per address", async () => {
	const d1 = await openD1();
	for (let i = 0; i < AUTO_DRAFT_SENDER_DAILY; i++) {
		assert.equal((await runs.recordRun(d1.sql, target(`e${i}`, { threadId: `t${i}` }))).state, "queued");
	}
	const over = await runs.recordRun(d1.sql, target("over", { threadId: "tx" }));
	assert.equal(over.state, "skipped");
	assert.match(over.reason, /sender limit/);
	assert.equal((await runs.recordRun(d1.sql, target("other", { threadId: "ty", sender: "carol@example.org" }))).state, "queued");
	// A day later the sender is drafted again.
	const later = Date.now() + 86_400_000 + 60_000;
	assert.equal((await runs.recordRun(d1.sql, target("next-day", { threadId: "tz" }), later)).state, "queued");
	// The console can raise the limit, or set 0 to stop auto-drafting.
	assert.equal((await runs.recordRun(d1.sql, target("raised", { threadId: "tr" }), Date.now(), 10)).state, "queued");
	assert.match((await runs.recordRun(d1.sql, target("off", { threadId: "to", sender: "dan@example.org" }), Date.now(), 0)).reason, /0 auto-drafts/);
});

test("an attempt drafts, skips, or asks for a retry", async () => {
	const d1 = await openD1();
	const discard = async () => {};
	await runs.recordRun(d1.sql, target("ok"));
	assert.equal(await runs.attemptRun(d1.sql, { emailId: "ok" }, async () => ({ status: "drafted", draftId: "d1" }), { final: false, discardDraft: discard }), "done");
	assert.deepEqual(state(d1, "ok"), { state: "drafted", attempts: 1, reason: null, draft_id: "d1" });

	await runs.recordRun(d1.sql, target("skip", { threadId: "t2" }));
	await runs.attemptRun(d1.sql, { emailId: "skip" }, async () => ({ status: "skipped", reason: "possible prompt injection" }), { final: false, discardDraft: discard });
	assert.equal(state(d1, "skip").state, "skipped");

	await runs.recordRun(d1.sql, target("flaky", { threadId: "t3" }));
	const boom = async () => { throw new Error("model timed out"); };
	assert.equal(await runs.attemptRun(d1.sql, { emailId: "flaky" }, boom, { final: false, discardDraft: discard }), "retry");
	assert.deepEqual(state(d1, "flaky"), { state: "queued", attempts: 1, reason: "model timed out", draft_id: null });
	assert.equal(await runs.attemptRun(d1.sql, { emailId: "flaky" }, boom, { final: true, discardDraft: discard }), "retry");
	assert.deepEqual(state(d1, "flaky"), { state: "failed", attempts: 2, reason: "model timed out", draft_id: null });
	// A failed run isn't started again.
	assert.equal(await runs.attemptRun(d1.sql, { emailId: "flaky" }, boom, { final: true, discardDraft: discard }), "done");
});

test("a draft from a run superseded while it ran is discarded", async () => {
	const d1 = await openD1();
	const discarded = [];
	await runs.recordRun(d1.sql, target("e1"));
	await runs.attemptRun(d1.sql, { emailId: "e1" }, async () => {
		await runs.recordRun(d1.sql, target("e2"));
		return { status: "drafted", draftId: "stale-draft" };
	}, { final: false, discardDraft: async (mailboxId, id) => discarded.push([mailboxId, id]) });
	assert.equal(state(d1, "e1").state, "superseded");
	assert.deepEqual(discarded, [[MAILBOX, "stale-draft"]]);
});

test("a superseded run discards every draft it saved, not only the last (WON-244)", async () => {
	const d1 = await openD1();
	const discarded = [];
	await runs.recordRun(d1.sql, target("e1"));
	await runs.attemptRun(d1.sql, { emailId: "e1" }, async () => {
		await runs.recordRun(d1.sql, target("e2"));
		return runs.draftedOutcome(["first", "second"]);
	}, { final: false, discardDraft: async (mailboxId, id) => discarded.push(id) });
	assert.deepEqual(discarded, ["first", "second"]);
	assert.deepEqual(runs.draftedOutcome(["only"]), { status: "drafted", draftId: "only" });
	assert.deepEqual(runs.outcomeAfterError(new Error("x"), ["a", "b"]), { status: "drafted", draftId: "b", earlier: ["a"] });
});

test("a run that drafted more than once keeps only its last draft", async () => {
	const d1 = await openD1();
	const discarded = [];
	await runs.recordRun(d1.sql, target("e1"));
	await runs.attemptRun(d1.sql, { emailId: "e1" }, async () => runs.draftedOutcome(["first", "second", "third"]),
		{ final: false, discardDraft: async (mailboxId, id) => discarded.push([mailboxId, id]) });
	assert.deepEqual(discarded, [[MAILBOX, "first"], [MAILBOX, "second"]]);
	assert.deepEqual(state(d1, "e1"), { state: "drafted", attempts: 1, reason: null, draft_id: "third" });
});

test("a run left running by a dead worker is taken over", async () => {
	const d1 = await openD1();
	await runs.recordRun(d1.sql, target("e1"));
	assert.ok(await runs.claimRun(d1.sql, "e1"));
	assert.equal(await runs.claimRun(d1.sql, "e1"), null);
	const taken = await runs.claimRun(d1.sql, "e1", Date.now() + runs.RUN_STALE_MS + 1_000);
	assert.equal(taken.attempts, 2);
});

function message(body, attempts) {
	const calls = [];
	return { body, attempts, calls, ack: () => calls.push("ack"), retry: (options) => calls.push(["retry", options?.delaySeconds]) };
}

test("a redelivery that finds the run still running waits for it to go stale instead of acking", async () => {
	const d1 = await openD1();
	let calls = 0;
	const agent = { handleNewEmail: async () => { calls++; return { status: "drafted", draftId: "d1" }; } };
	const env = { DB: d1.DB, EMAIL_AGENT: { idFromName: (n) => n, get: () => agent } };
	await runs.recordRun(d1.sql, target("e1"));
	await runs.claimRun(d1.sql, "e1"); // a worker took it and was evicted

	const m = message({ emailId: "e1" }, 2);
	await consumeAutoDrafts({ messages: [m] }, env);
	assert.equal(m.calls[0][0], "retry");
	const wait = m.calls[0][1];
	assert.ok(wait > runs.RUN_STALE_MS / 1000 - 5 && wait <= runs.RUN_STALE_MS / 1000 + 5, `wait ${wait}s`);
	assert.equal(calls, 0);
	assert.equal(state(d1, "e1").state, "running");

	// After the wait the run is stale and the next delivery takes it over.
	d1.exec(`UPDATE auto_draft_runs SET updated_at = ? WHERE email_id = 'e1'`, new Date(Date.now() - runs.RUN_STALE_MS - 1_000).toISOString());
	const again = message({ emailId: "e1" }, 3);
	await consumeAutoDrafts({ messages: [again] }, env);
	assert.deepEqual(again.calls, ["ack"]);
	assert.equal(state(d1, "e1").state, "drafted");
});

test("a run left running with no redelivery coming is marked failed", async () => {
	const d1 = await openD1();
	await runs.recordRun(d1.sql, target("e1"));
	await runs.recordRun(d1.sql, target("e2", { threadId: "t2" }));
	await runs.claimRun(d1.sql, "e1");
	await runs.claimRun(d1.sql, "e2");
	const now = Date.now();
	d1.exec(`UPDATE auto_draft_runs SET updated_at = ? WHERE email_id = 'e1'`, new Date(now - runs.RUN_ABANDONED_MS - 1_000).toISOString());
	assert.equal(await runs.failAbandonedRuns(d1.sql, now), 1);
	assert.equal(state(d1, "e1").state, "failed");
	assert.match(state(d1, "e1").reason, /stopped/);
	assert.equal(state(d1, "e2").state, "running");
});

test("the consumer retries with backoff, then lets the queue dead-letter the message", async () => {
	const d1 = await openD1();
	let fail = true;
	const agent = { handleNewEmail: async () => (fail ? { status: "error", error: "provider down" } : { status: "drafted", draftId: "d1" }) };
	const env = { DB: d1.DB, EMAIL_AGENT: { idFromName: (n) => n, get: () => agent } };
	await runs.recordRun(d1.sql, target("e1"));

	const delays = [];
	for (let attempt = 1; attempt <= runs.AUTO_DRAFT_MAX_RETRIES + 1; attempt++) {
		const m = message({ emailId: "e1" }, attempt);
		await consumeAutoDrafts({ messages: [m] }, env);
		assert.equal(m.calls[0][0], "retry");
		delays.push(m.calls[0][1]);
	}
	assert.deepEqual(delays, [30, 60, 120, 240]);
	assert.equal(state(d1, "e1").state, "failed");

	await runs.recordRun(d1.sql, target("e2", { threadId: "t2" }));
	fail = false;
	const ok = message({ emailId: "e2" }, 1);
	await consumeAutoDrafts({ messages: [ok] }, env);
	assert.deepEqual(ok.calls, ["ack"]);
	assert.equal(state(d1, "e2").state, "drafted");
});

test("inbound mail goes to the queue when it's bound, and to waitUntil when it isn't", async () => {
	const d1 = await openD1();
	const sent = [];
	const background = [];
	const agent = { handleNewEmail: async () => ({ status: "drafted", draftId: null }) };
	const env = { DB: d1.DB, EMAIL_AGENT: { idFromName: (n) => n, get: () => agent } };
	const ctx = { waitUntil: (p) => background.push(p) };
	await startAutoDraft({ ...env, DRAFT_QUEUE: { send: async (body) => sent.push(body) } }, ctx, target("queued"));
	assert.deepEqual(sent, [{ emailId: "queued" }]);
	assert.equal(background.length, 0);
	await startAutoDraft(env, ctx, target("inline", { threadId: "t2" }));
	await Promise.all(background);
	assert.equal(state(d1, "inline").state, "drafted");
	// A message seen twice isn't queued twice.
	await startAutoDraft({ ...env, DRAFT_QUEUE: { send: async (body) => sent.push(body) } }, ctx, target("queued"));
	assert.equal(sent.length, 1);
});

test("an error after the draft was saved settles the run as drafted, not retried", async () => {
	assert.deepEqual(runs.outcomeAfterError(new Error("429 on step 2"), ["d1"]), { status: "drafted", draftId: "d1" });
	assert.deepEqual(runs.outcomeAfterError(new Error("429 on step 1"), []), { status: "error", error: "429 on step 1" });

	const d1 = await openD1();
	let drafts = 0;
	// The drafter saves a draft, then the model call after the tool call fails.
	const drafter = async () => { drafts++; return runs.outcomeAfterError(new Error("provider down"), [`d${drafts}`]); };
	await runs.recordRun(d1.sql, target("e1"));
	assert.equal(await runs.attemptRun(d1.sql, { emailId: "e1" }, drafter, { final: false, discardDraft: async () => {} }), "done");
	assert.equal(drafts, 1);
	assert.deepEqual(state(d1, "e1"), { state: "drafted", attempts: 1, reason: null, draft_id: "d1" });
});

test("the example config's queue matches the retry count in code", () => {
	const config = readFileSync("wrangler.jsonc", "utf8");
	const consumer = config.match(/"consumers":.*"max_retries": (\d+).*"dead_letter_queue"/);
	assert.ok(consumer, "queues block in wrangler.jsonc");
	assert.equal(Number(consumer[1]), runs.AUTO_DRAFT_MAX_RETRIES);
	assert.deepEqual([1, 2, 3].map(runs.retryDelay), [30, 60, 120]);
});

test("drafts saved before an error still go to the chosen agent, so Watch never leaves one", () => {
	const watcher = { id: "w1" };
	assert.deepEqual(runs.settleDrafts(["a", "b"], watcher, 1, "leave"), { discard: ["a"], act: "b" });
	assert.deepEqual(runs.settleDrafts(["a"], null, 2, "leave"), { discard: ["a"], outcome: { status: "skipped", reason: "no agent's job fits" } });
	assert.deepEqual(runs.settleDrafts(["a"], null, 0, "draft"), { discard: [], outcome: { status: "drafted", draftId: "a" } });
	assert.deepEqual(runs.settleDrafts([], null, 1, "leave").discard, []);
	// The error path settles the same way before it falls back to "drafted".
	const src = readFileSync("workers/agent/index.ts", "utf8");
	const catchBlock = src.slice(src.indexOf('console.error("Auto-draft failed:"'), src.indexOf("private async settle("));
	assert.match(catchBlock, /this\.settle\(draftIds, chosen, matched, unmatched, target\)/);
	assert.doesNotMatch(src.slice(src.indexOf("private async actAs("), src.indexOf('if (agent.mode === "draft")')), /toolDiscardDraft\([^)]*\)\.catch/);
});
