import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// The dev sample inbox (workers/lib/dev-seed): built as plain data, so what it
// holds can be checked without a database.

const { buildInbox, toStored, resolveAddresses, ID_PREFIX, LABELS, NEWEST_MINUTES } = await loadTs("workers/lib/dev-seed/build.ts");
const { Clock } = await loadTs("workers/lib/dev-seed/kit.ts");

const NOW = Date.UTC(2026, 9, 13, 18, 30);
const SIX = ["hello@example.com", "billing@example.com", "support@example.org", "legal@example.org", "ops@example.net", "press@example.net"];
const build = (addresses = SIX, extra = 0, tzOffset = 420) => buildInbox({ now: NOW, tzOffset, addresses: resolveAddresses(addresses), extra });

test("the sample inbox is big and spread across every address and folder", () => {
	const { messages } = build();
	assert.ok(messages.length >= 300, `${messages.length} messages`);
	for (const role of ["hello", "billing", "support", "legal", "ops", "press"]) {
		assert.ok(messages.filter((m) => m.box === role).length >= 15, `${role} has mail`);
	}
	for (const folder of ["inbox", "sent", "draft", "archive", "trash", "spam"]) {
		assert.ok(messages.some((m) => m.folder === folder), `${folder} has mail`);
	}
	const unread = messages.filter((m) => m.folder === "inbox" && !m.read).length;
	assert.ok(unread >= 15 && unread <= 70, `${unread} unread`);
	assert.ok(messages.filter((m) => m.folder === "draft").length >= 4);
	assert.ok(messages.filter((m) => m.attachments?.length).length >= 30);
	assert.ok(new Set(messages.map((m) => m.from.addr.split("@")[1])).size >= 40, "many different senders");
});

test("keys are unique and every thread and reply points at a real message", () => {
	const { messages } = build();
	const byKey = new Map(messages.map((m) => [m.key, m]));
	assert.equal(byKey.size, messages.length);
	for (const m of messages) {
		const root = byKey.get(m.thread);
		assert.ok(root, `${m.key}: thread ${m.thread} exists`);
		assert.ok(root.at <= m.at, `${m.key}: opens after its thread starts`);
		if (m.replyTo) {
			const parent = byKey.get(m.replyTo);
			assert.ok(parent, `${m.key}: replies to ${m.replyTo}`);
			assert.ok(parent.at < m.at, `${m.key}: later than ${m.replyTo}`);
			assert.equal(parent.thread, m.thread, `${m.key}: same thread as its parent`);
			assert.equal(parent.box, m.box, `${m.key}: same mailbox as its parent`);
		}
	}
});

test("whatever the time of day or zone: nothing is from the future, replies follow what they answer, one message just arrived", () => {
	for (const hour of [0, 1, 3, 6, 9, 12, 15, 18, 21, 23]) {
		for (const tz of [420, 0, -330, 300]) {
			const now = Date.UTC(2026, 9, 13, hour, 7);
			const { messages } = buildInbox({ now, tzOffset: tz, addresses: resolveAddresses(SIX) });
			const byKey = new Map(messages.map((m) => [m.key, m]));
			const where = `${hour}:07 UTC, offset ${tz}`;
			assert.equal(Math.max(...messages.map((m) => m.at)), now - NEWEST_MINUTES * 60_000, where);
			assert.equal(messages.filter((m) => m.at > now - 5 * 60_000).length, 1, `only one message is newer than five minutes (${where})`);
			for (const m of messages) {
				if (m.replyTo) assert.ok(byKey.get(m.replyTo).at < m.at, `${m.key} follows ${m.replyTo} (${where})`);
				assert.ok(byKey.get(m.thread).at <= m.at, `${m.key} is not before its thread (${where})`);
			}
		}
	}
	const { messages } = build();
	assert.ok(NOW - Math.min(...messages.map((m) => m.at)) > 60 * 86_400_000, "reaches back two months");
});

test("people write in waking hours", () => {
	const { messages } = build();
	const clock = new Clock(NOW, 420);
	const people = messages.filter((m) => !m.auto && m.folder !== "spam" && m.at < NOW - 3 * 3_600_000);
	assert.ok(people.length > 100);
	const night = people.filter((m) => clock.parts(m.at).h < 6).map((m) => `${m.key} ${clock.time(m.at)}`);
	assert.ok(night.length <= 3, `people writing between midnight and 6: ${night.join(", ")}`);
});

test("a reply quotes the time its parent really has", () => {
	const inbox = build();
	const clock = new Clock(NOW, 420);
	const byKey = new Map(inbox.messages.map((m) => [m.key, m]));
	let quoted = 0;
	for (const m of inbox.messages) {
		if (!m.replyTo || !m.html.includes("gmail_quote")) continue;
		const parent = byKey.get(m.replyTo);
		assert.ok(m.html.includes(`On ${clock.long(parent.at)}, ${parent.from.name}`), `${m.key} quotes ${parent.key} at ${clock.long(parent.at)}`);
		quoted++;
	}
	assert.ok(quoted >= 40, `${quoted} quoted replies`);
});

test("every address is under a reserved example domain", () => {
	const { messages } = build();
	const ok = /@([a-z0-9-]+\.)*example\.(com|org|net)$/;
	for (const m of messages) {
		for (const p of [m.from, ...m.to, ...(m.cc ?? [])]) assert.match(p.addr, ok, `${m.key}: ${p.addr}`);
	}
	const text = JSON.stringify(messages.map((m) => [m.subject, m.html]));
	assert.doesNotMatch(text, /https?:\/\/(?![a-z0-9.-]*example\.(com|org|net))/i, "links stay on example domains");
});

test("labels used exist, and a mailbox owner's mail comes from the mailbox address", () => {
	const { messages, addresses } = build();
	const known = new Set(LABELS.map((l) => l.name));
	for (const m of messages) {
		for (const l of m.labels ?? []) assert.ok(known.has(l), `${m.key}: label ${l}`);
		if (m.folder === "sent" || m.folder === "draft") assert.equal(m.from.addr, addresses[m.box], m.key);
		else assert.ok(m.to.some((p) => p.addr === addresses[m.box]) || m.to.length > 0, m.key);
	}
	for (const label of known) assert.ok(messages.some((m) => m.labels?.includes(label)), `label ${label} is used`);
});

test("the same inbox comes out every time, and it follows the clock", () => {
	const a = build();
	const b = build();
	assert.deepEqual(a.messages.map((m) => [m.key, m.at, m.subject, m.html]), b.messages.map((m) => [m.key, m.at, m.subject, m.html]));
	const later = buildInbox({ now: NOW + 86_400_000, tzOffset: 420, addresses: a.addresses });
	assert.equal(Math.max(...later.messages.map((m) => m.at)), NOW + 86_400_000 - NEWEST_MINUTES * 60_000);
});

test("working hours follow the developer's time zone", () => {
	const hourOf = (inbox, key, tz) => new Date(inbox.messages.find((m) => m.key === key).at - tz * 60_000).getUTCHours();
	// A message set at 09:12 local on its day, in two zones.
	assert.equal(hourOf(build(SIX, 0, 420), "hollowpines-1", 420), 9);
	assert.equal(hourOf(build(SIX, 0, -60), "hollowpines-1", -60), 9);
});

test("fewer addresses than parts still gets every part an address", () => {
	const two = build(["me@example.com", "you@example.org"]);
	const used = new Set(two.messages.map((m) => m.box));
	assert.equal(used.size, 6);
	assert.ok([...Object.values(two.addresses)].every((a) => ["me@example.com", "you@example.org"].includes(a)));
	assert.deepEqual(resolveAddresses([]).hello, "hello@example.com");
	assert.equal(resolveAddresses(["Billing@Example.com"]).billing, "billing@example.com");
});

test("extra adds plain messages for long lists", () => {
	const { messages } = build(SIX, 600);
	assert.equal(messages.filter((m) => m.key.startsWith("filler-")).length, 600);
	assert.equal(new Set(messages.map((m) => m.key)).size, messages.length);
});

test("as stored: ids, RFC threading, headers and files", () => {
	const inbox = build();
	const stored = toStored(inbox);
	assert.equal(stored.length, inbox.messages.length);
	const ids = new Set(stored.map((s) => s.id));
	assert.equal(ids.size, stored.length);
	const byKey = new Map(stored.map((s) => [s.msg.key, s]));
	for (const s of stored) {
		assert.ok(s.id.startsWith(ID_PREFIX));
		assert.ok(s.email.thread_id.startsWith(ID_PREFIX) && ids.has(s.email.thread_id), `${s.id}: thread id`);
		const headers = JSON.parse(s.email.raw_headers);
		const get = (k) => headers.find((h) => h.key === k)?.value;
		assert.match(get("from"), /^"[^"]+" <[^>]+@[^>]+>$/, `${s.id}: From`);
		assert.equal(get("message-id"), s.email.message_id);
		assert.ok(s.email.date.endsWith("Z"));
		if (s.msg.replyTo) {
			const parent = byKey.get(s.msg.replyTo).email;
			// A reply draft names its parent by stored id, as the app's own drafts do.
			assert.equal(s.email.in_reply_to, s.msg.folder === "draft" ? parent.id : parent.message_id, `${s.id}: In-Reply-To`);
			const refs = JSON.parse(s.email.email_references);
			assert.equal(refs[refs.length - 1], parent.message_id);
			assert.equal(get("in-reply-to"), parent.message_id);
			assert.equal(get("references"), refs.join(" "));
		}
		if (s.msg.list) {
			assert.ok(get("list-id") && get("list-unsubscribe"), `${s.id}: list headers`);
		}
		for (const a of s.attachments) {
			assert.ok(a.size > 0 && a.size === a.bytes.length);
			assert.match(a.filename, /^[\w.-]+$/, `${s.id}: file name ${a.filename}`);
		}
	}
	assert.ok(stored.some((s) => s.email.in_reply_to));
});

test("generated files open: PDFs have a valid cross-reference table, calendars and CSVs are well formed", () => {
	const { messages } = build();
	const files = messages.flatMap((m) => m.attachments ?? []);
	const kinds = new Set(files.map((f) => f.mimetype));
	for (const type of ["application/pdf", "text/calendar", "text/csv", "image/svg+xml", "application/json"]) assert.ok(kinds.has(type), `has ${type}`);
	const names = files.map((f) => f.filename);
	assert.ok(new Set(names).size >= names.length * 0.7, "file names vary");
	for (const f of files) {
		const text = Buffer.from(f.bytes).toString("latin1");
		if (f.mimetype === "application/pdf") {
			assert.ok(text.startsWith("%PDF-1.4\n") && text.endsWith("%%EOF\n"), `${f.filename}: PDF frame`);
			const xref = Number(text.match(/startxref\n(\d+)/)[1]);
			assert.equal(text.slice(xref, xref + 4), "xref", `${f.filename}: startxref points at xref`);
			const count = Number(text.match(/xref\n0 (\d+)/)[1]);
			const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
			assert.equal(offsets.length, count - 1);
			offsets.forEach((o, i) => assert.equal(text.slice(o).startsWith(`${i + 1} 0 obj`), true, `${f.filename}: object ${i + 1} at ${o}`));
		}
		if (f.mimetype === "text/calendar") {
			assert.match(text, /^BEGIN:VCALENDAR\r\n/);
			assert.match(text, /DTSTART:\d{8}T\d{6}Z/);
			assert.ok(text.endsWith("END:VCALENDAR\r\n"));
		}
		if (f.mimetype === "text/csv") assert.ok(text.split("\n").length >= 3 && text.endsWith("\n"));
		if (f.mimetype === "application/json") JSON.parse(text);
		if (f.mimetype === "image/svg+xml") assert.match(text, /^<svg [^>]*xmlns=/);
	}
});

test("the copy follows the project's writing rules", () => {
	const { messages } = build();
	for (const m of messages) {
		const text = `${m.subject} ${m.html}`;
		assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${m.key}: no emoji`);
		assert.doesNotMatch(text, /—/, `${m.key}: no em dash`);
		assert.doesNotMatch(text, /seamlessly|effortlessly|leverage|unlock|delve/i, `${m.key}: no filler`);
	}
});
