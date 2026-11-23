import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { openSql } from "./helpers/sql.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-594: every AI draft keeps the model that wrote it, and the composer shows it with the agent.

const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const { redraft } = await loadTs("workers/lib/redraft.ts");
const { modelIdOf } = await loadTs("workers/lib/agent-model.ts");
const { createAutoDraftTools, saveTextDraft } = await loadTs("workers/agent/auto-draft.ts");

const MAILBOX = "a@example.com";
const MODEL = "@cf/zai-org/glm-5.3-flash";

async function mailbox() {
	const d1 = await openD1();
	await d1.addMailboxes(MAILBOX);
	const box = new D1Mailbox(d1.sql, { delete: async () => {}, put: async () => {} }, MAILBOX);
	await box.createEmail("inbox", {
		id: "orig", subject: "Meeting", sender: "bob@example.org", recipient: MAILBOX, date: "2026-10-01T10:00:00.000Z",
		body: "<p>Can we meet Thursday?</p>", thread_id: "orig", message_id: "orig@example.org",
	}, []);
	const draft = async (id) => box.createEmail("draft", {
		id, subject: "Re: Meeting", sender: MAILBOX, recipient: "bob@example.org", date: "2026-10-01T10:05:00.000Z",
		body: "<p>Thursday works.</p>", in_reply_to: "orig", thread_id: "orig",
	}, []);
	return { d1, box, draft };
}

test("draft notes keep the model through save and reopen, and an old draft has none", async () => {
	const { box, draft } = await mailbox();
	await draft("d1");
	await box.setDraftNotes("d1", { origin: "auto-draft", agent: "Meetings", model: MODEL, instructions: [] });
	assert.deepEqual((await box.getEmail("d1")).draft_notes, { origin: "auto-draft", agent: "Meetings", model: MODEL, instructions: [] });
	assert.equal((await box.getThreadEmails("orig")).find((e) => e.id === "d1").draft_notes.model, MODEL);
	await draft("old");
	await box.setDraftNotes("old", { origin: "auto-draft", agent: null, instructions: [] });
	assert.equal((await box.getEmail("old")).draft_notes.model, null, "no model is guessed for a draft saved without one");
});

test("migration 0014 leaves existing notes without a model", async () => {
	const { sql } = openSql();
	const files = readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
	await sql.schema(files.filter((f) => f < "0014").map((f) => readFileSync(`migrations/${f}`, "utf8")).join("\n"));
	await sql.run(`PRAGMA foreign_keys = OFF`);
	await sql.run(`INSERT INTO draft_notes (email_id, origin, agent, instructions, created_at) VALUES ('d', 'chat', NULL, '[]', 'x')`);
	await sql.schema(readFileSync("migrations/0014_draft_model.sql", "utf8"));
	assert.equal((await sql.first(`SELECT model FROM draft_notes WHERE email_id = 'd'`)).model, null);
});

test("modelIdOf reads the model a run uses", () => {
	assert.equal(modelIdOf({ modelId: MODEL, provider: "workers-ai" }), MODEL);
	assert.equal(modelIdOf("openrouter/some-model"), "openrouter/some-model");
	assert.equal(modelIdOf({}), null);
});

test("auto-draft records the run's model with the agent, in draft_reply and in a text-only answer", async () => {
	const calls = [];
	const draftReply = async (_env, _m, params) => (calls.push(params), { status: "draft_saved", draftId: "x" });
	const target = { mailboxId: MAILBOX, emailId: "orig", threadId: "orig", to: "bob@example.org" };
	const agents = [{ name: "Meetings", job: "Answer meeting requests" }];
	const tools = createAutoDraftTools({}, target, { thread: [] }, draftReply, { agents, model: MODEL });
	await tools.draft_reply.execute({ subject: "Re: Meeting", body: "Thursday works.", agent: "Meetings" });
	assert.deepEqual(calls[0].notes, { origin: "auto-draft", agent: "Meetings", model: MODEL, instructions: [] });

	const { box } = await mailbox();
	const sql = (await openD1()).sql;
	let id = null;
	await saveTextDraft(box, sql, target, "Meeting", "Thursday works.", (d) => { id = d; }, MODEL);
	assert.deepEqual((await box.getEmail(id)).draft_notes, { origin: "auto-draft", agent: null, model: MODEL, instructions: [] });
});

test("a redraft names the model that wrote the new text and keeps the agent", async () => {
	const { box, draft } = await mailbox();
	await draft("d1");
	await box.setDraftNotes("d1", { origin: "auto-draft", agent: "Meetings", model: "@cf/old/model-a", instructions: [] });
	const deps = {
		ai: { run: async () => ({ response: "NO" }) }, bucket: { delete: async () => {} }, system: "S",
		write: async () => "Thursday at 10am works.", verify: async (t) => t, model: "@cf/new/model-b",
	};
	const result = await redraft(box, MAILBOX, "d1", "shorter", deps);
	assert.equal(result.ok, true);
	assert.deepEqual(result.notes, { origin: "auto-draft", agent: "Meetings", model: "@cf/new/model-b", instructions: ["shorter"] });
	assert.equal((await box.getEmail(result.draft.id)).draft_notes.model, "@cf/new/model-b");
});

test("chat drafts carry the model, MCP drafts carry none, and the composer shows both agent and model", () => {
	const agent = readFileSync("workers/agent/index.ts", "utf8");
	assert.doesNotMatch(agent, /const CHAT_NOTES: DraftNotes = \{ origin: "chat", agent: null, instructions: \[\] \};/);
	assert.match(agent, /const chatNotes: DraftNotes = \{ origin: "chat", agent: null, model, instructions: \[\] \};/);
	assert.match(agent, /createEmailTools\(env, bound, \{ crossAddress: true, known, model: modelIdOf\(model\) \}\)/);
	const mcp = readFileSync("workers/mcp/index.ts", "utf8");
	assert.match(mcp, /const MCP_NOTES: DraftNotes = \{ origin: "mcp", agent: null, instructions: \[\] \};/, "an MCP client's model isn't known, so none is recorded");
	const compose = readFileSync("app/components/postal/ComposeWindow.tsx", "utf8");
	assert.match(compose, /state\.notes\.agent && <> · \{state\.notes\.agent\}<\/>/);
	assert.match(compose, /state\.notes\.model \? <span title=\{state\.notes\.model\}>\{prettyName\(state\.notes\.model\)\}<\/span> : "model not recorded"/);
});
