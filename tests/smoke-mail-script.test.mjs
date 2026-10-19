import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { promisify } from "node:util";

// scripts/smoke-mail.mjs (#38) against a stand-in deployment that keeps mail in memory. With
// `asText`, outgoing attachments arrive as their base64 text, as they did before #28 was fixed.
// With `textNewline`, text attachments arrive with one more 0x0a, as they did before #59 was fixed.

const run = promisify(execFile);

function deployment({ asText = false, textNewline = false } = {}) {
	const emails = new Map();
	let next = 0;
	// Each send is one message: its copies share `msgid`. A reply joins the thread of the copy it answers on each side.
	const send = (mailbox, body, inReplyTo) => {
		const msgid = `m${++next}`;
		const threadOf = (box) => (inReplyTo ? [...emails.values()].find((e) => e.mailbox === box && e.msgid === inReplyTo)?.thread_id : undefined);
		const store = (box, folder, files) => {
			const id = `e${++next}`;
			emails.set(id, { id, msgid, mailbox: box, folder_id: folder, subject: body.subject, body: body.html, cc: body.cc ?? null, attachments: files, thread_id: threadOf(box) ?? id });
			return emails.get(id);
		};
		const files = (body.attachments ?? []).map((a, i) => ({ id: `${msgid}-a${i}`, filename: a.filename, bytes: Buffer.from(a.content, "base64") }));
		const sent = store(mailbox, "sent", files);
		const carried = (f) => {
			if (asText) return Buffer.from(f.bytes.toString("base64"));
			return textNewline && f.filename.endsWith(".txt") ? Buffer.concat([f.bytes, Buffer.from("\n")]) : f.bytes;
		};
		const arrived = files.map((f) => ({ ...f, id: `${f.id}-in`, bytes: carried(f) }));
		for (const to of [body.to, body.cc].flat().filter((a) => a && a !== mailbox)) store(to, "inbox", arrived);
		return sent;
	};
	const view = ({ msgid, mailbox, ...e }) => ({ ...e, attachments: e.attachments.map(({ bytes, ...a }) => ({ ...a, size: bytes.length })) });

	const server = createServer(async (req, res) => {
		const url = new URL(req.url, "http://x");
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
		const reply = (status, data) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
		if (url.pathname === "/api/v1/mail") {
			const address = url.searchParams.get("address");
			const rows = [...emails.values()].filter((e) => e.mailbox === address && e.folder_id === "inbox").reverse();
			return reply(200, { conversations: rows.map((e) => ({ mailbox_id: e.mailbox, email_id: e.id, subject: e.subject })) });
		}
		const [, , , , mailbox, kind, id, action, attId] = url.pathname.split("/").map(decodeURIComponent);
		if (kind !== "emails") return reply(404, {});
		if (req.method === "POST" && !id) return reply(202, { id: send(mailbox, body).id });
		const email = emails.get(id);
		if (!email || email.mailbox !== mailbox) return reply(404, { error: "not found" });
		if (req.method === "POST" && action === "reply") return reply(202, { id: send(mailbox, body, email.msgid).id });
		if (req.method === "POST" && action === "forward") {
			const kept = email.attachments.filter((a) => body.forward_attachments?.includes(a.id));
			return reply(202, { id: send(mailbox, { ...body, attachments: kept.map((a) => ({ content: a.bytes.toString("base64"), filename: a.filename })) }).id });
		}
		if (req.method === "GET" && action === "attachments") {
			const att = email.attachments.find((a) => a.id === attId);
			return att ? res.writeHead(200).end(att.bytes) : reply(404, {});
		}
		if (req.method === "GET") return reply(200, view(email));
		if (req.method === "DELETE") {
			if (req.headers.origin !== `http://127.0.0.1:${server.address().port}`) return reply(403, { error: "Cross-site request refused" });
			email.folder_id = "trash";
			return reply(200, { status: "trashed" });
		}
		reply(404, {});
	});
	return { server, emails };
}

async function smoke(server) {
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const env = {
		...process.env,
		SMOKE_URL: `http://127.0.0.1:${server.address().port}`,
		SMOKE_FROM: "a@example.com",
		SMOKE_TO: "b@example.org",
		SMOKE_TIMEOUT: "2",
		SMOKE_POLL_MS: "50",
	};
	try {
		const { stdout } = await run("node", ["scripts/smoke-mail.mjs"], { env });
		return { code: 0, out: stdout };
	} catch (e) {
		return { code: e.code, out: e.stdout + e.stderr };
	} finally {
		server.close();
	}
}

test("smoke:mail passes when mail and its attachment arrive intact, and trashes what it sent", async () => {
	const { server, emails } = deployment();
	const { code, out } = await smoke(server);
	assert.equal(code, 0, out);
	for (const line of ["subject", "HTML formatting", "Cc header", "attachment: smoke.bin matches byte for byte", "attachment: smoke.txt matches byte for byte", "reply threads on b@example.org", "reply threads on a@example.com", "forward attachment: smoke.bin matches byte for byte", "forward attachment: smoke.txt matches byte for byte"]) {
		assert.match(out, new RegExp(`ok   ${line.replace(/[.]/g, "\\.")}`), out);
	}
	assert.match(out, /ok {3}moved 6 of 6 to Trash/);
	assert.ok([...emails.values()].every((e) => e.folder_id === "trash"), "nothing left outside Trash");
});

test("smoke:mail fails when an attachment arrives as base64 text (#28)", async () => {
	const { server } = deployment({ asText: true });
	const { code, out } = await smoke(server);
	assert.equal(code, 1, out);
	assert.match(out, /FAIL attachment: smoke\.bin matches byte for byte/);
});

test("smoke:mail fails when a text attachment gains a newline (#59)", async () => {
	const { server } = deployment({ textNewline: true });
	const { code, out } = await smoke(server);
	assert.equal(code, 1, out);
	assert.match(out, /FAIL attachment: smoke\.txt matches byte for byte: 17 bytes, expected 16/);
	assert.match(out, /ok {3}attachment: smoke\.bin matches byte for byte/);
});

test("smoke:mail needs two addresses", async () => {
	try {
		await run("node", ["scripts/smoke-mail.mjs"], { env: { ...process.env, SMOKE_URL: "http://127.0.0.1:9", SMOKE_FROM: "", SMOKE_TO: "" } });
		assert.fail("should exit non-zero");
	} catch (e) {
		assert.equal(e.code, 2);
		assert.match(e.stderr, /SMOKE_FROM and SMOKE_TO/);
	}
});
