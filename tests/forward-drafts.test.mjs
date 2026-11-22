import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// A saved forward draft reopens and sends as a forward with the original's attachments (WON-1198).

const { app } = await loadTs("workers/index.ts");
const { toolSendDraft, toolUpdateDraft } = await loadTs("workers/lib/tools.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");
const { draftMode, draftFiles, draftSaveFields } = await loadTs("app/components/postal/draft-mode.ts");

const MAILBOX = "a@example.com";

async function harness() {
	const d1 = await openD1();
	await d1.addMailboxes(MAILBOX);
	const delivered = [];
	const files = new Map([["attachments/orig/att-1/report.pdf", "PDF"]]);
	const bucket = {
		get: async (key) => (files.has(key) ? { arrayBuffer: async () => new TextEncoder().encode(files.get(key)).buffer } : null),
		put: async () => {}, delete: async () => {},
	};
	const env = {
		DB: d1.DB, BUCKET: bucket, EMAIL_ADDRESSES: [MAILBOX],
		AI: { run: async () => ({ response: "NO" }) },
		EMAIL: { send: async (message) => { delivered.push(message); return { messageId: `p${delivered.length}` }; } },
	};
	const box = new D1Mailbox(d1.sql, bucket, MAILBOX);
	await box.createEmail("inbox", {
		id: "orig", subject: "Q3 report", sender: "bob@example.org", recipient: MAILBOX, date: "2026-10-01T10:00:00.000Z",
		body: "<p>Report attached</p>", thread_id: "orig", message_id: "orig@example.org",
	}, [
		{ id: "att-1", email_id: "orig", filename: "report.pdf", mimetype: "application/pdf", size: 3, disposition: "attachment" },
		{ id: "att-2", email_id: "orig", filename: "notes.txt", mimetype: "text/plain", size: 5, disposition: "attachment" },
	]);
	const save = async (body) => {
		const response = await app.request(`/api/v1/mailboxes/${MAILBOX}/drafts`, {
			method: "POST",
			headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
			body: JSON.stringify(body),
		}, env);
		assert.equal(response.status, 201);
		return (await response.json()).id;
	};
	return { d1, env, box, save, delivered };
}

const FORWARD = { to: "carol@example.net", subject: "Fwd: Q3 report", body: "<p>FYI</p>", in_reply_to: "orig", mode: "forward", forward_attachments: ["att-1"] };

test("a saved forward draft keeps its mode and the original's attachments it carries", async () => {
	const h = await harness();
	const id = await h.save(FORWARD);
	const draft = await h.box.getEmail(id);
	assert.deepEqual(draft.forward.attachments.map((a) => a.filename), ["report.pdf"]);
	assert.equal(draftMode(draft), "forward");
	assert.deepEqual(draftFiles(draft), [{ name: "report.pdf", size: 3, type: "application/pdf", content: "", attachmentId: "att-1" }]);

	const again = await h.save({ ...FORWARD, draft_id: id, body: "<p>FYI, edited</p>" });
	assert.equal(draftMode(await h.box.getEmail(again)), "forward", "saving again keeps the forward");
	assert.equal(h.d1.exec(`SELECT COUNT(*) AS n FROM draft_forwards`)[0].n, 1, "the old draft's row goes with it");

	const thread = await h.box.getThreadEmails("orig");
	assert.equal(draftMode(thread.find((e) => e.id === again)), "forward", "a draft opened from the thread is a forward too");
});

test("a reply draft and a new draft are unchanged", async () => {
	const h = await harness();
	const reply = await h.box.getEmail(await h.save({ to: "bob@example.org", subject: "Re: Q3 report", body: "<p>Thanks</p>", in_reply_to: "orig", mode: "reply" }));
	assert.equal(reply.forward, undefined);
	assert.equal(draftMode(reply), "reply");
	assert.deepEqual(draftFiles(reply), []);
	assert.equal(draftMode(await h.box.getEmail(await h.save({ to: "bob@example.org", body: "<p>Hi</p>" }))), "new");
});

test("send_draft sends a forward draft as a forward with its attachments", async () => {
	const h = await harness();
	const id = await h.save(FORWARD);
	const r = await toolSendDraft(h.env, MAILBOX, id, "mcp");
	assert.equal(r.status, "sent");
	const message = h.delivered[0];
	assert.deepEqual((message.attachments ?? []).map((a) => a.filename), ["report.pdf"]);
	const headers = JSON.stringify(message.headers ?? {});
	assert.doesNotMatch(headers, /In-Reply-To|orig@example\.org/i, "a forward does not answer the original");
	assert.equal((await h.box.getEmail("orig")).read, false, "the original is not marked read");
});

test("update_draft keeps a forward a forward", async () => {
	const h = await harness();
	const id = await h.save(FORWARD);
	const r = await toolUpdateDraft(h.env, MAILBOX, { draftId: id, bodyHtml: "<p>FYI, see the PDF</p>" });
	assert.equal(r.status, "draft_updated");
	assert.deepEqual((await h.box.getEmail(r.newDraftId)).forward.attachments.map((a) => a.id), ["att-1"]);
});

test("a scheduled forward opens as a forward", async () => {
	const h = await harness();
	const scheduled = await h.box.scheduleSend({
		sendAt: new Date(Date.now() + 86_400_000).toISOString(), mode: "forward", originalId: "orig",
		email: { to: "carol@example.net", from: MAILBOX, subject: "Fwd: Q3 report", html: "<p>FYI</p>", forward_attachments: ["att-2"] },
	});
	const draft = await h.box.getEmail(scheduled.id);
	assert.equal(draftMode(draft), "forward");
	assert.deepEqual(draftFiles(draft).map((f) => f.attachmentId), ["att-2"]);
});

test("a save sends the forward mode and the original's files it keeps", () => {
	const files = [{ attachmentId: "att-1" }, { name: "added.txt" }];
	assert.deepEqual(draftSaveFields({ mode: "forward", originalId: "orig", files }), { mode: "forward", forward_attachments: ["att-1"] });
	assert.deepEqual(draftSaveFields({ mode: "reply", originalId: "orig", files }), {});
	assert.deepEqual(draftSaveFields({ mode: "forward", files }), {}, "a forward with no original saves as new mail");
});
