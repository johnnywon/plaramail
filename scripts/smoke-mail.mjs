#!/usr/bin/env node
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Post-deploy mail check: sends real mail between two of the deployment's
// addresses and reads it back. Opt-in, since it sends mail and uses quota.
//
//   SMOKE_FROM, SMOKE_TO   two configured addresses (required)
//   SMOKE_URL              the deployment (defaults to the first route in wrangler.jsonc)
//   SMOKE_ACCESS_CLIENT_ID, SMOKE_ACCESS_CLIENT_SECRET
//                          an Access service token the app's Access policy allows
//   SMOKE_TIMEOUT          seconds to wait for each delivery (default 60)
//
// One line per check, then everything it sent or received is moved to Trash.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function defaultBase() {
	try {
		const config = readFileSync(join(root, "wrangler.jsonc"), "utf8");
		const route = config.match(/"pattern":\s*"([^"]*)"/)?.[1];
		return route ? `https://${route}` : "";
	} catch {
		return "";
	}
}

const BASE = (process.env.SMOKE_URL || defaultBase()).replace(/\/$/, "");
const FROM = (process.env.SMOKE_FROM || "").toLowerCase();
const TO = (process.env.SMOKE_TO || "").toLowerCase();
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT || 60) * 1000;
const POLL_MS = Number(process.env.SMOKE_POLL_MS || 3000);

if (!BASE || !FROM || !TO) {
	console.error("Set SMOKE_FROM and SMOKE_TO to two configured addresses, and SMOKE_URL if wrangler.jsonc has no route.");
	process.exit(2);
}

const auth = process.env.SMOKE_ACCESS_CLIENT_ID
	? { "cf-access-client-id": process.env.SMOKE_ACCESS_CLIENT_ID, "cf-access-client-secret": process.env.SMOKE_ACCESS_CLIENT_SECRET || "" }
	: {};

async function api(method, path, body) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		redirect: "manual",
		headers: {
			...auth,
			// Writes come from this origin with a JSON body type (workers/lib/csrf.ts).
			...(method !== "GET" ? { "content-type": "application/json", origin: BASE } : {}),
			...(method === "POST" ? { "idempotency-key": crypto.randomUUID() } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (res.status >= 300 && res.status < 400) throw new Error(`${method} ${path} redirected to sign-in. Check the service token and the Access policy.`);
	if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
	return res;
}

const json = async (method, path, body) => (await api(method, path, body)).json();
const box = (address) => `/api/v1/mailboxes/${encodeURIComponent(address)}`;

let failed = 0;
function check(name, ok, detail = "") {
	if (ok) console.log(`  ok   ${name}`);
	else {
		failed++;
		console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
	}
	return ok;
}

/** The received email in `address`'s inbox with exactly this subject, once it arrives. */
async function waitFor(address, subject) {
	const deadline = Date.now() + TIMEOUT_MS;
	const params = new URLSearchParams({ view: "inbox", address, limit: "50" });
	while (Date.now() < deadline) {
		const page = await json("GET", `/api/v1/mail?${params}`);
		const row = page.conversations?.find((c) => c.subject === subject && c.mailbox_id === address);
		if (row) return email(address, row.email_id);
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	return null;
}

const email = (address, id) => json("GET", `${box(address)}/emails/${encodeURIComponent(id)}`);

async function bytesOf(address, emailId, attachmentId) {
	return new Uint8Array(await (await api("GET", `${box(address)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`)).arrayBuffer());
}

const FILE = Uint8Array.from({ length: 256 }, (_, i) => i);
const FILENAME = "smoke.bin";
const sameBytes = (a) => a.length === FILE.length && a.every((b, i) => b === FILE[i]);

async function attachmentCheck(name, address, received) {
	const att = received?.attachments?.find((a) => a.filename === FILENAME);
	if (!check(`${name}: has ${FILENAME}`, !!att)) return null;
	const got = await bytesOf(address, received.id, att.id);
	check(`${name}: ${FILENAME} matches byte for byte`, sameBytes(got), `${got.length} bytes, expected ${FILE.length}`);
	return att;
}

const subject = `[smoke] ${new Date().toISOString()}`;
const toTrash = [];
console.log(`Mail smoke: ${BASE}, ${FROM} -> ${TO}`);

try {
	// 1. Send with a Cc back to the sender, HTML formatting and a binary attachment.
	const sent = await json("POST", `${box(FROM)}/emails`, {
		from: FROM, to: TO, cc: FROM, subject,
		html: "<p><b>Smoke test</b></p><ul><li>one</li><li>two</li></ul>",
		text: "Smoke test\n- one\n- two",
		attachments: [{ content: Buffer.from(FILE).toString("base64"), filename: FILENAME, type: "application/octet-stream", disposition: "attachment" }],
	});
	toTrash.push([FROM, sent.id]);
	check("send", !!sent.id);

	// 2. It arrives with its subject, formatting, Cc and attachment.
	const received = await waitFor(TO, subject);
	if (check(`delivered to ${TO}`, !!received, `nothing within ${TIMEOUT_MS / 1000} s`)) {
		toTrash.push([TO, received.id]);
		check("subject", received.subject === subject);
		check("HTML formatting", /<b>Smoke test<\/b>/i.test(received.body || "") && /<li>one<\/li>/i.test(received.body || ""));
		check("Cc header", (received.cc || "").toLowerCase().includes(FROM), received.cc || "no Cc");
		const att = await attachmentCheck("attachment", TO, received);

		// 3. A reply threads into one conversation on both sides.
		const reply = await json("POST", `${box(TO)}/emails/${encodeURIComponent(received.id)}/reply`, {
			from: TO, to: FROM, subject: `Re: ${subject}`, html: "<p>Reply</p>", text: "Reply",
		});
		toTrash.push([TO, reply.id]);
		const replySent = await email(TO, reply.id);
		check(`reply threads on ${TO}`, replySent.thread_id === received.thread_id);
		const replyIn = await waitFor(FROM, `Re: ${subject}`);
		if (check(`reply delivered to ${FROM}`, !!replyIn)) {
			toTrash.push([FROM, replyIn.id]);
			const original = await email(FROM, sent.id);
			check(`reply threads on ${FROM}`, replyIn.thread_id === original.thread_id);
		}

		// 4. A forward carries the attachment.
		if (att) {
			const fwd = await json("POST", `${box(TO)}/emails/${encodeURIComponent(received.id)}/forward`, {
				from: TO, to: FROM, subject: `Fwd: ${subject}`, html: "<p>Forward</p>", text: "Forward", forward_attachments: [att.id],
			});
			toTrash.push([TO, fwd.id]);
			const fwdIn = await waitFor(FROM, `Fwd: ${subject}`);
			if (check(`forward delivered to ${FROM}`, !!fwdIn)) {
				toTrash.push([FROM, fwdIn.id]);
				await attachmentCheck("forward attachment", FROM, fwdIn);
			}
		}
	}
} catch (e) {
	check("requests", false, e.message);
}

// 5. Everything to Trash.
let trashed = 0;
for (const [address, id] of toTrash) {
	try {
		await api("DELETE", `${box(address)}/emails/${encodeURIComponent(id)}`);
		trashed++;
	} catch (e) {
		console.error(`  could not trash ${id} in ${address}: ${e.message}`);
	}
}
check(`moved ${trashed} of ${toTrash.length} to Trash`, trashed === toTrash.length);
process.exit(failed ? 1 : 0);
