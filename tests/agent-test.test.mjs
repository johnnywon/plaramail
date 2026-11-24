import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Test on past mail (WON-530): an agent runs on mail it already has. Nothing is sent and no draft is saved.

const run = await loadTs("workers/agent/test-run.ts");
const { TEST_DEFAULT, TEST_MAX, testCounts } = await loadTs("shared/agent-test.ts");

const A = "hello@example.com";
const B = "billing@example.com";
const agent = (fields = {}) => ({
	id: "ag1", name: "Penny", job: "Decline guest-post pitches.", addresses: [], rules: [], instructions: "", exampleReply: "",
	mode: "watch", does: "reply", labelId: null, enabled: true, position: 0, dailyLimit: 25, perSenderLimit: 2, ...fields,
});

async function mailDb(count = 30) {
	const d1 = await openD1();
	await d1.addMailboxes(A, B);
	const add = (id, mailbox, folder, date, fields = {}) => {
		const subject = fields.subject ?? `Message ${id}`;
		const [{ id: rowid }] = d1.exec(
			`INSERT INTO messages (email_id, mailbox_id, folder_id, conversation_id, date, subject, sender_addr, sender_domain, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
			id, mailbox, folder, id, date, subject, "ann@example.net", "example.net", "<p>Hi</p>",
		);
		d1.exec(`INSERT INTO messages_fts (rowid, subject, sender_name, sender_addr, recipients, body_text, attachment_names) VALUES (?, ?, '', 'ann@example.net', '', 'Hi', '')`, rowid, subject);
	};
	for (let i = 0; i < count; i++) add(`a${i}`, A, "inbox", new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString());
	add("b0", B, "inbox", "2026-09-20T00:00:00.000Z", { subject: "Invoice 12" });
	add("sent0", A, "sent", "2026-10-03T00:00:00.000Z");
	add("draft0", A, "draft", "2026-10-03T00:00:00.000Z");
	add("spam0", A, "spam", "2026-10-03T00:00:00.000Z");
	add("arch0", A, "archive", "2026-09-01T00:00:00.000Z");
	return d1;
}

test("a test takes the latest 25 received messages for the agent's addresses, 50 at most", async () => {
	assert.equal(TEST_DEFAULT, 25);
	assert.equal(TEST_MAX, 50);
	const { sql } = await mailDb(60);
	const mailboxes = [A, B];
	const latest = await run.pickTestMail(sql, agent(), { mailboxes });
	assert.equal(latest.mail.length, 25);
	assert.equal(latest.mail[0].emailId, "a59");
	for (const m of latest.mail) assert.ok(!["sent0", "draft0", "spam0"].includes(m.emailId));
	assert.equal((await run.pickTestMail(sql, agent(), { mailboxes, limit: 500 })).mail.length, 50);
	// Only the agent's addresses.
	const billing = await run.pickTestMail(sql, agent({ addresses: [B] }), { mailboxes });
	assert.deepEqual(billing.mail.map((m) => m.emailId), ["b0"]);
	// Archived mail counts as received.
	assert.ok((await run.pickTestMail(sql, agent(), { mailboxes, limit: 50, search: "" })).mail.length === 50);
	const all = await run.pickTestMail(sql, agent({ addresses: [A] }), { mailboxes, limit: 50 });
	assert.ok(!all.mail.some((m) => m.emailId === "b0"));
});

test("a search narrows the mail, and a bad one says why", async () => {
	const { sql } = await mailDb(5);
	const mailboxes = [A, B];
	const found = await run.pickTestMail(sql, agent(), { mailboxes, search: "subject:invoice" });
	assert.deepEqual(found.mail.map((m) => m.emailId), ["b0"]);
	assert.deepEqual(await run.pickTestMail(sql, agent(), { mailboxes, search: "subject:nothing-like-this" }), { error: "No received mail matches that search" });
	assert.ok("error" in await run.pickTestMail(sql, agent(), { mailboxes, search: "before:notadate" }));
	assert.deepEqual(await run.pickTestMail(sql, agent({ addresses: ["other@example.org"] }), { mailboxes }), { error: "None of the agent's addresses has mail" });
});

test("the latest run is kept per agent, a new one replaces it, and messages are claimed one at a time", async () => {
	const { sql } = await mailDb(5);
	const { mail } = await run.pickTestMail(sql, agent(), { mailboxes: [A] });
	const first = await run.startTest(sql, "ag1", "", mail);
	assert.equal(first.state, "running");
	assert.equal(first.results.length, 6);
	assert.ok(first.results.every((r) => r.outcome === "pending"));

	const second = await run.startTest(sql, "ag1", "from:ann", mail.slice(0, 2));
	assert.notEqual(second.id, first.id);
	assert.equal((await sql.first(`SELECT COUNT(*) AS n FROM agent_test_results WHERE test_id = ?`, first.id)).n, 0);

	const one = await run.claimNext(sql, "ag1");
	const two = await run.claimNext(sql, "ag1");
	assert.deepEqual([one.position, two.position], [0, 1]);
	assert.equal(await run.claimNext(sql, "ag1"), null);
	await run.saveResult(sql, one.testId, 0, { outcome: "took", reason: null, reply: "No thanks.", inputTokens: 1000, outputTokens: 100 }, "model-x");
	assert.equal(await run.finishTest(sql, "ag1", async () => ({ input: 1, output: 2 })), false);
	await run.saveResult(sql, two.testId, 1, { outcome: "left", reason: "its job doesn't fit", reply: null, inputTokens: 500, outputTokens: 0 });
	assert.equal(await run.finishTest(sql, "ag1", async () => ({ input: 1, output: 2 })), true);
	const done = await run.getTest(sql, "ag1");
	assert.equal(done.state, "done");
	assert.equal(done.model, "model-x");
	assert.equal(done.inputTokens, 1500);
	assert.equal(done.outputTokens, 100);
	assert.equal(done.cost, 0.0017);
	assert.deepEqual(testCounts(done.results), { total: 2, took: 1, left: 1, skipped: 0, failed: 0, waiting: 0 });
	assert.equal(done.results[0].reply, "No thanks.");
});

test("a claim that went stale is offered again, and Stop keeps what was tested", async () => {
	const { sql } = await mailDb(3);
	const { mail } = await run.pickTestMail(sql, agent(), { mailboxes: [A] });
	await run.startTest(sql, "ag1", "", mail);
	const now = Date.now();
	const first = await run.claimNext(sql, "ag1", now);
	const again = await run.claimNext(sql, "ag1", now + run.TEST_CLAIM_STALE_MS + 1);
	assert.equal(again.position, first.position);
	await run.saveResult(sql, again.testId, again.position, { outcome: "left", reason: "x", reply: null, inputTokens: 0, outputTokens: 0 });
	const stopped = await run.stopTest(sql, "ag1", async () => null);
	assert.equal(stopped.state, "stopped");
	assert.deepEqual(stopped.results.map((r) => r.outcome), ["left"]);
	assert.equal(stopped.cost, 0);
	assert.equal(await run.claimNext(sql, "ag1"), null);
	await run.deleteTests(sql, "ag1");
	assert.equal(await run.getTest(sql, "ag1"), null);
});

// -- One message ------------------------------------------------------------

const email = (fields = {}) => ({
	id: "e1", thread_id: "t1", subject: "Guest post opportunity", sender: "bob@example.net", recipient: A, date: "2026-10-10T10:00:00Z",
	folder_id: "inbox", body: "<p>Can I write a guest post for your blog? I have three topics ready to go.</p>", raw_headers: null, ...fields,
});

/** Workers AI stand-in: the scan says NO unless told, the draft check keeps the text. */
function fakeAi({ injection = false, checkFails = false } = {}) {
	return {
		run: async (_model, input) => {
			if (input.max_tokens === 10) return { response: injection ? "YES" : "NO" };
			if (checkFails) throw new Error("verifier down");
			return { response: input.messages[1].content };
		},
	};
}

function deps({ ai = fakeAi(), emails = [email()], generate }) {
	const saved = [];
	return {
		saved,
		ai,
		store: () => ({
			getEmail: async (id) => emails.find((e) => e.id === id) ?? null,
			getThreadEmails: async (t) => emails.filter((e) => e.thread_id === t),
			createEmail: async (...args) => saved.push(args),
		}),
		systemPrompt: async () => "You write mail.",
		generate,
	};
}

const MAIL = { emailId: "e1", mailboxId: A, threadId: "t1" };

test("a reply agent that takes the message shows the reply it would have written, and nothing is saved", async () => {
	let prompt = "";
	const d = deps({
		generate: async (input) => {
			prompt = input.prompt;
			const result = await input.tools.draft_reply.execute({ subject: "Re: Guest post", body: "Thanks, we don't take guest posts.", agent: "Penny" });
			assert.equal(result.status, "draft_saved");
			return { text: "", inputTokens: 1200, outputTokens: 80 };
		},
	});
	const verdict = await run.testMessage(d, agent(), MAIL);
	assert.deepEqual(verdict, { outcome: "took", reason: null, reply: "Thanks, we don't take guest posts.", inputTokens: 1200, outputTokens: 80 });
	assert.match(prompt, /### Penny/);
	assert.match(prompt, /write no draft/);
	assert.equal(d.saved.length, 0);
});

test("a paused agent can be tested; rules that don't match cost nothing", async () => {
	let calls = 0;
	const d = deps({ generate: async () => (calls++, { text: "", inputTokens: 1, outputTokens: 1 }) });
	const left = await run.testMessage(d, agent({ enabled: false, rules: [{ field: "subject", op: "contains", value: "invoice" }] }), MAIL);
	assert.deepEqual(left, { outcome: "left", reason: "its rules don't match", reply: null, inputTokens: 0, outputTokens: 0 });
	assert.equal(calls, 0);
	const nofit = await run.testMessage(d, agent({ enabled: false }), MAIL);
	assert.equal(nofit.outcome, "left");
	assert.equal(nofit.reason, "its job doesn't fit");
	assert.equal(nofit.inputTokens, 1);
});

test("the injection scan skips a message, a failed draft check or model call fails it", async () => {
	const generate = async (input) => {
		await input.tools.draft_reply.execute({ subject: "Re: Guest post", body: "Thanks, we don't take guest posts at the moment.", agent: "Penny" });
		return { text: "", inputTokens: 10, outputTokens: 5 };
	};
	const skipped = await run.testMessage(deps({ ai: fakeAi({ injection: true }), generate }), agent(), MAIL);
	assert.equal(skipped.outcome, "skipped");
	assert.match(skipped.reason, /prompt injection/);
	const failed = await run.testMessage(deps({ ai: fakeAi({ checkFails: true }), generate }), agent(), MAIL);
	assert.deepEqual(failed, { outcome: "failed", reason: "the reply failed the draft check", reply: null, inputTokens: 10, outputTokens: 5 });
	const broken = await run.testMessage(deps({ generate: async () => { throw new Error("model unavailable"); } }), agent(), MAIL);
	assert.equal(broken.outcome, "failed");
	assert.equal(broken.reason, "model unavailable");
	const gone = await run.testMessage(deps({ emails: [], generate }), agent(), MAIL);
	assert.equal(gone.outcome, "skipped");
});

test("an action agent with rules says what it would do without a model call; without rules the model decides", async () => {
	let calls = 0;
	const d = deps({ generate: async (input) => {
		calls++;
		assert.equal(input.tools.draft_reply, undefined);
		await input.tools.star_email.execute({ agent: "Stella" });
		return { text: "", inputTokens: 7, outputTokens: 3 };
	} });
	const ruled = await run.testMessage(d, agent({ name: "Stella", does: "star", rules: [{ field: "from", op: "domain", value: "example.net" }] }), MAIL);
	assert.deepEqual(ruled, { outcome: "took", reason: "Would star", reply: null, inputTokens: 0, outputTokens: 0 });
	assert.equal(calls, 0);
	const asked = await run.testMessage(d, agent({ name: "Stella", does: "star" }), MAIL);
	assert.deepEqual(asked, { outcome: "took", reason: "Would star", reply: null, inputTokens: 7, outputTokens: 3 });
});

test("the run's cost uses the model's price per million tokens", () => {
	assert.equal(run.testCost({ inputTokens: 2_000_000, outputTokens: 500_000 }, { input: 0.5, output: 2 }), 2);
	assert.equal(run.testCost({ inputTokens: 10, outputTokens: 10 }, null), null);
});
