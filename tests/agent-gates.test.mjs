import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Promotion evidence (WON-531): the gates that block a move up a rung, and the record they read.

const gates = await loadTs("shared/agent-gates.ts");
const evidence = await loadTs("workers/lib/agent-evidence.ts");
const agents = await loadTs("workers/lib/agents.ts");
const { textToHtml, buildQuotedReplyBlock } = await loadTs("workers/lib/email-helpers.ts");

const A = "hello@example.com";
const record = (fields = {}) => ({
	week: { matched: 0, failed: 0 }, test: null, drafts: { sent: 0, unedited: 0 }, safety: { count: 0, latest: [] }, ...fields,
});
const ready = record({
	week: { matched: 12, failed: 0 },
	test: { id: "t", state: "done", tested: 20, failed: 0, startedAt: "x", finishedAt: "y" },
	drafts: { sent: 10, unedited: 8 },
});
const unmet = (checks) => checks.filter((c) => !c.met).map((c) => c.id);

test("Watch to Draft keeps today's gate: 10 matched and none failed this week", () => {
	assert.deepEqual(unmet(gates.gateChecks("watch", "draft", false, record())), ["matched"]);
	assert.deepEqual(unmet(gates.gateChecks("watch", "draft", false, record({ week: { matched: 10, failed: 1 } }))), ["week-failed"]);
	assert.deepEqual(unmet(gates.gateChecks("watch", "draft", false, record({ week: { matched: 10, failed: 0 } }))), []);
	// An action agent's move to On uses the same gate.
	assert.deepEqual(gates.gateChecks("watch", "on", true, record()).map((c) => c.id), ["matched", "week-failed"]);
	assert.match(gates.gateRefusal(gates.gateChecks("watch", "draft", false, record())), /^Not yet\. Still needed: 10 messages matched in 7 days\.$/);
});

test("Draft to Send needs a 20-message Test with no failures, 10 drafts sent with 8 in 10 unedited, and no safety failures", () => {
	assert.deepEqual(unmet(gates.gateChecks("draft", "send", false, ready)), []);
	assert.equal(gates.gateRefusal(gates.gateChecks("draft", "send", false, ready)), null);
	assert.deepEqual(unmet(gates.gateChecks("draft", "send", false, record())), ["test", "drafts-sent", "unedited"]);
	const withTest = (test) => unmet(gates.gateChecks("draft", "send", false, { ...ready, test: { ...ready.test, ...test } }));
	assert.deepEqual(withTest({ tested: 19 }), ["test"]);
	assert.deepEqual(withTest({ failed: 1 }), ["test"]);
	assert.deepEqual(withTest({ state: "running" }), ["test"]);
	assert.deepEqual(withTest({ state: "stopped", tested: 25 }), []);
	assert.deepEqual(unmet(gates.gateChecks("draft", "send", false, { ...ready, drafts: { sent: 9, unedited: 9 } })), ["drafts-sent"]);
	assert.deepEqual(unmet(gates.gateChecks("draft", "send", false, { ...ready, drafts: { sent: 20, unedited: 15 } })), ["unedited"]);
	assert.deepEqual(unmet(gates.gateChecks("draft", "send", false, { ...ready, safety: { count: 1, latest: [{ at: "x", reason: "prompt injection detected" }] } })), ["safety"]);
	// Skipping Draft needs both gates; moving down needs none.
	assert.deepEqual(gates.gateChecks("watch", "send", false, record()).length, 6);
	assert.deepEqual(gates.gateChecks("send", "watch", false, record()), []);
	assert.deepEqual(gates.gateChecks("draft", "watch", false, record()), []);
	assert.deepEqual(gates.gateChecks("on", "watch", true, record()), []);
	for (const c of gates.gateChecks("watch", "send", false, ready)) assert.ok(!c.record.includes(": ") && !c.label.includes(": "), c.record);
});

test("a reply's fingerprint ignores the signature, the quoted original, markup and spacing, and catches an edit", async () => {
	const quote = buildQuotedReplyBlock({ date: "2026-10-01T10:00:00Z", sender: "bob@example.net", body: "<p>Can I write for you?</p>" });
	const signature = `<div style="border-top: 1px solid #ccc; margin-top: 16px; padding-top: 12px;">Dana, Example Co</div>`;
	const agentDraft = `${textToHtml("Hi Bob,\n\nThanks, but we don't take guest posts.\n\nDana")}${quote}`;
	assert.equal(evidence.replyText(agentDraft), "Hi Bob, Thanks, but we don't take guest posts. Dana");
	const written = await evidence.replyFingerprint(agentDraft);
	const sentAsIs = `<p>Hi Bob,</p><p></p><p>Thanks, but we don't take guest posts.</p><p>Dana</p>${signature}${quote}`;
	assert.equal(await evidence.replyFingerprint(sentAsIs), written);
	const sentEdited = `<p>Hi Bob,</p><p>Thanks, but we don't take guest posts this year.</p><p>Dana</p>${signature}${quote}`;
	assert.notEqual(await evidence.replyFingerprint(sentEdited), written);
});

async function setup() {
	const d1 = await openD1();
	await d1.addMailboxes(A);
	const { agent } = await agents.createAgent(d1.sql, { name: "Penny", job: "Decline pitches." });
	return { ...d1, agent };
}

test("a sent agent draft counts once, as written or edited; a redraft counts as edited", async () => {
	const { sql, agent } = await setup();
	const html = textToHtml("No thanks.");
	const written = await evidence.replyFingerprint(html);
	const notes = { origin: "auto-draft", agent: "penny", instructions: [], written };
	assert.deepEqual(await evidence.recordDraftSent(sql, notes, `<p>No thanks.</p>`, "s1"), { agentId: agent.id, edited: false });
	assert.deepEqual(await evidence.recordDraftSent(sql, notes, `<p>No thanks.</p>`, "s1"), { agentId: agent.id, edited: false });
	assert.deepEqual(await evidence.recordDraftSent(sql, notes, `<p>No thanks, sorry.</p>`, "s2"), { agentId: agent.id, edited: true });
	assert.deepEqual(await evidence.recordDraftSent(sql, { ...notes, instructions: ["shorter"] }, `<p>No thanks.</p>`, "s3"), { agentId: agent.id, edited: true });
	// Not an agent's draft, or written before fingerprints: not counted.
	assert.equal(await evidence.recordDraftSent(sql, { ...notes, agent: null }, html, "s4"), null);
	assert.equal(await evidence.recordDraftSent(sql, { ...notes, written: undefined }, html, "s5"), null);
	assert.equal(await evidence.recordDraftSent(sql, { ...notes, origin: "chat" }, html, "s6"), null);
	assert.equal(await evidence.recordDraftSent(sql, null, html, "s7"), null);
	const e = await evidence.agentEvidence(sql, agent.id);
	assert.deepEqual(e.drafts, { sent: 3, unedited: 1 });
});

test("an agent draft's notes keep the fingerprint through the store", async () => {
	const d1 = await openD1();
	await d1.addMailboxes(A);
	const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
	const box = new D1Mailbox(d1.sql, { delete: async () => {}, put: async () => {} }, A);
	await box.createEmail("draft", { id: "d1", subject: "Re: Hi", sender: A, recipient: "bob@example.net", date: "2026-10-01T10:00:00.000Z", body: "<p>No</p>", thread_id: "t1" }, []);
	await box.setDraftNotes("d1", { origin: "auto-draft", agent: "Penny", instructions: [], model: null, written: "abc" });
	assert.deepEqual(await box.getDraftNotes("d1"), { origin: "auto-draft", agent: "Penny", instructions: [], model: null, written: "abc" });
});

test("the record reads the week's runs, the latest Test and safety checks from the last 7 days", async () => {
	const { sql, agent } = await setup();
	const now = Date.now();
	const at = (days) => new Date(now - days * 86_400_000).toISOString();
	const run = (id, state, days) => sql.run(
		`INSERT INTO auto_draft_runs (email_id, mailbox_id, thread_id, sender, state, agent_id, created_at, updated_at) VALUES (?, ?, ?, 'bob@example.net', ?, ?, ?, ?)`,
		id, A, id, state, agent.id, at(days), at(days),
	);
	await run("r1", "watched", 1);
	await run("r2", "drafted", 2);
	await run("r3", "failed", 3);
	await run("r4", "skipped", 1);
	await run("old", "failed", 9);
	await sql.run(`INSERT INTO agent_tests (agent_id, id, state, started_at, finished_at) VALUES (?, 't1', 'done', ?, ?)`, agent.id, at(0), at(0));
	for (let i = 0; i < 3; i++) {
		await sql.run(`INSERT INTO agent_test_results (test_id, position, email_id, mailbox_id, thread_id, date, outcome) VALUES ('t1', ?, ?, ?, ?, ?, ?)`, i, `e${i}`, A, `e${i}`, at(0), i === 2 ? "failed" : "took");
	}
	await evidence.recordSafety(sql, [agent.id], "m1", "prompt injection detected", now - 2 * 86_400_000);
	await evidence.recordSafety(sql, [agent.id], "m1", "prompt injection detected", now);
	await evidence.recordSafety(sql, [agent.id], "m0", "prompt injection detected", now - 8 * 86_400_000);
	await evidence.recordSafetyNamed(sql, "PENNY", "m2", "the reply failed the draft check", now);
	const e = await evidence.agentEvidence(sql, agent.id, now);
	assert.deepEqual(e.week, { matched: 2, failed: 1 });
	assert.equal(e.test.tested, 3);
	assert.equal(e.test.failed, 1);
	assert.equal(e.safety.count, 2);
	assert.equal(e.safety.latest[0].reason, "the reply failed the draft check");
	assert.ok(evidence.isSafetyReason("prompt injection detected in part 2 of 3"));
	assert.ok(evidence.isSafetyReason("injection scan failed"));
	assert.ok(!evidence.isSafetyReason("no address to reply to"));
	await evidence.deleteAgentEvents(sql, agent.id);
	assert.equal((await evidence.agentEvidence(sql, agent.id, now)).safety.count, 0);
});
