import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Recent work and Test's "Then" (WON-529): what came of each message an agent took, read from the mail.

const work = await loadTs("workers/lib/agent-work.ts");
const shared = await loadTs("shared/agent-work.ts");

const A = "hello@example.com";
const T = (m) => new Date(Date.parse("2026-11-20T12:00:00Z") + m * 60_000).toISOString();

async function setup() {
	const d1 = await openD1();
	await d1.addMailboxes(A);
	const sql = d1.sql;
	const msg = (id, folder, fields = {}) => sql.run(
		`INSERT INTO messages (email_id, mailbox_id, folder_id, conversation_id, date, subject, message_id, in_reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, A, folder, fields.conv ?? id, fields.date ?? T(0), fields.subject ?? "", fields.messageId ?? null, fields.inReplyTo ?? null,
	);
	const run = (emailId, state, fields = {}) => sql.run(
		`INSERT INTO auto_draft_runs (email_id, mailbox_id, thread_id, sender, state, attempts, reason, draft_id, agent_id, created_at, updated_at) VALUES (?, ?, ?, 'dana@example.org', ?, 1, ?, ?, ?, ?, ?)`,
		emailId, A, emailId, state, fields.reason ?? null, fields.draftId ?? null, fields.agentId ?? "a1", fields.at ?? T(1), fields.at ?? T(1),
	);
	return { sql, msg, run };
}

test("a drafted run is waiting, sent, edited or discarded, from the mail itself", async () => {
	const { sql, msg, run } = await setup();
	// Waiting: the draft is still in Drafts.
	await msg("in-w", "inbox", { subject: "Guest post?" });
	await msg("d-w", "draft");
	await run("in-w", "drafted", { draftId: "d-w", at: T(5) });
	// Sent with the draft's key, as written.
	await msg("in-s", "inbox", { subject: "Link exchange" });
	await msg("out-s", "sent");
	await sql.run(`INSERT INTO send_keys (mailbox_id, key, state, email_id, created_at) VALUES (?, 'draft:d-s', 'sent', 'out-s', ?)`, A, T(2));
	await run("in-s", "drafted", { draftId: "d-s", at: T(4) });
	// Sent after edits, found by the reply in the thread once the key has aged out.
	await msg("in-e", "inbox", { subject: "Sponsored slot", messageId: "<in-e@example.org>" });
	await msg("out-e", "sent", { inReplyTo: "<in-e@example.org>", date: T(10) });
	await sql.run(`INSERT INTO agent_events (agent_id, kind, email_id, edited, at) VALUES ('a1', 'sent', 'out-e', 1, ?)`, T(10));
	await run("in-e", "drafted", { draftId: "d-e", at: T(3) });
	// Discarded: no draft, nothing sent.
	await msg("in-x", "inbox", { subject: "Partnership" });
	await run("in-x", "drafted", { draftId: "d-x", at: T(2) });
	// Skipped keeps its reason; another agent's run isn't listed.
	await msg("in-k", "inbox", { subject: "Invoice 2291" });
	await run("in-k", "skipped", { reason: "not a pitch", at: T(1) });
	await run("in-o", "drafted", { agentId: "a2", at: T(6) });

	const rows = await work.agentWork(sql, "a1");
	assert.deepEqual(rows.map((r) => [r.emailId, r.subject, r.outcome]), [
		["in-w", "Guest post?", "waiting"],
		["in-s", "Link exchange", "sent"],
		["in-e", "Sponsored slot", "edited"],
		["in-x", "Partnership", "discarded"],
		["in-k", "Invoice 2291", "skipped"],
	]);
	assert.equal(rows.at(-1).reason, "not a pitch");
});

test("Then: what came of each message for this agent, none when it didn't take it", async () => {
	const { sql, msg, run } = await setup();
	await msg("m1", "inbox");
	await msg("d1", "draft");
	await run("m1", "drafted", { draftId: "d1" });
	await run("m2", "drafted", { agentId: "a2" });
	await run("m3", "skipped");
	await sql.run(`INSERT INTO agent_actions (id, agent_id, agent_name, mailbox_id, email_id, does, state, created_at) VALUES ('x1', 'a1', 'Starrer', ?, 'm4', 'star', 'done', ?)`, A, T(1));
	const then = await work.thenFor(sql, "a1", ["m1", "m2", "m3", "m4", "m5"]);
	assert.deepEqual(Object.fromEntries(then), { m1: "waiting", m2: "none", m3: "skipped", m4: "done" });
	assert.equal(shared.handled("waiting"), true);
	assert.equal(shared.handled("skipped"), false);
	assert.equal(shared.handled("none"), false);
});

test("Differs: the test would take what the agent left then, or leave what it took", () => {
	assert.equal(shared.differs({ outcome: "took", then: "none" }), true);
	assert.equal(shared.differs({ outcome: "took", then: "sent" }), false);
	assert.equal(shared.differs({ outcome: "left", then: "discarded" }), true);
	assert.equal(shared.differs({ outcome: "left", then: "skipped" }), false);
	assert.equal(shared.differs({ outcome: "failed", then: "sent" }), false);
	assert.equal(shared.differs({ outcome: "took" }), false, "no Then, no verdict");
});
