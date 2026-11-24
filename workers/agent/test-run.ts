// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Test on past mail (WON-530). An agent runs on received mail it already has,
 * the way it would have run when the mail arrived, and nothing happens:
 *
 * - The mail is the latest TEST_DEFAULT received messages for the agent's
 *   addresses, or what a search finds, TEST_MAX at most. Sent mail and drafts
 *   are left out, and so are Spam and Trash unless the search names them.
 * - Each message goes through the agent's rules, then the injection scan, then
 *   the model with the same prompt and read tools as a live run. draft_reply
 *   runs the draft check and keeps the text; it saves no draft. An action
 *   agent's tool records that it would act and does nothing. Other agents are
 *   left out: the test shows what this agent does on its own.
 * - The browser asks for one message at a time (POST .../test/next), so no
 *   request runs long and a closed tab leaves a run that picks up where it
 *   stopped. The model's tokens add up as it goes; the cost is worked out when
 *   the last message is done.
 * - Each agent keeps its latest run, as evidence for moving it up a rung
 *   (WON-531). A new run replaces it.
 */
import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { TEST_DEFAULT, TEST_MAX, type AgentTest, type TestOutcome, type TestResult } from "../../shared/agent-test";
import { verifyDraft } from "../lib/ai";
import { ACTION_TOOLS, actionText } from "../lib/agent-actions";
import { type Agent, type AgentAction, isAction, matchAgents } from "../lib/agents";
import { emptyFilter, filterWhere, InvalidFilterError } from "../lib/mail-index-sql";
import type { Sql } from "../store/sql";
import { autoDraftMessage, autoDraftPrompt, createAutoDraftTools, prepareAutoDraft } from "./auto-draft";
import { boundRequest, DRAFT_REQUEST_BUDGET, fixedSize } from "./request-budget";
import { defineTool } from "./tool-def";
import type { EmailFull } from "../lib/schemas";

/** A claimed message not settled after this long is offered again. */
export const TEST_CLAIM_STALE_MS = 5 * 60_000;

export interface TestMail {
	emailId: string;
	mailboxId: string;
	threadId: string;
	sender: string;
	subject: string;
	date: string;
}

/**
 * The mail a test runs on: received messages for the agent's addresses (every
 * configured address when it has none), newest first, narrowed by `search`.
 */
export async function pickTestMail(
	sql: Sql,
	agent: Pick<Agent, "addresses">,
	options: { search?: string; limit?: number; mailboxes: readonly string[]; now?: number },
): Promise<{ mail: TestMail[] } | { error: string }> {
	const limit = Math.min(Math.max(Math.trunc(options.limit ?? TEST_DEFAULT) || TEST_DEFAULT, 1), TEST_MAX);
	const known = options.mailboxes.map((m) => m.toLowerCase());
	const addresses = agent.addresses.length ? agent.addresses.filter((a) => known.includes(a)) : known;
	if (addresses.length === 0) return { error: "None of the agent's addresses has mail" };
	const search = (options.search ?? "").trim();
	let where: { sql: string; params: unknown[] };
	try {
		where = filterWhere(emptyFilter({ view: "all", q: search }), options.now ?? Date.now());
	} catch (e) {
		if (e instanceof InvalidFilterError) return { error: e.message };
		throw e;
	}
	const rows = await sql.all(
		`SELECT m.email_id, m.mailbox_id, COALESCE(m.thread_id, m.email_id) AS thread_id, m.sender_addr, m.subject, m.date FROM messages m
		WHERE ${where.sql} AND m.state NOT IN ('sent', 'draft') AND m.mailbox_id IN (SELECT value FROM json_each(?))
		ORDER BY m.date DESC LIMIT ?`,
		...where.params, JSON.stringify(addresses), limit,
	);
	if (rows.length === 0) return { error: search ? "No received mail matches that search" : "No received mail for the agent's addresses" };
	return {
		mail: rows.map((r) => ({
			emailId: String(r.email_id), mailboxId: String(r.mailbox_id), threadId: String(r.thread_id),
			sender: String(r.sender_addr ?? ""), subject: String(r.subject ?? ""), date: String(r.date),
		})),
	};
}

/** Start a run on `mail`, replacing the agent's last one. */
export async function startTest(sql: Sql, agentId: string, search: string, mail: readonly TestMail[], now = Date.now(), setup: string | null = null): Promise<AgentTest> {
	const id = crypto.randomUUID();
	const at = new Date(now).toISOString();
	await sql.batch([
		{ sql: `DELETE FROM agent_test_results WHERE test_id IN (SELECT id FROM agent_tests WHERE agent_id = ?)`, params: [agentId] },
		{ sql: `DELETE FROM agent_tests WHERE agent_id = ?`, params: [agentId] },
		{ sql: `INSERT INTO agent_tests (agent_id, id, search, state, started_at, setup) VALUES (?, ?, ?, 'running', ?, ?)`, params: [agentId, id, search.trim(), at, setup] },
		...mail.slice(0, TEST_MAX).map((m, position) => ({
			sql: `INSERT INTO agent_test_results (test_id, position, email_id, mailbox_id, thread_id, sender, subject, date, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
			params: [id, position, m.emailId, m.mailboxId, m.threadId, m.sender, m.subject, m.date],
		})),
	]);
	return (await getTest(sql, agentId))!;
}

const toResult = (r: Record<string, unknown>): TestResult => ({
	position: Number(r.position), emailId: String(r.email_id), mailboxId: String(r.mailbox_id), sender: String(r.sender ?? ""),
	subject: String(r.subject ?? ""), date: String(r.date), outcome: String(r.outcome) as TestOutcome,
	reason: r.reason == null ? null : String(r.reason), reply: r.reply == null ? null : String(r.reply),
	inputTokens: Number(r.input_tokens ?? 0), outputTokens: Number(r.output_tokens ?? 0),
});

/** The agent's latest run with each message's result, or null when it has none. */
export async function getTest(sql: Sql, agentId: string): Promise<AgentTest | null> {
	const row = await sql.first(`SELECT * FROM agent_tests WHERE agent_id = ?`, agentId);
	if (!row) return null;
	const results = await sql.all(`SELECT * FROM agent_test_results WHERE test_id = ? ORDER BY position`, row.id);
	return {
		id: String(row.id), agentId, search: String(row.search ?? ""), state: String(row.state) as AgentTest["state"],
		model: row.model == null ? null : String(row.model), inputTokens: Number(row.input_tokens ?? 0), outputTokens: Number(row.output_tokens ?? 0),
		cost: row.cost == null ? null : Number(row.cost), startedAt: String(row.started_at), finishedAt: row.finished_at == null ? null : String(row.finished_at),
		setup: row.setup == null ? null : String(row.setup),
		results: results.map(toResult),
	};
}

/** Take the next message of a running test, or one whose claim went stale. Null when none is left. */
export async function claimNext(sql: Sql, agentId: string, now = Date.now()): Promise<(TestMail & { testId: string; position: number }) | null> {
	const open = `(outcome = 'pending' OR (outcome = 'running' AND claimed_at < ?3))`;
	const row = await sql.first(
		`UPDATE agent_test_results SET outcome = 'running', claimed_at = ?1
		WHERE test_id = ?2 AND ${open}
			AND position = (SELECT MIN(position) FROM agent_test_results WHERE test_id = ?2 AND ${open})
		RETURNING test_id, position, email_id, mailbox_id, thread_id, sender, subject, date`,
		new Date(now).toISOString(),
		(await sql.first(`SELECT id FROM agent_tests WHERE agent_id = ? AND state = 'running'`, agentId))?.id ?? "",
		new Date(now - TEST_CLAIM_STALE_MS).toISOString(),
	);
	if (!row) return null;
	return {
		testId: String(row.test_id), position: Number(row.position), emailId: String(row.email_id), mailboxId: String(row.mailbox_id),
		threadId: String(row.thread_id), sender: String(row.sender ?? ""), subject: String(row.subject ?? ""), date: String(row.date),
	};
}

export interface TestVerdict {
	outcome: Exclude<TestOutcome, "pending" | "running">;
	reason: string | null;
	reply: string | null;
	inputTokens: number;
	outputTokens: number;
}

/** Record one message's result and add its tokens to the run. A stopped or replaced run takes nothing. */
export async function saveResult(sql: Sql, testId: string, position: number, verdict: TestVerdict, model: string | null = null): Promise<void> {
	await sql.batch([
		{
			sql: `UPDATE agent_test_results SET outcome = ?, reason = ?, reply = ?, input_tokens = ?, output_tokens = ?
				WHERE test_id = ? AND position = ? AND outcome = 'running'`,
			params: [verdict.outcome, verdict.reason?.slice(0, 1000) ?? null, verdict.reply?.slice(0, 8000) ?? null, verdict.inputTokens, verdict.outputTokens, testId, position],
		},
		{
			sql: `UPDATE agent_tests SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, model = COALESCE(?, model) WHERE id = ? AND state = 'running'`,
			params: [verdict.inputTokens, verdict.outputTokens, model, testId],
		},
	]);
}

/** USD for the run's tokens at a price per million, rounded to a hundredth of a cent. */
export function testCost(tokens: { inputTokens: number; outputTokens: number }, price: { input: number; output: number } | null): number | null {
	if (!price) return null;
	return Math.round(((tokens.inputTokens * price.input + tokens.outputTokens * price.output) / 1e6) * 10_000) / 10_000;
}

/** Close a running test once no message is left, with its cost. True when this call closed it. */
export async function finishTest(sql: Sql, agentId: string, price: (model: string | null) => Promise<{ input: number; output: number } | null>, now = Date.now()): Promise<boolean> {
	const test = await sql.first(`SELECT id, model, input_tokens, output_tokens FROM agent_tests WHERE agent_id = ? AND state = 'running'`, agentId);
	if (!test) return false;
	const left = await sql.first(`SELECT COUNT(*) AS n FROM agent_test_results WHERE test_id = ? AND outcome IN ('pending', 'running')`, test.id);
	if (Number(left?.n ?? 0) > 0) return false;
	const model = test.model == null ? null : String(test.model);
	const cost = testCost({ inputTokens: Number(test.input_tokens), outputTokens: Number(test.output_tokens) }, model ? await price(model).catch(() => null) : { input: 0, output: 0 });
	const done = await sql.run(`UPDATE agent_tests SET state = 'done', cost = ?, finished_at = ? WHERE id = ? AND state = 'running'`, cost, new Date(now).toISOString(), test.id);
	return done.changes > 0;
}

/** Stop a running test: messages not tested yet are dropped, the rest stay. */
export async function stopTest(sql: Sql, agentId: string, price: (model: string | null) => Promise<{ input: number; output: number } | null>, now = Date.now()): Promise<AgentTest | null> {
	const test = await sql.first(`SELECT id, model, input_tokens, output_tokens FROM agent_tests WHERE agent_id = ? AND state = 'running'`, agentId);
	if (test) {
		const model = test.model == null ? null : String(test.model);
		const cost = testCost({ inputTokens: Number(test.input_tokens), outputTokens: Number(test.output_tokens) }, model ? await price(model).catch(() => null) : { input: 0, output: 0 });
		await sql.batch([
			{ sql: `DELETE FROM agent_test_results WHERE test_id = ? AND outcome = 'pending'`, params: [test.id] },
			{ sql: `UPDATE agent_tests SET state = 'stopped', cost = ?, finished_at = ? WHERE id = ? AND state = 'running'`, params: [cost, new Date(now).toISOString(), test.id] },
		]);
	}
	return getTest(sql, agentId);
}

export async function deleteTests(sql: Sql, agentId: string): Promise<void> {
	await sql.batch([
		{ sql: `DELETE FROM agent_test_results WHERE test_id IN (SELECT id FROM agent_tests WHERE agent_id = ?)`, params: [agentId] },
		{ sql: `DELETE FROM agent_tests WHERE agent_id = ?`, params: [agentId] },
	]);
}

// -- One message -------------------------------------------------------------

type MailReader = {
	getEmail(id: string): Promise<unknown>;
	getThreadEmails(threadId: string): Promise<unknown>;
};

/** What the model call returns: its final text and the tokens it took over every step. */
export type TestGenerate = (input: { system: string; prompt: string; tools: Record<string, unknown> }) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

export interface TestDeps {
	ai: Ai;
	store: (mailboxId: string) => MailReader;
	systemPrompt: (mailboxId: string) => Promise<string>;
	generate: TestGenerate;
}

const verdict = (outcome: TestVerdict["outcome"], reason: string | null, extra: Partial<TestVerdict> = {}): TestVerdict =>
	({ outcome, reason, reply: null, inputTokens: 0, outputTokens: 0, ...extra });

/**
 * Run the agent on one past message without sending or saving anything. The
 * agent counts as on, so a paused agent can be tested.
 */
export async function testMessage(deps: TestDeps, agent: Agent, mail: Pick<TestMail, "emailId" | "mailboxId" | "threadId">): Promise<TestVerdict> {
	const store = deps.store(mail.mailboxId);
	let raw: EmailFull | null;
	try {
		raw = (await store.getEmail(mail.emailId)) as EmailFull | null;
	} catch (e) {
		return verdict("failed", `could not read the email: ${(e as Error).message}`);
	}
	if (!raw) return verdict("skipped", "the email is gone");
	const message = autoDraftMessage(raw);
	const matched = matchAgents([{ ...agent, enabled: true }], { mailboxId: mail.mailboxId, from: message.sender, subject: message.subject, body: message.body_text });
	if (matched.length === 0) return verdict("left", "its rules don't match");
	const acts = isAction(agent.does);
	// An action agent with rules acts on them alone, with no model call.
	if (acts && agent.rules.length > 0) return verdict("took", `Would ${actionText(agent.does as AgentAction)}`);

	const prepared = await prepareAutoDraft(deps.ai, store, { emailId: mail.emailId, threadId: mail.threadId });
	if (!prepared.ok) return verdict("skipped", prepared.reason);
	const { context } = prepared;

	let reply: string | null = null;
	let took = false;
	let checkFailed: string | null = null;
	// draft_reply's stand-in: the draft check runs, the text is kept, nothing is saved.
	const keepReply = async (_env: unknown, _mailboxId: string, params: { body: string; notes?: { agent?: string | null } }) => {
		const checked = await verifyDraft(deps.ai, params.body.trim());
		if (!checked) {
			checkFailed = "the reply failed the draft check";
			return { error: "The draft check failed. Write the reply again." };
		}
		if (params.notes?.agent === agent.name) {
			took = true;
			reply = checked;
		}
		return { status: "draft_saved" as const, draftId: "test", message: "Draft saved to Drafts folder. Review it and confirm to send.", draft: {} };
	};
	const target = { mailboxId: mail.mailboxId, emailId: mail.emailId, threadId: mail.threadId, to: context.replyTo };
	const tools: Record<string, unknown> = acts
		? {
			...createAutoDraftTools({} as never, target, context, keepReply as never, { reply: false }),
			[ACTION_TOOLS[agent.does as AgentAction]]: defineTool({
				description: `${actionText(agent.does as AgentAction)} the new email, as an action agent whose job fits it. Call once per agent: ${agent.name}.`,
				parameters: z.object({ agent: z.string().describe("The name of the agent whose job fits.") }),
				execute: async ({ agent: name }: { agent: string }): Promise<unknown> => {
					if (name.trim().toLowerCase() !== agent.name.toLowerCase()) return { error: `No agent named "${name}" does this. Use: ${agent.name}.` };
					took = true;
					return { status: "watched", agent: agent.name };
				},
			}),
		}
		: createAutoDraftTools({} as never, target, context, keepReply as never, { agents: [agent] });
	const prompt = autoDraftPrompt(mail.mailboxId, mail.threadId, context, acts ? [] : [agent], { actions: acts ? [agent] : [], reply: !acts })
		+ (acts ? "" : "\n\nIf no agent's job fits the new email, write no draft.");

	let usage = { inputTokens: 0, outputTokens: 0 };
	try {
		const result = await deps.generate({ system: await deps.systemPrompt(mail.mailboxId), prompt, tools });
		usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
	} catch (e) {
		return verdict("failed", (e as Error).message || "the model call failed", usage);
	}
	if (took) return verdict("took", acts ? `Would ${actionText(agent.does as AgentAction)}` : null, { reply, ...usage });
	if (checkFailed) return verdict("failed", checkFailed, usage);
	return verdict("left", "its job doesn't fit", usage);
}

/** The model call a live drafting run makes, with its step limit and request budget, counting tokens. */
export function liveGenerate(model: Parameters<typeof generateText>[0]["model"]): TestGenerate {
	return async ({ system, prompt, tools }) => {
		const t = tools as Parameters<typeof generateText>[0]["tools"];
		const result = await generateText({
			model,
			system,
			messages: [{ role: "user", content: prompt }],
			tools: t,
			stopWhen: stepCountIs(5),
			prepareStep: ({ messages }) => ({ messages: boundRequest(messages, DRAFT_REQUEST_BUDGET, fixedSize(system, t ?? {})) }),
		});
		const usage = result.totalUsage ?? result.usage;
		return { text: result.text, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
	};
}
