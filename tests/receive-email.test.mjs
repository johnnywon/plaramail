import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { openD1 } from "./helpers/d1.mjs";

const bundle = await build({
	entryPoints: ["workers/index.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { receiveEmail } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function rawMessage(headers, subject = "Routing test") {
	const raw = new TextEncoder().encode(`From: sender@example.net\r\n${headers}\r\nSubject: ${subject}\r\n\r\nHello`);
	return { rawSize: raw.length, raw: new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } }) };
}

// A database with no mailboxes yet.
async function freshEnvironment(addresses, prefs = null) {
	const d1 = await openD1();
	return {
		d1,
		env: {
			EMAIL_ADDRESSES: addresses, DB: d1.DB,
			BUCKET: { head: async () => ({}), get: async (key) => (key === "config/prefs.json" && prefs ? { json: async () => prefs } : null) },
		},
		/** [mailbox, folder, subject] of every stored message. */
		stored: async () => (await d1.sql.all(`SELECT mailbox_id, folder_id, subject FROM messages ORDER BY id`))
			.map((r) => [r.mailbox_id, r.folder_id, r.subject]),
		settings: async (id) => {
			const row = await d1.sql.first(`SELECT settings FROM mailboxes WHERE id = ?`, id);
			return row ? JSON.parse(row.settings) : null;
		},
	};
}

async function deliveredMailbox(envelopeTo, headers, rejections = []) {
	const { env, stored } = await freshEnvironment(["hello@example.com", "support@example.org"]);
	await receiveEmail({ to: envelopeTo, ...rawMessage(headers), setReject: (reason) => rejections.push(reason) }, env, { waitUntil: () => {} });
	return (await stored()).map(([mailbox]) => mailbox);
}

test("a delivery to the second To address reaches its own mailbox", async () => {
	assert.deepEqual(
		await deliveredMailbox("support@example.org", "To: hello@example.com, support@example.org"),
		["support@example.org"],
	);
});

test("a Bcc delivery reaches its envelope mailbox", async () => {
	assert.deepEqual(
		await deliveredMailbox("support@example.org", "To: someone@example.net"),
		["support@example.org"],
	);
});

test("an unconfigured envelope recipient is ignored", async () => {
	const rejections = [];
	assert.deepEqual(
		await deliveredMailbox("other@example.net", "To: hello@example.com", rejections),
		[],
	);
	assert.deepEqual(rejections, ["Unknown recipient"]);
});

test("the first delivery to a configured address creates its mailbox and keeps the message", async () => {
	const { env, stored, settings } = await freshEnvironment(["hello@example.com"]);
	await receiveEmail({ to: "Hello@Example.com", ...rawMessage("To: hello@example.com", "Before anyone signed in"), setReject: () => {} }, env, { waitUntil: () => {} });
	assert.equal((await settings("hello@example.com")).fromName, "hello");
	assert.deepEqual(await stored(), [["hello@example.com", "inbox", "Before anyone signed in"]]);
});

test("a later delivery leaves the existing mailbox settings alone", async () => {
	const { d1, env, stored, settings } = await freshEnvironment(["hello@example.com"]);
	await d1.addMailboxes("hello@example.com");
	await d1.sql.run(`UPDATE mailboxes SET settings = ? WHERE id = ?`, JSON.stringify({ fromName: "Custom" }), "hello@example.com");
	await receiveEmail({ to: "hello@example.com", ...rawMessage("To: hello@example.com"), setReject: () => {} }, env, { waitUntil: () => {} });
	assert.equal((await settings("hello@example.com")).fromName, "Custom");
	assert.equal((await stored()).length, 1);
});

test("without EMAIL_ADDRESSES, mail for a mailbox nobody created is ignored", async () => {
	const { d1, env, stored } = await freshEnvironment([]);
	const rejections = [];
	await receiveEmail({ to: "anyone@example.com", ...rawMessage("To: anyone@example.com"), setReject: (reason) => rejections.push(reason) }, env, { waitUntil: () => {} });
	assert.deepEqual(await stored(), []);
	assert.deepEqual(await d1.sql.all(`SELECT id FROM mailboxes`), []);
	assert.deepEqual(rejections, ["Unknown recipient"]);
});

/** An enabled agent on every address with one rule, as Console > Your agents saves it. */
const addAgent = (d1, rules = []) => d1.sql.run(
	`INSERT INTO agents (id, name, job, addresses, rules, mode, created_at, updated_at) VALUES ('a1', 'Ann', 'Answer questions', '[]', ?, 'draft', 'x', 'x')`,
	JSON.stringify(rules),
);

/** Deliver one message; returns whether the agent was asked to draft. */
async function agentAsked(raw, env) {
	let asked = false;
	const background = [];
	await receiveEmail(
		{ to: "jane@example.org", rawSize: raw.length, raw: new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } }), setReject: () => {} },
		{ ...env, EMAIL_AGENT: { idFromName: (name) => name, get: () => ({ handleNewEmail: async () => { asked = true; return { status: "drafted", draftId: null }; } }) } },
		{ waitUntil: (promise) => background.push(promise) },
	);
	await Promise.all(background);
	return asked;
}

const message = (subject) => new TextEncoder().encode(`From: sender@example.net\r\nTo: jane@example.org\r\nSubject: ${subject}\r\n\r\nHello`);

test("new mail goes to the agent only when an agent's rules take it", async () => {
	const { d1, env } = await freshEnvironment(["jane@example.org"]);
	await addAgent(d1, [{ field: "subject", op: "contains", value: "invoice" }]);
	assert.equal(await agentAsked(message("Lunch?"), env), false, "no agent takes it: nothing runs");
	assert.equal(await agentAsked(message("Invoice 42"), env), true);
});

test("mail no agent takes is drafted only when the PlaraMail Agent is set to draft it", async () => {
	const leave = await freshEnvironment(["jane@example.org"]);
	assert.equal(await agentAsked(message("Hello"), leave.env), false, "the default leaves it");
	const draft = await freshEnvironment(["jane@example.org"], { unmatched: "draft" });
	assert.equal(await agentAsked(message("Hello"), draft.env), true);
});

test("an inbound message triggers the receiving agent through RPC", async () => {
	const raw = new TextEncoder().encode(
		"From: sender@example.net\r\nTo: jane@example.org\r\nSubject: Draft me\r\n\r\nHello",
	);
	let agentInput;
	const background = [];
	const { d1, env } = await freshEnvironment(["jane@example.org"]);
	await addAgent(d1);
	const agent = {
		fetch: async () => { throw new Error("Direct agent fetch is unsupported"); },
		handleNewEmail: async (input) => { agentInput = input; return { status: "drafted", draftId: null }; },
	};
	await receiveEmail(
		{
			to: "jane@example.org",
			rawSize: raw.length,
			raw: new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } }),
			setReject: () => {},
		},
		{ ...env, EMAIL_AGENT: { idFromName: (name) => name, get: () => agent } },
		{ waitUntil: (promise) => background.push(promise) },
	);
	await Promise.all(background);
	const savedEmail = await d1.sql.first(`SELECT email_id AS id, subject, thread_id FROM messages`);
	assert.equal(savedEmail.subject, "Draft me");
	assert.deepEqual(agentInput, {
		mailboxId: "jane@example.org",
		emailId: savedEmail.id,
		sender: "sender@example.net",
		threadId: savedEmail.thread_id,
	});
	// The run is recorded and settled.
	assert.deepEqual(await d1.sql.first(`SELECT state, attempts FROM auto_draft_runs WHERE email_id = ?`, savedEmail.id), { state: "drafted", attempts: 1 });
});

test("inbound mail is saved without triggering the agent when no agent takes it", async () => {
	const raw = new TextEncoder().encode(
		"From: sender@example.net\r\nTo: jane@example.org\r\nSubject: No automatic draft\r\n\r\nHello",
	);
	const background = [];
	const { d1, env } = await freshEnvironment(["jane@example.org"]);
	await receiveEmail(
		{
			to: "jane@example.org",
			rawSize: raw.length,
			raw: new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } }),
			setReject: () => {},
		},
		{ ...env, EMAIL_AGENT: { idFromName: () => { throw new Error("Agent must not be called"); } } },
		{ waitUntil: (promise) => background.push(promise) },
	);
	assert.equal((await d1.sql.first(`SELECT subject FROM messages`)).subject, "No automatic draft");
	assert.equal(background.length, 0);
});
