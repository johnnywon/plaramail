import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// The Alex profile (workers/lib/dev-seed/alex): 100 messages in nine mailboxes,
// checked as plain data against the story's fixed facts.

const { buildAlex, ALEX_ADDRESSES, ALEX_LABELS, ALEX_PREFIX } = await loadTs("workers/lib/dev-seed/alex/index.ts");
const { toStored } = await loadTs("workers/lib/dev-seed/build.ts");
const { StoryClock, zoned } = await loadTs("workers/lib/dev-seed/alex/clock.ts");
const { RICE_BOWL, BURRITO, orderTotal, orderFood, standings, ROUNDS, TEAMS } = await loadTs("workers/lib/dev-seed/alex/personal.ts");
const { PAYOUT, NORTHLINE_INVOICE, CEDAR_INVOICE } = await loadTs("workers/lib/dev-seed/alex/business.ts");
const { photoBytes } = await loadTs("workers/lib/dev-seed/alex/html.ts");
const { isLabelColor } = await loadTs("shared/label-colors.ts");

// Two days after the story's own Sunday evening: the story stays where it was written.
const NOW = Date.UTC(2026, 9, 13, 22, 0);
const inbox = buildAlex(NOW);
const byKey = new Map(inbox.messages.map((m) => [m.key, m]));

// key: [box, folder, read, starred, labels, New York time]
const SPEC = {
	"H-01": ["hello", "inbox", true, true, ["Cedar"], "2026-09-24 10:07"],
	"H-02": ["hello", "inbox", true, false, ["Cedar"], "2026-09-28 09:10"],
	"H-03": ["hello", "archive", true, false, ["Newsletters"], "2026-10-05 12:20"],
	"H-04": ["hello", "spam", false, false, [], "2026-09-25 15:24"],
	"H-05": ["hello", "inbox", false, false, ["Follow up"], "2026-10-07 16:18"],
	"SUP-01": ["support", "archive", true, false, ["Support", "Resolved"], "2026-09-21 08:43"],
	"SUP-02": ["support", "sent", true, false, [], "2026-09-21 10:02"],
	"SUP-03": ["support", "archive", true, false, [], "2026-09-21 11:14"],
	"SUP-04": ["support", "inbox", true, false, ["Support"], "2026-09-22 10:12"],
	"SUP-05": ["support", "sent", true, false, ["Support", "Waiting on customer"], "2026-09-22 14:32"],
	"SUP-06": ["support", "archive", true, false, ["Incident", "Resolved"], "2026-10-09 00:41"],
	"SUP-07": ["support", "sent", true, false, [], "2026-10-09 02:40"],
	"SUP-08": ["support", "archive", true, false, [], "2026-10-09 09:35"],
	"B-01": ["billing", "archive", true, false, ["Billing"], "2026-09-21 09:06"],
	"B-02": ["billing", "sent", true, false, [], "2026-09-21 10:18"],
	"B-03": ["billing", "archive", true, false, ["Billing", "Receipts"], "2026-10-09 15:05"],
	"B-04": ["billing", "inbox", false, true, ["Billing", "Cedar"], "2026-10-09 00:44"],
	"B-05": ["billing", "inbox", true, false, ["Receipts"], "2026-10-09 10:15"],
	"B-06": ["billing", "draft", true, false, ["Receipts"], "2026-10-09 17:40"],
	"P-01": ["partners", "archive", true, false, ["Vendors"], "2026-09-23 09:32"],
	"P-02": ["partners", "sent", true, false, [], "2026-09-23 11:08"],
	"P-03": ["partners", "archive", true, false, [], "2026-09-24 08:48"],
	"P-04": ["partners", "inbox", true, true, ["Vendors"], "2026-10-06 10:30"],
	"P-05": ["partners", "inbox", true, false, ["Dev"], "2026-09-30 16:52"],
	"P-06": ["partners", "trash", true, false, [], "2026-10-06 10:35"],
	"O-01": ["ops", "archive", true, false, ["Dev"], "2026-09-22 13:02"],
	"O-02": ["ops", "archive", true, false, [], "2026-09-22 14:03"],
	"O-03": ["ops", "archive", true, false, ["Incident", "Resolved"], "2026-10-08 23:37"],
	"O-04": ["ops", "archive", true, false, [], "2026-10-08 23:38"],
	"O-05": ["ops", "sent", true, false, ["Incident"], "2026-10-09 00:09"],
	"O-06": ["ops", "inbox", true, false, ["Incident"], "2026-10-09 01:23"],
	"O-07": ["ops", "archive", true, false, [], "2026-10-09 02:36"],
	"O-08": ["ops", "inbox", false, true, ["Cedar", "Follow up"], "2026-10-11 19:56"],
	"A-01": ["personal", "archive", true, false, ["Personal", "Receipts"], "2026-10-01 22:18"],
	"A-02": ["personal", "archive", true, false, [], "2026-10-01 22:46"],
	"A-03": ["personal", "archive", true, false, ["Shopping"], "2026-09-30 14:11"],
	"A-04": ["personal", "archive", true, false, ["Personal", "Receipts"], "2026-10-09 01:16"],
	"A-05": ["personal", "archive", true, false, [], "2026-10-09 01:48"],
	"A-06": ["personal", "inbox", false, false, ["Personal"], "2026-10-10 11:22"],
	"A-07": ["personal", "inbox", true, true, ["Clients"], "2026-10-09 10:00"],
	"A-08": ["personal", "draft", true, false, ["Clients"], "2026-10-09 10:32"],
	"L-01": ["league", "inbox", true, true, ["Fantasy"], "2026-09-22 18:40"],
	"L-02": ["league", "archive", true, false, ["Fantasy"], "2026-09-27 20:10"],
	"L-03": ["league", "archive", true, false, ["Fantasy"], "2026-10-01 18:50"],
	"L-04": ["league", "inbox", true, false, ["Fantasy"], "2026-10-04 20:15"],
	"L-05": ["league", "sent", true, false, ["Fantasy"], "2026-10-05 08:55"],
	"L-06": ["league", "inbox", false, false, ["Fantasy"], "2026-10-11 19:58"],
	// The extended library: tools, Rae, Cedar's next stage, family, the band and the code club
	"A-09": ["personal", "archive", true, false, ["Family"], "2026-09-26 18:05"],
	"A-10": ["personal", "sent", true, false, ["Family"], "2026-09-26 20:40"],
	"A-11": ["personal", "archive", true, false, ["Receipts"], "2026-10-01 07:02"],
	"A-12": ["personal", "archive", true, false, [], "2026-10-03 09:15"],
	"A-13": ["personal", "archive", true, false, ["Clients"], "2026-09-29 09:40"],
	"A-14": ["personal", "sent", true, false, ["Clients"], "2026-09-29 11:55"],
	"B-07": ["billing", "archive", true, false, ["Billing","Receipts"], "2026-10-01 06:10"],
	"B-08": ["billing", "archive", true, false, ["Billing","Receipts"], "2026-10-01 09:00"],
	"B-09": ["billing", "archive", true, false, ["Billing"], "2026-10-07 08:30"],
	"B-10": ["billing", "archive", true, false, ["Billing"], "2026-09-30 16:20"],
	"BAND-01": ["band", "inbox", true, true, ["Band"], "2026-09-23 14:20"],
	"BAND-02": ["band", "sent", true, false, ["Band"], "2026-09-23 17:05"],
	"BAND-03": ["band", "archive", true, false, ["Band"], "2026-09-24 10:12"],
	"BAND-04": ["band", "inbox", true, false, ["Band"], "2026-09-30 21:15"],
	"BAND-05": ["band", "archive", true, false, ["Band","Receipts"], "2026-10-02 12:00"],
	"BAND-06": ["band", "inbox", false, false, ["Band"], "2026-10-06 15:30"],
	"BAND-07": ["band", "inbox", false, false, ["Band"], "2026-10-10 13:05"],
	"BAND-08": ["band", "spam", false, false, [], "2026-10-08 16:40"],
	"H-06": ["hello", "archive", true, false, ["Dev"], "2026-09-29 15:40"],
	"H-07": ["hello", "archive", true, false, ["Dev"], "2026-10-03 11:05"],
	"H-08": ["hello", "archive", true, false, ["Newsletters"], "2026-09-28 12:15"],
	"H-09": ["hello", "archive", true, false, ["Dev"], "2026-09-29 10:20"],
	"L-07": ["league", "archive", true, false, ["Fantasy"], "2026-09-28 09:12"],
	"L-08": ["league", "inbox", true, false, ["Fantasy"], "2026-10-07 19:30"],
	"O-09": ["ops", "archive", true, false, ["Dev"], "2026-10-01 08:00"],
	"O-10": ["ops", "archive", true, false, ["Dev"], "2026-10-06 14:22"],
	"O-11": ["ops", "archive", true, false, [], "2026-10-06 14:41"],
	"O-12": ["ops", "archive", true, false, ["Dev"], "2026-09-29 09:14"],
	"O-13": ["ops", "archive", true, false, ["Dev"], "2026-10-07 18:30"],
	"O-14": ["ops", "sent", true, false, ["Dev"], "2026-09-25 11:20"],
	"O-15": ["ops", "archive", true, false, [], "2026-09-25 14:02"],
	"O-16": ["ops", "archive", true, false, ["Dev"], "2026-09-25 15:10"],
	"O-17": ["ops", "archive", true, false, ["Dev"], "2026-09-22 10:30"],
	"O-18": ["ops", "archive", true, false, [], "2026-09-22 14:06"],
	"O-19": ["ops", "inbox", true, false, ["Incident"], "2026-10-09 09:12"],
	"O-20": ["ops", "inbox", true, false, ["Incident"], "2026-10-10 16:45"],
	"O-21": ["ops", "inbox", true, false, ["Cedar"], "2026-10-10 11:40"],
	"O-22": ["ops", "sent", true, false, ["Cedar"], "2026-10-10 13:15"],
	"P-07": ["partners", "inbox", true, false, ["Design"], "2026-10-02 10:45"],
	"P-08": ["partners", "sent", true, false, ["Design"], "2026-10-02 13:20"],
	"P-09": ["partners", "archive", true, false, ["Design"], "2026-10-02 10:41"],
	"P-10": ["partners", "inbox", false, false, ["Design"], "2026-10-07 15:12"],
	"P-11": ["partners", "inbox", false, false, ["Design","Billing"], "2026-10-10 09:30"],
	"RCC-01": ["club", "archive", true, false, ["Code Club"], "2026-09-21 19:30"],
	"RCC-02": ["club", "archive", true, true, ["Code Club"], "2026-09-24 11:00"],
	"RCC-03": ["club", "sent", true, false, ["Code Club"], "2026-09-24 20:15"],
	"RCC-04": ["club", "inbox", true, false, ["Code Club"], "2026-09-29 18:45"],
	"RCC-05": ["club", "inbox", true, false, ["Code Club"], "2026-10-02 10:30"],
	"RCC-06": ["club", "archive", true, false, ["Code Club","Receipts"], "2026-10-05 14:02"],
	"RCC-07": ["club", "inbox", false, true, ["Code Club","Follow up"], "2026-10-07 09:10"],
	"RCC-08": ["club", "draft", true, false, ["Code Club"], "2026-10-10 21:30"],
	"SUP-09": ["support", "inbox", true, false, ["Support"], "2026-10-06 11:30"],
	"SUP-10": ["support", "sent", true, false, ["Support","Waiting on customer"], "2026-10-06 13:05"],
};
// key: parent
const REPLIES = { "A-10": "A-09", "A-14": "A-13", "BAND-02": "BAND-01", "BAND-03": "BAND-02", "O-11": "O-10", "O-15": "O-14", "O-18": "O-17", "O-22": "O-21", "P-08": "P-07", "RCC-03": "RCC-01", "RCC-08": "RCC-07", "SUP-10": "SUP-09", "SUP-02": "SUP-01", "SUP-03": "SUP-02", "SUP-05": "SUP-04", "SUP-07": "SUP-06", "SUP-08": "SUP-07", "B-02": "B-01", "B-06": "B-05", "P-02": "P-01", "P-03": "P-02", "O-02": "O-01", "O-04": "O-03", "O-06": "O-05", "O-07": "O-04", "A-02": "A-01", "A-05": "A-04", "A-08": "A-07", "L-05": "L-04" };

const ny = (ms) => {
	const p = zoned(ms);
	return `${p.y}-${String(p.mo + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
};
/** What a reader sees of a message's own words: no tags, no quoted parent, no hidden preheader. */
const own = (html) => html.split('<div class="gmail_quote">')[0].replace(/<div style="display:none[^]*?<\/div>/, "").replace(/<\/?(code|strong|a|span|em)\b[^>]*>/g, "").replace(/<[^>]+>/g, " ")
	.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const words = (text) => text.split(" ").filter(Boolean).length;
const emoji = (text) => (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
const fileText = (m, name) => new TextDecoder().decode(m.attachments.find((a) => a.filename === name).bytes);

test("nine mailboxes on four domains with exactly 100 messages", () => {
	assert.equal(inbox.messages.length, 100);
	const counts = {};
	for (const m of inbox.messages) counts[inbox.addresses[m.box]] = (counts[inbox.addresses[m.box]] ?? 0) + 1;
	assert.deepEqual(counts, {
		"hello@partwell.dev": 9, "support@partwell.dev": 10, "billing@partwell.dev": 10, "partners@partwell.dev": 11,
		"ops@partwell.dev": 22, "alex@alexrivera.me": 14, "league@alexrivera.me": 8,
		"booking@latecommits.band": 8, "alex@riverbendcode.org": 8,
	});
	assert.equal(new Set(Object.values(ALEX_ADDRESSES)).size, 9, "no two parts share an address");
});

test("every slot has the folder, read state, star, labels and New York time the story gives it", () => {
	assert.deepEqual([...byKey.keys()].sort(), Object.keys(SPEC).sort());
	for (const [key, [box, folder, read, starred, labels, at]] of Object.entries(SPEC)) {
		const m = byKey.get(key);
		assert.deepEqual([m.box, m.folder, m.read, !!m.starred, m.labels ?? [], ny(m.at)], [box, folder, read, starred, labels, at], key);
	}
	for (const l of ALEX_LABELS) assert.ok(isLabelColor(l.color), `${l.name}: ${l.color} is in the label palette`);
	const known = new Set(ALEX_LABELS.map((l) => l.name));
	for (const m of inbox.messages) for (const l of m.labels ?? []) assert.ok(known.has(l), `${m.key}: ${l}`);
	assert.deepEqual(inbox.messages.filter((m) => m.folder === "draft").map((m) => m.key).sort(), ["A-08", "B-06", "RCC-08"]);
	assert.deepEqual(inbox.messages.filter((m) => !m.read).map((m) => m.key).sort(), ["A-06", "B-04", "BAND-06", "BAND-07", "BAND-08", "H-04", "H-05", "L-06", "O-08", "P-10", "P-11", "RCC-07"]);
});

test("the incident stays at night, and the newest mail is minutes before the story's Sunday evening", () => {
	assert.equal(ny(inbox.clock.now), "2026-10-11 20:02");
	const newest = inbox.messages.at(-1);
	assert.equal(newest.key, "L-06");
	assert.equal(inbox.clock.now - newest.at, 4 * 60_000);
	assert.equal(inbox.clock.now - byKey.get("O-08").at, 6 * 60_000);
	for (const key of ["O-03", "O-04", "O-05", "SUP-06", "B-04", "A-04", "O-06", "A-05", "O-07", "SUP-07"]) {
		const h = zoned(byKey.get(key).at).h;
		assert.ok(h === 23 || h < 3, `${key} at ${ny(byKey.get(key).at)}`);
	}
});

test("on a later date the whole story moves in whole weeks, keeping weekdays and times of day", () => {
	for (const now of [Date.UTC(2026, 9, 12, 0, 2), Date.UTC(2026, 10, 20, 15), Date.UTC(2026, 11, 31, 5), Date.UTC(2027, 3, 1), Date.UTC(2027, 9, 30, 12)]) {
		const later = buildAlex(now);
		const shift = later.clock.shiftDays;
		assert.equal(shift % 7, 0, `shift ${shift}`);
		assert.ok(later.clock.now <= now && Math.max(...later.messages.map((m) => m.at)) < now, "nothing from the future");
		assert.ok(shift === 0 || ![1, 2, 3, 4, 5, 6, 7].includes(zoned(later.clock.now).mo), "football season, not spring");
		for (const m of later.messages) {
			const a = zoned(m.at);
			const b = zoned(byKey.get(m.key).at);
			assert.deepEqual([a.wd, a.h, a.mi], [b.wd, b.h, b.mi], `${m.key} keeps its weekday and time`);
		}
		const recovery = own(later.messages.find((m) => m.key === "O-07").html);
		assert.ok(recovery.includes(later.clock.long(later.clock.at("2026-10-09T02:36"))), "dates in bodies move too");
		// Month names follow the moved calendar: bills name the month before they arrive, rent the month it's paid in.
		const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
		const of = (key) => later.messages.find((m) => m.key === key);
		const monthOf = (m, back = 0) => MONTHS[(zoned(m.at).mo + 12 - back) % 12];
		for (const key of ["B-07", "B-08", "O-09"]) assert.ok(of(key).subject.endsWith(`for ${monthOf(of(key), 1)}`), `${key} bills ${monthOf(of(key), 1)}`);
		assert.equal(of("A-11").subject, `Rent payment received for ${monthOf(of("A-11"))}`);
		const batch = /goes out on (\w+) (\d+)/.exec(own(of("P-01").html));
		assert.equal(of("P-01").subject, `CAT-${String(MONTHS.indexOf(batch[1]) + 1).padStart(2, "0")}${batch[2].padStart(2, "0")} schema update`, "the batch is named for the day it goes out");
		if (shift) {
			// Every written date moves: none reads the same as it does in the unmoved story.
			const dates = (m) => (m.subject + " " + own(m.html)).match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec) \d{1,2}\b|\b[Tt]he \d{1,2}(?:st|nd|rd|th)\b|\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
			for (const m of later.messages) {
				const was = dates(byKey.get(m.key));
				// A billing period is a calendar month, so its first and last days rightly stay put.
				const LAST = { Jan: 31, Feb: 29, Mar: 31, Apr: 30, May: 31, Jun: 30, Jul: 31, Aug: 31, Sep: 30, Oct: 31, Nov: 30, Dec: 31 };
				const monthEdge = (d) => { const [mo, day] = d.split(" "); return +day === 1 || +day === LAST[mo.slice(0, 3)]; };
				const stuck = dates(m).filter((d, i) => d === was[i] && !monthEdge(d));
				assert.deepEqual(stuck, [], `${m.key} has dates that did not move`);
			}
		}
	}
	assert.equal(new StoryClock(Date.UTC(2027, 3, 1)).shiftDays % 364, 0, "out of season it moves by 52 weeks");
});

test("replies thread under an earlier parent and quote only it, at its real time", () => {
	for (const m of inbox.messages) {
		const root = byKey.get(m.thread);
		assert.ok(root && root.at <= m.at && root.box === m.box, `${m.key}: thread ${m.thread}`);
		assert.equal(m.replyTo, REPLIES[m.key], m.key);
		if (!m.replyTo) continue;
		const parent = byKey.get(m.replyTo);
		assert.ok(parent.at < m.at && parent.thread === m.thread, `${m.key} follows ${parent.key}`);
		if (!m.auto) assert.equal(m.subject, `Re: ${parent.subject.replace(/^Re: /, "")}`, `${m.key} keeps the subject`);
		if (!m.html.includes("gmail_quote")) continue;
		assert.ok(m.html.includes(`On ${inbox.clock.long(parent.at)}, ${parent.from.name}`), `${m.key} quotes ${parent.key}'s time`);
		const quoted = own(m.html.split('<div class="gmail_quote">')[1].replace(/^[^]*?<blockquote>/, ""));
		assert.ok(own(parent.html).includes(quoted), `${m.key} quotes words ${parent.key} wrote: ${quoted}`);
		assert.equal((m.html.match(/gmail_quote/g) ?? []).length, 1, `${m.key} doesn't quote the whole conversation`);
	}
	const threads = new Set(inbox.messages.map((m) => m.thread));
	assert.equal(threads.size, 71);
	for (const m of inbox.messages.filter((x) => x.folder === "sent" || x.folder === "draft")) {
		assert.equal(m.from.addr, inbox.addresses[m.box], `${m.key} comes from its mailbox`);
	}
});

test("sums agree: food orders, invoices, the payout and the league table", () => {
	assert.equal(orderFood(RICE_BOWL), 11.95);
	assert.equal(orderTotal(RICE_BOWL), 18.87);
	assert.equal(orderFood(BURRITO), 13.5);
	assert.equal(orderTotal(BURRITO), 23.19);
	assert.equal(Math.round((NORTHLINE_INVOICE.amount + CEDAR_INVOICE.amount) * 100) / 100, PAYOUT.gross);
	assert.equal(Math.round((PAYOUT.gross - PAYOUT.fees) * 100) / 100, PAYOUT.net);
	assert.deepEqual(standings(3).map((s) => [s.who, `${s.w}-${s.l}`, s.pf]), [
		["priya", "2-1", 350.7], ["nia", "2-1", 347.9], ["ben", "2-1", 345.1], ["alex", "2-1", 341.7],
		["jordan", "1-2", 357.0], ["sam", "1-2", 346.0], ["theo", "1-2", 322.4], ["maya", "1-2", 320.8],
	]);

	const text = (key) => own(byKey.get(key).html);
	for (const m of ["$18.87", "$11.95", "$1.06", "$1.99", "$0.87", "$3.00"]) assert.ok(text("A-01").includes(m), `A-01 shows ${m}`);
	assert.match(text("A-02"), /\$18\.87 \(unchanged\)/);
	for (const key of ["A-04", "A-05"]) for (const m of ["$13.50", "$1.20", "$2.99", "$1.50", "$4.00", "$23.19"]) assert.ok(text(key).includes(m), `${key} shows ${m}`);
	for (const m of ["$149.00", "$1,200.00", "$1,349.00", "−$39.12", "$1,309.88"]) assert.ok(text("B-03").includes(m), `B-03 shows ${m}`);
	for (const game of ROUNDS[0].games) assert.ok(text("L-02").includes(game[1].toFixed(1)) && text("L-02").includes(game[3].toFixed(1)));
	for (const game of ROUNDS[1].games) assert.ok(text("L-04").includes(`${game[1].toFixed(1)} → `) && text("L-04").includes(game[3].toFixed(1)));
	for (const game of ROUNDS[2].games) assert.ok(text("L-06").includes(game[1].toFixed(1)) && text("L-06").includes(game[3].toFixed(1)));
	for (const s of standings(3)) assert.ok(text("L-06").includes(`${TEAMS[s.who]}`) && text("L-06").includes(`${s.w}–${s.l} ${s.pf.toFixed(1)}`), `L-06 lists ${s.who}`);
	assert.match(text("L-06"), /131\.7–130\.9/);
});

test("files are real: PDFs, CSVs and text with the facts in them, photos as JPEG bytes", () => {
	const magic = (bytes, ...head) => head.every((b, i) => bytes[i] === b);
	for (const m of inbox.messages) {
		for (const a of m.attachments ?? []) {
			assert.ok(a.bytes.length > 300, `${m.key} ${a.filename} has bytes`);
			const ext = a.filename.split(".").pop();
			assert.equal(a.mimetype, { pdf: "application/pdf", csv: "text/csv", txt: "text/plain", jpg: "image/jpeg" }[ext], `${m.key} ${a.filename}`);
			if (ext === "pdf") assert.ok(new TextDecoder().decode(a.bytes).startsWith("%PDF-1.4") && new TextDecoder().decode(a.bytes).trimEnd().endsWith("%%EOF"));
			if (ext === "jpg") assert.ok(magic(a.bytes, 0xff, 0xd8, 0xff) && magic(a.bytes.slice(-2), 0xff, 0xd9), `${a.filename} is a JPEG`);
		}
	}
	assert.match(fileText(byKey.get("B-02"), "PW-1042.pdf"), /Invoice PW-1042[^]*Total: \$149\.00 USD/);
	assert.match(fileText(byKey.get("H-02"), "CED-4417-purchase-order.pdf"), /PO number: CED-4417[^]*Total: \$1,200\.00 USD/);
	assert.match(fileText(byKey.get("A-05"), "UE-73419-receipt.pdf"), /Total charged: \$23\.19/);
	assert.match(fileText(byKey.get("P-04"), "catalog-license-renewal.pdf"), /Sign and return by October 23, 2026/);
	const csv = fileText(byKey.get("B-06"), "october-expenses.csv").trim().split("\n").map((l) => l.match(/("[^"]*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")));
	const rowsOf = csv.slice(1).filter((r) => r[2]);
	assert.deepEqual(rowsOf.filter((r) => r[2] === "UE-73419").map((r) => r[3]), ["Order confirmation", "Final receipt"]);
	const counted = rowsOf.filter((r) => r[5] === "yes").reduce((s, r) => s + Math.round(Number(r[4]) * 100), 0) / 100;
	assert.equal(counted, 42.06);
	assert.equal(csv.at(-1)[4], "42.06");
	assert.equal(rowsOf.find((r) => r[2] === "DB-4821")[5], "provisional");
	const metrics = fileText(byKey.get("O-05"), "connection-metrics.txt");
	for (const t of ["23:37", "23:38", "00:09", "60/60"]) assert.ok(metrics.includes(t), `metrics mention ${t}`);
	assert.match(fileText(byKey.get("P-01"), "CAT-0930-sample.csv"), /^sku,manufacturer,manufacturer_part_number,/);
	assert.match(fileText(byKey.get("SUP-04"), "pagination-repro.txt"), /"next_cursor"/);
	assert.match(own(byKey.get("O-07").html), /2:36 AM/);
	assert.match(own(byKey.get("SUP-01").html), /401 invalid_api_key/);
});

test("photos are the verified files, shown inline by content id and credited", () => {
	const manifest = JSON.parse(readFileSync("workers/lib/dev-seed/alex/assets/manifest.json", "utf8"));
	for (const a of manifest) {
		const bytes = photoBytes(a.assetId);
		const sha = createHash("sha256").update(bytes).digest("hex");
		assert.equal(sha, a.sha256, `${a.assetId} matches the manifest`);
		assert.equal(createHash("sha256").update(readFileSync(`workers/lib/dev-seed/alex/assets/${a.filename}`)).digest("hex"), a.sha256, `${a.filename} on disk`);
		assert.equal(bytes.length, a.bytes);
	}
	const used = {};
	for (const m of inbox.messages) {
		const cids = [...m.html.matchAll(/src="cid:([^"]+)"/g)].map((x) => x[1]);
		const parts = (m.attachments ?? []).filter((a) => a.contentId).map((a) => a.contentId);
		assert.deepEqual([...new Set(cids)].sort(), parts.sort(), `${m.key}: every inline image has its part`);
		for (const cid of parts) {
			used[cid.split(".jpg")[0]] = [...(used[cid.split(".jpg")[0]] ?? []), m.key];
			assert.doesNotMatch(m.html, /via Wikimedia Commons/, `${m.key}: no credit line under a CC0 photo`);
		}
		assert.doesNotMatch(m.html, /<img[^>]+src="(?!cid:|data:)/, `${m.key}: no remote images`);
	}
	assert.deepEqual(used, { keyboard: ["A-03"], "food-burrito": ["A-04", "A-05"], coffee: ["H-03"], "football-stadium": ["L-01", "L-06"] });
	assert.deepEqual(byKey.get("A-03").attachments.filter((a) => !a.contentId).map((a) => a.filename), ["keyboard.jpg"]);
	assert.deepEqual(byKey.get("A-06").attachments.map((a) => [a.filename, a.mimetype]), [["coffee.jpg", "image/jpeg"]]);
});

test("links stay in the app, except photo credits", () => {
	for (const m of inbox.messages) {
		for (const [, href] of m.html.matchAll(/href="([^"]+)"/g)) {
			assert.ok(href.startsWith("/api/v1/sample-link?to=https%3A%2F%2F") || /^https:\/\/(commons\.wikimedia\.org|creativecommons\.org)\//.test(href), `${m.key}: ${href}`);
		}
	}
	assert.match(byKey.get("H-03").html, /href="\/api\/v1\/sample-link\?to=https%3A%2F%2Fbuildnotes\.news%2Funsubscribe/, "the newsletter's unsubscribe link");
	assert.equal(byKey.get("H-03").list.id, "small-apis.buildnotes.news");
});

test("reads as real mail: story domains, no placeholders, voices where they belong", () => {
	const visible = inbox.messages.map((m) => [m.key, `${m.subject} ${own(m.html)} ${m.from.name}`]);
	for (const [key, text] of visible) {
		assert.doesNotMatch(text, /example\.(com|org|net)|lorem|ipsum|\bdemo\b|\bsample\b|fixture|placeholder|fictional/i, key);
	}
	for (const m of inbox.messages) for (const p of [m.from, ...m.to, ...(m.cc ?? [])]) assert.doesNotMatch(p.addr, /example\./, m.key);
	const wordsIn = (key) => words(own(byKey.get(key).html));
	for (const [key, min, max] of [["H-01", 180, 240], ["H-05", 90, 140], ["SUP-02", 100, 160], ["SUP-03", 20, 40], ["SUP-07", 140, 200], ["P-05", 180, 260], ["A-06", 70, 100], ["L-03", 70, 120], ["L-05", 25, 50], ["H-03", 300, 450]]) {
		const n = wordsIn(key);
		assert.ok(n >= min && n <= max, `${key}: ${n} words, want ${min}-${max}`);
	}
	assert.ok(emoji(own(byKey.get("L-04").html)) >= 20, "Jordan's round 2 roundup");
	for (const key of ["B-05", "O-06", "O-03", "O-07", "SUP-07", "L-05"]) assert.equal(emoji(own(byKey.get(key).html)), 0, `${key} has no emoji`);
});

test("as stored: stable ids and RFC threading, inline photos as inline parts", () => {
	const stored = toStored(inbox, ALEX_PREFIX);
	const again = toStored(buildAlex(NOW), ALEX_PREFIX);
	assert.deepEqual(stored.map((s) => [s.id, s.email.message_id, s.email.date]), again.map((s) => [s.id, s.email.message_id, s.email.date]));
	const byId = new Map(stored.map((s) => [s.msg.key, s]));
	for (const s of stored) {
		assert.ok(s.id === `${ALEX_PREFIX}${s.msg.key}` && s.email.thread_id === `${ALEX_PREFIX}${s.msg.thread}`);
		if (s.msg.replyTo) {
			const parent = byId.get(s.msg.replyTo).email;
			assert.equal(s.email.in_reply_to, s.msg.folder === "draft" ? parent.id : parent.message_id, s.id);
			assert.equal(JSON.parse(s.email.email_references).at(-1), parent.message_id);
		}
		for (const a of s.attachments) {
			if (a.content_id) assert.equal(a.disposition, "inline");
			else assert.equal(a.disposition, "attachment");
			assert.equal(a.size, a.bytes.length);
		}
	}
	assert.deepEqual(JSON.parse(byId.get("SUP-03").email.email_references), ["<SUP-01@northlineparts.com>", "<SUP-02@partwell.dev>"]);
	const headers = JSON.parse(byId.get("H-03").email.raw_headers);
	assert.ok(headers.some((h) => h.key === "list-id" && h.value === "<small-apis.buildnotes.news>"));
	assert.ok(headers.some((h) => h.key === "list-unsubscribe"));
});

const { XAI_INVOICE, OPENAI_USAGE, RAE_INVOICE, TOOL_SUMS } = await loadTs("workers/lib/dev-seed/alex/tools.ts");
const life = await loadTs("workers/lib/dev-seed/alex/life.ts");
const { LOGOS } = await loadTs("workers/lib/dev-seed/alex/brands/logos.ts");

test("the extended library's sums agree: vendor bills, Rae's invoice, the band's costs, the code club's books", () => {
	const text = (key) => own(byKey.get(key).html);
	assert.equal(TOOL_SUMS.xai(), XAI_INVOICE.total);
	assert.equal(TOOL_SUMS.openai(), OPENAI_USAGE.total);
	assert.equal(TOOL_SUMS.rae(), RAE_INVOICE.total);
	assert.match(text("B-07"), /Total \$62\.40/);
	assert.match(fileText(byKey.get("B-07"), "xAI-invoice-INV-90417.pdf"), /Total: \$62\.40 USD/);
	assert.match(text("B-08"), /Total \$18\.22/);
	assert.match(fileText(byKey.get("P-11"), "RC-0312.pdf"), /14 hours x \$110\.00: \$1,540\.00[^]*Total due: \$1,540\.00/);
	assert.equal(life.studioTotal() - life.STUDIO.deposit, 95);
	assert.match(text("BAND-05"), /Due at the door \$95\.00/);
	assert.equal(life.shirtTotal(), 449);
	assert.match(fileText(byKey.get("BAND-06"), "late-commits-tee-proof.pdf"), /Total: \$449\.00/);
	assert.equal(life.laptopTotal(), 1140);
	assert.equal(life.clubBalance(), 2764.6);
	assert.equal(life.clubAfterLaptops(), 1624.6);
	const csv = fileText(byKey.get("RCC-08"), "treasurer-report.csv").trim().split("\n").slice(1).map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/));
	let balance = 0;
	for (const r of csv) {
		balance = Math.round((balance + Number(r[3])) * 100) / 100;
		assert.equal(Number(r[4]), balance, `running balance after ${r[1]}`);
	}
	assert.equal(balance, 1624.6);
	assert.match(text("RCC-08"), /Balance today: \$2,764\.60/);
	assert.match(text("RCC-06"), /Net \$48\.25/);
	assert.match(text("A-11"), /Amount \$1,850\.00/);
});

test("brands: logo files match their manifest; vendor mail carries its published logo; each person signs with their own mark", () => {
	const manifest = JSON.parse(readFileSync("workers/lib/dev-seed/alex/brands/manifest.json", "utf8"));
	assert.deepEqual(Object.keys(LOGOS).sort(), manifest.map((m) => m.file.replace(/^(vendor|original)\//, "").replace(/\.(svg|png)$/, "")).sort());
	for (const m of manifest) {
		const bytes = readFileSync(`workers/lib/dev-seed/alex/brands/${m.file}`);
		assert.equal(createHash("sha256").update(bytes).digest("hex"), m.sha256, m.file);
		assert.equal(LOGOS[m.file.replace(/^(vendor|original)\//, "").replace(/\.(svg|png)$/, "")].split(",")[1], bytes.toString("base64"), `${m.file} in logos.ts`);
		assert.ok(m.source && m.usage, `${m.file} records its source and usage`);
		if (m.file.endsWith(".svg")) assert.doesNotMatch(bytes.toString(), /<script|\son[a-z]+\s*=|javascript:/i, `${m.file} is inert`);
	}
	const carries = { "A-01": "ubereats-wordmark", "B-03": "stripe-wordmark", "O-01": "github-lockup", "O-03": "cloudflare-logo", "O-19": "supabase-wordmark", "O-09": "vercel-logotype", "B-07": "xai-logo", "O-16": "resend-wordmark", "H-06": "openai-wordmark", "H-09": "claude-logo", "H-07": "cursor-lockup", "O-17": "linear-mark", "P-09": "figma-mark", "O-20": "affine-mark", "H-03": "buildnotes", "A-03": "keyforge", "L-06": "sunday-deploy-league", "P-06": "fieldstone", "H-04": "launchboard" };
	for (const [key, id] of Object.entries(carries)) assert.ok(byKey.get(key).html.includes(LOGOS[id]), `${key} shows ${id}`);
	const signs = { "SUP-01": "northline", "SUP-02": "partwell", "H-01": "cedar", "P-01": "atlas", "P-04": "fieldstone", "B-05": "morganledger", "A-07": "westhaven", "H-05": "procura", "SUP-04": "harbor", "P-05": "priya-shah", "P-07": "rae-collins", "BAND-02": "late-commits", "RCC-03": "riverbend-code-club" };
	for (const [key, id] of Object.entries(signs)) assert.ok(own(byKey.get(key).html) !== "" && byKey.get(key).html.split('<div class="gmail_quote">')[0].includes(LOGOS[id]), `${key} is signed with ${id}`);
	assert.ok(!byKey.get("SUP-02").html.split('<div class="gmail_quote">')[0].includes(LOGOS.northline), "a reply doesn't take the customer's mark");
	for (const m of inbox.messages) assert.doesNotMatch(m.html, /<img[^>]+src="(?!cid:|data:image\/(svg\+xml|png);base64,)/, `${m.key}: images are inline parts or embedded logos`);
});
