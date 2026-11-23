import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

const { MailboxSettingsSchema } = await loadTs("workers/lib/schemas.ts");
const defaults = {
	fromName: "Hello",
	forwarding: { enabled: false, email: "" },
	signature: { enabled: false, text: "" },
	autoReply: { enabled: false, subject: "", message: "" },
};

test("default mailbox settings and the agent prompt are valid", () => {
	assert.deepEqual(MailboxSettingsSchema.parse({
		...defaults,
		signature: { enabled: true, text: "Regards", html: "<p>Regards</p>" },
		agentSystemPrompt: "Be helpful",
	}), {
		...defaults,
		signature: { enabled: true, text: "Regards", html: "<p>Regards</p>" },
		agentSystemPrompt: "Be helpful",
	});
});

test("mailbox settings reject invalid field types and values", () => {
	for (const settings of [
		{ fromName: 1 },
		{ forwarding: { enabled: "false", email: "" } },
		{ forwarding: { enabled: true, email: "not-an-email" } },
		{ signature: { enabled: false, text: 1 } },
		{ autoReply: { enabled: false, subject: "safe", message: 1 } },
		{ agentSystemPrompt: false },
	]) {
		assert.equal(MailboxSettingsSchema.safeParse(settings).success, false, JSON.stringify(settings));
	}
});

test("mailbox settings enforce field limits and header-safe auto-reply subjects", () => {
	for (const settings of [
		{ fromName: "x".repeat(201) },
		{ signature: { enabled: true, text: "x".repeat(10001) } },
		{ autoReply: { enabled: true, subject: "x".repeat(999), message: "" } },
		{ autoReply: { enabled: true, subject: "line\rbreak", message: "" } },
		{ autoReply: { enabled: true, subject: "", message: "x".repeat(10001) } },
		{ agentSystemPrompt: "x".repeat(20001) },
	]) {
		assert.equal(MailboxSettingsSchema.safeParse(settings).success, false);
	}
});

test("unknown mailbox setting keys are stripped at each object level", () => {
	assert.deepEqual(MailboxSettingsSchema.parse({
		fromName: "Hello",
		unexpected: "removed",
		forwarding: { enabled: false, email: "", extra: "removed" },
	}), {
		fromName: "Hello",
		forwarding: { enabled: false, email: "" },
	});
});

const { app } = await loadTs("workers/index.ts");

async function environment() {
	const d1 = await openD1();
	return { d1, env: { EMAIL_ADDRESSES: ["hello@example.com"], BUCKET: { head: async () => ({}) }, DB: d1.DB } };
}

const jsonHeaders = { "content-type": "application/json", "sec-fetch-site": "same-origin" };

test("mailbox create and update routes return 400 for invalid settings", async () => {
	const create = await environment();
	const created = await app.request("http://localhost/api/v1/mailboxes", {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({
			email: "hello@example.com",
			name: "Hello",
			settings: { forwarding: { enabled: true, email: "not-an-email" } },
		}),
	}, create.env);
	assert.equal(created.status, 400);
	assert.equal((await created.json()).error, "Invalid email");

	const update = await environment();
	await update.d1.addMailboxes("hello@example.com");
	const updated = await app.request("http://localhost/api/v1/mailboxes/hello@example.com", {
		method: "PUT",
		headers: jsonHeaders,
		body: JSON.stringify({ settings: { fromName: "x".repeat(201) } }),
	}, update.env);
	assert.equal(updated.status, 400);
	assert.match((await updated.json()).error, /200/);
});
