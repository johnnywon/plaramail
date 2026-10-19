import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-218: a text alternative for HTML mail, bounce notices linked to the Sent message, DMARC docs.

const { htmlToTextAlternative } = await loadTs("workers/lib/text-alternative.ts");
const { sendEmail } = await loadTs("workers/email-sender.ts");
const { parseMail } = await loadTs("workers/lib/parse-mail.ts");
const { parseBounce, parseDeliveryStatus } = await loadTs("workers/lib/bounce.ts");
const { receiveEmail } = await loadTs("workers/index.ts");
const { mailStore } = await loadTs("workers/store/index.ts");

// ── Text alternative ──────────────────────────────────────────────

test("HTML becomes readable text: paragraphs, breaks, lists, links and entities", () => {
	const html = `<html><head><style>p { color: red }</style></head><body>
		<p>Hi Jane,</p>
		<p>The plan for <b>Friday</b>:<br>first line<br/>second &amp; last</p>
		<ul><li>one</li><li>two</li></ul>
		<p>See <a href="https://example.com/doc?a=1&amp;b=2">the doc</a> or <a href="https://example.org">https://example.org</a>.</p>
		<p>Mail <a href="mailto:ann@example.net">ann@example.net</a></p>
		<script>alert(1)</script>
	</body></html>`;
	assert.equal(htmlToTextAlternative(html), [
		"Hi Jane,",
		"",
		"The plan for Friday:",
		"first line",
		"second & last",
		"",
		"- one",
		"- two",
		"",
		"See the doc (https://example.com/doc?a=1&b=2) or https://example.org.",
		"",
		"Mail ann@example.net",
	].join("\n"));
});

test("quotes keep their > prefix and <pre> keeps its lines", () => {
	assert.equal(
		htmlToTextAlternative("<p>Sounds good.</p><blockquote><p>Lunch?</p><p>J</p></blockquote><pre>a  b\nc</pre>"),
		"Sounds good.\n\n> Lunch?\n>\n> J\n\na b\nc",
	);
	assert.equal(htmlToTextAlternative(""), "");
	assert.equal(htmlToTextAlternative("<div>plain</div>"), "plain");
});

/** The message object sendEmail hands to the Email Sending binding. */
async function bindingMessage(params) {
	let message;
	await sendEmail({ send: async (m) => { message = m; return { messageId: "x" }; } }, {
		to: "jane@example.org", from: "me@example.com", subject: "Hello", ...params,
	});
	return message;
}

test("HTML mail without text gets a generated text part, so it goes out as multipart/alternative", async () => {
	const m = await bindingMessage({ html: "<p>Hello <b>Jane</b></p><p>Bye</p>" });
	assert.equal(m.html, "<p>Hello <b>Jane</b></p><p>Bye</p>");
	assert.equal(m.text, "Hello Jane\n\nBye");
});

test("text the sender wrote is kept, and text-only mail gets no HTML", async () => {
	assert.equal((await bindingMessage({ html: "<p>Hello</p>", text: "Hello, written" })).text, "Hello, written");
	const plain = await bindingMessage({ text: "Just text" });
	assert.equal(plain.text, "Just text");
	assert.equal(plain.html, undefined);
});

// ── Bounce notices ────────────────────────────────────────────────

const ME = "me@example.com";

/** A DSN as an MTA writes it: a note for people, the delivery status, and the returned headers. */
function dsn({ messageId = "<sent-1@example.com>", subject = "Quarterly numbers", recipient = "gone@example.org", returned = "text/rfc822-headers" } = {}) {
	return [
		"From: Mail Delivery Subsystem <mailer-daemon@mx.example.net>",
		`To: ${ME}`,
		"Subject: Undelivered Mail Returned to Sender",
		"Message-ID: <dsn-1@mx.example.net>",
		"MIME-Version: 1.0",
		'Content-Type: multipart/report; report-type=delivery-status; boundary="r1"',
		"",
		"--r1",
		"Content-Type: text/plain; charset=us-ascii",
		"",
		`Your message to ${recipient} could not be delivered.`,
		"--r1",
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns; mx.example.net",
		"Arrival-Date: Mon, 19 Oct 2026 10:00:00 +0000",
		"",
		`Final-Recipient: rfc822; ${recipient}`,
		`Original-Recipient: rfc822;${recipient}`,
		"Action: failed",
		"Status: 5.1.1",
		"Remote-MTA: dns; mx2.example.org",
		"Diagnostic-Code: smtp; 550 5.1.1 <gone@example.org>: Recipient address",
		"    rejected: User unknown",
		"",
		"--r1",
		`Content-Type: ${returned}`,
		"",
		`From: ${ME}`,
		`To: ${recipient}`,
		`Subject: ${subject}`,
		`Message-ID: ${messageId}`,
		"Date: Mon, 19 Oct 2026 09:59:00 +0000",
		...(returned === "message/rfc822" ? ["", "The original body."] : []),
		"",
		"--r1--",
		"",
	].join("\r\n");
}

test("a delivery status notification gives the failed recipient, status, diagnostic and original Message-ID", async () => {
	for (const returned of ["text/rfc822-headers", "message/rfc822"]) {
		const bounce = parseBounce(await parseMail(dsn({ returned })));
		assert.deepEqual(bounce, {
			recipients: [{
				recipient: "gone@example.org", action: "failed", status: "5.1.1",
				diagnostic: "550 5.1.1 <gone@example.org>: Recipient address rejected: User unknown",
			}],
			originalMessageId: "sent-1@example.com",
			originalSubject: "Quarterly numbers",
			originalDate: "Mon, 19 Oct 2026 09:59:00 +0000",
		}, returned);
	}
});

test("several recipients, and blocks without a recipient are skipped", () => {
	const status = "Reporting-MTA: dns; mx.example.net\n\nFinal-Recipient: rfc822; a@example.org\nAction: failed\nStatus: 5.2.2 (mailbox full)\n\nFinal-Recipient: rfc822;<b@example.org>\nAction: delayed\nStatus: 4.4.1\n";
	assert.deepEqual(parseDeliveryStatus(status), [
		{ recipient: "a@example.org", action: "failed", status: "5.2.2", diagnostic: null },
		{ recipient: "b@example.org", action: "delayed", status: "4.4.1", diagnostic: null },
	]);
});

test("ordinary mail and other reports are not bounces", async () => {
	assert.equal(parseBounce(await parseMail(`From: ann@example.org\r\nTo: ${ME}\r\nSubject: Hi\r\n\r\nHello`)), null);
	const feedback = dsn().replace("report-type=delivery-status", "report-type=feedback-report").replace("message/delivery-status", "message/feedback-report");
	assert.equal(parseBounce(await parseMail(feedback)), null);
});

async function mailbox() {
	const d1 = await openD1();
	const env = {
		EMAIL_ADDRESSES: [ME], DB: d1.DB,
		BUCKET: { head: async () => ({}), get: async () => null, put: async () => {}, delete: async () => {} },
	};
	await d1.addMailboxes(ME);
	const store = mailStore(env).mailbox(ME);
	/** A Sent copy as send.ts stores it. */
	const sent = (id, fields = {}) => store.createEmail("sent", {
		id, subject: "Quarterly numbers", sender: ME, recipient: "gone@example.org", cc: null, bcc: null,
		date: new Date().toISOString(), body: "<p>Numbers</p>", in_reply_to: null, email_references: null,
		thread_id: id, message_id: `${id}@example.com`, raw_headers: "[]", ...fields,
	}, []);
	let asked = false;
	const deliver = async (raw) => {
		const bytes = new TextEncoder().encode(raw);
		await receiveEmail(
			{ to: ME, rawSize: bytes.length, setReject: () => {}, raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) },
			{ ...env, EMAIL_AGENT: { idFromName: () => { asked = true; throw new Error("no agent for bounces"); } } },
			{ waitUntil: () => {} },
		);
		return d1.sql.first(`SELECT email_id, thread_id, conversation_id, in_reply_to, folder_id FROM messages WHERE folder_id = 'inbox' ORDER BY id DESC LIMIT 1`);
	};
	const row = (id) => d1.sql.first(`SELECT email_id, thread_id, conversation_id FROM messages WHERE email_id = ?`, id);
	return { d1, sent, deliver, row, asked: () => asked };
}

test("a bounce naming a Sent message's Message-ID joins its conversation", async () => {
	const { sent, deliver, row, asked } = await mailbox();
	await sent("sent-1");
	await sent("other", { subject: "Something else", message_id: "other@example.com" });
	const bounce = await deliver(dsn());
	const original = await row("sent-1");
	assert.equal(bounce.folder_id, "inbox");
	assert.equal(bounce.thread_id, original.thread_id);
	assert.equal(bounce.conversation_id, original.conversation_id);
	assert.equal(bounce.in_reply_to, "sent-1@example.com");
	assert.equal(asked(), false, "bounces never go to an agent");
});

test("a bounce with the mail service's Message-ID matches the Sent message by subject and failed recipient", async () => {
	const { sent, deliver, row } = await mailbox();
	await sent("old", { date: new Date(Date.now() - 30 * 86_400_000).toISOString() });
	await sent("to-someone-else", { recipient: "ann@example.org" });
	await sent("sent-2");
	const bounce = await deliver(dsn({ messageId: "<0100abc.provider@email.example.net>" }));
	assert.equal(bounce.thread_id, (await row("sent-2")).thread_id);
	assert.equal(bounce.in_reply_to, "sent-2@example.com");
});

test("a bounce for mail this mailbox did not send starts its own conversation", async () => {
	const { sent, deliver } = await mailbox();
	await sent("sent-3", { subject: "Unrelated", message_id: "sent-3@example.com" });
	const bounce = await deliver(dsn({ messageId: "<nobody@example.net>", subject: "Never sent" }));
	assert.equal(bounce.thread_id, bounce.email_id);
	assert.equal(bounce.in_reply_to, null);
});

// ── DMARC docs ────────────────────────────────────────────────────

test("docs/setup.md explains DMARC with an example.com record that starts at p=none", () => {
	const setup = readFileSync("docs/setup.md", "utf8");
	const section = setup.slice(setup.indexOf("## DMARC"));
	assert.ok(setup.includes("## DMARC"), "a DMARC section");
	for (const term of ["p=none", "p=quarantine", "p=reject", "SPF", "DKIM", "alignment", "rua="]) assert.ok(section.includes(term), term);
	assert.match(section, /_dmarc\.example\.com/);
	assert.match(section, /v=DMARC1; p=none; rua=mailto:[^@\s]+@example\.com/);
});
