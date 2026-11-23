import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// send_draft (MCP and the in-app agent): the text part, the error shape, and scheduled drafts.

const { toolSendDraft } = await loadTs("workers/lib/tools.ts");
const { textToHtml } = await loadTs("workers/lib/email-helpers.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const { DEFAULT_AGENT_LIMITS } = await loadTs("shared/send-limits.ts");

const MAILBOX = "a@example.com";

async function harness() {
	const d1 = await openD1();
	await d1.addMailboxes(MAILBOX);
	const delivered = [];
	const bucket = { get: async () => null, put: async () => {}, delete: async () => {} };
	const env = {
		DB: d1.DB,
		BUCKET: bucket,
		EMAIL: { send: async (message) => { delivered.push(message); return { messageId: `p${delivered.length}` }; } },
	};
	const box = new D1Mailbox(d1.sql, bucket, MAILBOX);
	const draft = (id, body) => box.createEmail("draft", {
		id, subject: "Plans", sender: MAILBOX, recipient: "bob@example.org",
		date: "2026-10-18T12:00:00.000Z", body,
	}, []);
	return { d1, env, box, draft, delivered };
}

test("send_draft writes a readable text part", async () => {
	const h = await harness();
	await h.draft("d1", textToHtml("Don't worry,\nwe'll ship \"v2\" & more.\n\nThanks"));
	const r = await toolSendDraft(h.env, MAILBOX, "d1", "mcp");
	assert.equal(r.status, "sent");
	const text = h.delivered[0].text;
	assert.doesNotMatch(text, /&#39;|&quot;|&amp;/);
	assert.match(text, /Don't worry,\nwe'll ship "v2" & more\./);
	assert.match(text, /\n\nThanks/);
});

test("send_draft errors carry a code and retryable", async () => {
	const h = await harness();
	assert.deepEqual(await toolSendDraft(h.env, MAILBOX, "nope", "mcp"), { error: "Draft not found", code: "not_found", retryable: false });

	await h.draft("d1", "<p>Hi</p>");
	const earlier = new Date(Date.now() - 3 * 3_600_000).toISOString();
	for (let i = 0; i < DEFAULT_AGENT_LIMITS.agentDay; i++) {
		h.d1.exec(`INSERT INTO send_budget (mailbox_id, actor, recipients, at) VALUES (?, 'mcp', 1, ?)`, MAILBOX, earlier);
	}
	const r = await toolSendDraft(h.env, MAILBOX, "d1", "mcp");
	assert.equal(r.code, "send_limit");
	assert.equal(r.retryable, false);
	assert.equal(h.delivered.length, 0);
	assert.ok(await h.box.getEmail("d1"), "the draft is kept");
});

test("send_draft refuses a scheduled draft and leaves the schedule", async () => {
	const h = await harness();
	const sendAt = new Date(Date.now() + 86_400_000).toISOString();
	const scheduled = await h.box.scheduleSend({
		sendAt, mode: "new",
		email: {
			to: "bob@example.org", from: MAILBOX, subject: "Report", html: "<p>Attached</p>",
			attachments: [{ content: "aGk=", filename: "report.txt", type: "text/plain", disposition: "attachment" }],
		},
	});
	const r = await toolSendDraft(h.env, MAILBOX, scheduled.id, "mcp");
	assert.equal(r.code, "invalid_input");
	assert.match(r.error, /scheduled/);
	assert.equal(h.delivered.length, 0);
	assert.ok(await h.box.getEmail(scheduled.id), "the draft is kept");
	assert.deepEqual((await h.box.listScheduled()).map((s) => s.emailId), [scheduled.id]);
});
