import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { loadTs } from "./helpers/sqlite.mjs";
import { openSql } from "./helpers/sql.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";
import { openD1 } from "./helpers/d1.mjs";

const t = await loadTs("workers/lib/threading.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");

const A = "a@example.com";
const NOW = Date.now();
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

async function d1Mailbox() {
	const { sql } = openSql();
	await sql.schema(D1_SCHEMA);
	const bucket = { put: async () => {}, get: async () => null };
	const mailbox = new D1Mailbox(sql, bucket, A);
	const store = (folder, id, fields) => mailbox.createEmail(folder, {
		id, subject: "Invoice October", sender: "ann@example.net", recipient: A, date: hoursAgo(1), body: "<p>hi</p>",
		thread_id: id, message_id: `${id}@example.net`, raw_headers: "[]", ...fields,
	}, []);
	await store("inbox", "e1", {});
	await store("sent", "e2", { subject: "Re: Invoice October", sender: A, recipient: "ann@example.net", thread_id: "e1", message_id: "out-e2@example.com", date: hoursAgo(0.5) });
	await store("inbox", "e3", { subject: "Old news", sender: "bob@example.org", date: hoursAgo(24 * 5) });
	await store("sent", "e4", { subject: "Quote", sender: A, recipient: "cat@example.org, dan@example.org", message_id: "out-e4@example.com", date: hoursAgo(3) });
	return mailbox;
}

test("Message-IDs are looked up nearest first, capped", () => {
	assert.deepEqual(t.referencedIds("c@x", ["a@x", "b@x", "c@x"]), ["c@x", "b@x", "a@x"]);
	assert.deepEqual(t.referencedIds(null, []), []);
	assert.equal(t.referencedIds(null, Array.from({ length: 80 }, (_, i) => `${i}@x`)).length, t.MAX_REFERENCED_IDS);
	assert.equal(t.pickReferencedThread(["b@x", "a@x"], [{ message_id: "a@x", thread_id: "t1" }, { message_id: "b@x", thread_id: "t2" }]), "t2");
	assert.equal(t.pickReferencedThread(["z@x"], [{ message_id: "a@x", thread_id: "t1" }]), null);
});

test("a reference joins a thread only when that message is stored in the mailbox", async () => {
	const mailbox = await d1Mailbox();
	assert.equal(await mailbox.findThreadByMessageIds(["out-e2@example.com"]), "e1");
	assert.equal(await mailbox.findThreadByMessageIds(["unknown@example.net", "e1@example.net"]), "e1");
	assert.equal(await mailbox.findThreadByMessageIds(["unknown@example.net"]), null);
	assert.equal(await mailbox.findThreadByMessageIds(["e1"]), null, "a thread id is not a Message-ID");
	assert.equal(await mailbox.findThreadByMessageIds([]), null);
});

test("the subject fallback needs a reply prefix, a sender from the thread and a recent thread", async () => {
	const mailbox = await d1Mailbox();
	assert.equal(await mailbox.findThreadBySubject("RE: invoice october", "ann@example.net"), "e1");
	assert.equal(await mailbox.findThreadBySubject("Invoice October", "ann@example.net"), null, "no reply prefix");
	assert.equal(await mailbox.findThreadBySubject("Fwd: Invoice October", "ann@example.net"), null, "a forward is not a reply");
	assert.equal(await mailbox.findThreadBySubject("Re: Invoice October", "zed@example.net"), null, "someone outside the thread");
	assert.equal(await mailbox.findThreadBySubject("Re: Invoice October", "nn@example.net"), null, "no substring matches");
	assert.equal(await mailbox.findThreadBySubject("Re: Invoice October", undefined), null);
	assert.equal(await mailbox.findThreadBySubject("Re: Old news", "bob@example.org"), null, "older than two days");
	assert.equal(await mailbox.findThreadBySubject("Re: Quote", "dan@example.org"), "e4", "someone this mailbox wrote to");
});

test("pickSubjectThread applies the two day window itself", () => {
	const row = { thread_id: "t1", subject: "Plan", sender: "ann@example.net", recipient: A, folder_id: "inbox" };
	assert.equal(t.pickSubjectThread([{ ...row, date: hoursAgo(47) }], "Re: Plan", "ann@example.net", NOW), "t1");
	assert.equal(t.pickSubjectThread([{ ...row, date: hoursAgo(49) }], "Re: Plan", "ann@example.net", NOW), null);
	assert.equal(t.pickSubjectThread([{ ...row, date: hoursAgo(1), folder_id: "inbox", sender: "x@example.org", recipient: "ann@example.net" }], "Re: Plan", "ann@example.net", NOW), null, "a recipient of inbound mail is not a participant");
});

test("resolveThreadId tries headers, then the subject, then a new thread", async () => {
	const calls = [];
	const store = (byIds, bySubject) => ({
		findThreadByMessageIds: async (ids) => (calls.push(["ids", ids]), byIds),
		findThreadBySubject: async (s, from) => (calls.push(["subject", s, from]), bySubject),
	});
	const msg = { messageId: "new", inReplyTo: "p@x", references: ["r@x"], subject: "Re: Plan", sender: "ann@example.net" };
	assert.equal(await t.resolveThreadId(store("t1", "t2"), msg), "t1");
	assert.equal(await t.resolveThreadId(store(null, "t2"), msg), "t2");
	assert.equal(await t.resolveThreadId(store(null, null), msg), "new");
	calls.length = 0;
	assert.equal(await t.resolveThreadId(store(null, "t2"), { ...msg, inReplyTo: null, references: [], subject: "Plan" }), "new");
	assert.deepEqual(calls, [], "no lookups without headers or a reply prefix");
});

test("inbound mail with a References header for unknown mail starts its own thread", async () => {
	const bundle = await build({ entryPoints: ["workers/index.ts"], bundle: true, platform: "node", format: "esm", write: false });
	const { receiveEmail } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
	const raw = new TextEncoder().encode(
		"From: mallory@example.org\r\nTo: jane@example.com\r\nSubject: Re: Invoice\r\nMessage-ID: <m1@example.org>\r\n"
		+ "In-Reply-To: <guess@example.com>\r\nReferences: <guess@example.com>\r\n\r\nHello",
	);
	const d1 = await openD1();
	await d1.addMailboxes("jane@example.com");
	// Another mailbox holds the guessed message; it must not join.
	await new D1Mailbox(d1.sql, {}, "other@example.com").createEmail("sent", {
		id: "g1", subject: "Invoice", sender: "other@example.com", recipient: "x@example.org", date: hoursAgo(1), body: "", thread_id: "t-guess", message_id: "guess@example.com",
	}, []);
	await receiveEmail(
		{ to: "jane@example.com", rawSize: raw.length, raw: new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } }), setReject: () => {} },
		{ EMAIL_ADDRESSES: ["jane@example.com"], BUCKET: { head: async () => ({}) }, DB: d1.DB },
		{ waitUntil: () => {} },
	);
	const saved = await d1.sql.first(`SELECT email_id AS id, thread_id FROM messages WHERE mailbox_id = 'jane@example.com'`);
	assert.equal(saved.thread_id, saved.id);
	assert.notEqual(saved.thread_id, "guess@example.com");
});

test("every reply prefix the subject fallback accepts is stripped before comparing", () => {
	for (const s of ["Re: Plan", "Antw: Plan", "RE[2]: Plan", "Aw[3]: Re: Plan", "SV: Plan"]) {
		assert.equal(t.normalizeThreadSubject(s), "plan", s);
	}
	const row = { thread_id: "t1", subject: "Plan", sender: "ann@example.net", recipient: A, folder_id: "inbox", date: hoursAgo(1) };
	assert.equal(t.pickSubjectThread([row], "Antw: Plan", "ann@example.net", NOW), "t1");
	assert.equal(t.pickSubjectThread([row], "RE[2]: Plan", "ann@example.net", NOW), "t1");
});

test("References keeps every Message-ID, with or without space between them", () => {
	assert.deepEqual(t.parseReferences("<a@x> <b@x>"), ["a@x", "b@x"]);
	assert.deepEqual(t.parseReferences("<a@x><b@x>"), ["a@x", "b@x"]);
	assert.deepEqual(t.parseReferences("<a@x>,\r\n <b@x>"), ["a@x", "b@x"]);
	assert.deepEqual(t.parseReferences("a@x b@x"), ["a@x", "b@x"], "ids without angle brackets");
	assert.deepEqual(t.parseReferences(""), []);
});

test("inbound mail whose References has no space between ids joins the referenced thread", async () => {
	const bundle = await build({ entryPoints: ["workers/index.ts"], bundle: true, platform: "node", format: "esm", write: false });
	const { receiveEmail } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
	const d1 = await openD1();
	await d1.addMailboxes("jane@example.com");
	await new D1Mailbox(d1.sql, {}, "jane@example.com").createEmail("sent", {
		id: "s1", subject: "Plan", sender: "jane@example.com", recipient: "bob@example.net", date: hoursAgo(1), body: "", thread_id: "t-sent", message_id: "orig@example.com",
	}, []);
	const raw = new TextEncoder().encode(
		"From: bob@example.net\r\nTo: jane@example.com\r\nSubject: Update\r\nMessage-ID: <r1@example.net>\r\n"
		+ "References: <other@example.net><orig@example.com>\r\n\r\nHello",
	);
	await receiveEmail(
		{ to: "jane@example.com", rawSize: raw.length, raw: new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } }), setReject: () => {} },
		{ EMAIL_ADDRESSES: ["jane@example.com"], BUCKET: { head: async () => ({}) }, DB: d1.DB },
		{ waitUntil: () => {} },
	);
	const saved = await d1.sql.first(`SELECT thread_id, email_references FROM messages WHERE message_id = 'r1@example.net'`);
	assert.equal(saved.thread_id, "t-sent");
	assert.deepEqual(JSON.parse(saved.email_references), ["other@example.net", "orig@example.com"]);
});
