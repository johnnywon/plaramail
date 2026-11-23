// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { DraftNotes } from "../../../shared/draft-notes";

// Local QA only: shared pieces of the sample inbox (see index.ts). Pure code, no storage.

export type Role = "hello" | "billing" | "support" | "legal" | "ops" | "press";
export const ROLES: readonly Role[] = ["hello", "billing", "support", "legal", "ops", "press"];
/** A mailbox a seed profile writes to: the default parts, plus the Alex profile's own (alex/). */
export type Box = Role | "partners" | "personal" | "league" | "band" | "club";

export type SeedFolder = "inbox" | "sent" | "draft" | "archive" | "trash" | "spam";

export interface Person {
	name: string;
	addr: string;
}

export interface Attachment {
	filename: string;
	mimetype: string;
	bytes: Uint8Array;
	/** An inline part the HTML shows as `cid:<contentId>`, not a file in the list. */
	contentId?: string;
}

/** One stored message. `key` is stable across runs; the stored id is derived from it. */
export interface Msg {
	key: string;
	box: Box;
	folder: SeedFolder;
	at: number;
	from: Person;
	to: Person[];
	cc?: Person[];
	subject: string;
	html: string;
	read: boolean;
	starred?: boolean;
	labels?: string[];
	attachments?: Attachment[];
	/** Key of the message that opens the thread. */
	thread: string;
	/** Key of the message this one answers. */
	replyTo?: string;
	list?: { id: string; unsubscribe: string; oneClick?: boolean };
	/** Sent by a machine: adds the headers an automated sender adds. */
	auto?: boolean;
	/** A draft the agent wrote: its notes, so it opens with Redraft. */
	draftNotes?: DraftNotes;
}

export interface LabelSpec {
	name: string;
	color: string;
}

// ── Random, repeatable ──────────────────────────────────────────────

export interface Rng {
	next(): number;
	int(min: number, max: number): number;
	pick<T>(items: readonly T[]): T;
	chance(p: number): boolean;
}

/** mulberry32: the same seed gives the same inbox every run. */
export function rng(seed: number): Rng {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int: (min, max) => min + Math.floor(next() * (max - min + 1)),
		pick: (items) => items[Math.floor(next() * items.length)],
		chance: (p) => next() < p,
	};
}

// ── Time, in the developer's local day ──────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A time as the day and hour a person in the developer's zone would read. `tz` is Date.getTimezoneOffset(): minutes behind UTC. */
export type When = number | [daysAgo: number, hhmm: string];

/** The newest sample message is this many minutes old; every other one is at least five. */
export const NEWEST_MINUTES = 4;
const NOT_BEFORE_MINUTES = 5;

export class Clock {
	constructor(readonly now: number, readonly tz: number) {}

	/** The one message that arrived just now. Nothing else is newer. */
	newest(): number {
		return this.now - NEWEST_MINUTES * 60_000;
	}

	parts(ms: number) {
		const d = new Date(ms - this.tz * 60_000);
		return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
	}

	/** A number is minutes ago. A pair is a local day back at a local time. Never newer than `newest()`. */
	at(when: When): number {
		const latest = this.now - NOT_BEFORE_MINUTES * 60_000;
		if (typeof when === "number") return Math.min(this.now - Math.round(when * 60_000), latest);
		const p = this.parts(this.now);
		const [h, m] = when[1].split(":").map(Number);
		return Math.min(Date.UTC(p.y, p.mo, p.d - when[0], h, m) + this.tz * 60_000, latest);
	}

	/** The first of a month, `back` months before this one, at hh:mm local. Null if it hasn't happened yet. */
	monthStart(back: number, hhmm: string, dayOfMonth = 1): number | null {
		const p = this.parts(this.now);
		const [h, m] = hhmm.split(":").map(Number);
		const ms = Date.UTC(p.y, p.mo - back, dayOfMonth, h, m) + this.tz * 60_000;
		return ms < this.now - NOT_BEFORE_MINUTES * 60_000 ? ms : null;
	}

	/** A person's time of writing, moved out of the small hours (midnight to 6) to about 7 in the morning, if that isn't later than now. */
	awake(ms: number): number {
		const p = this.parts(ms);
		if (p.h >= 6) return ms;
		return Math.min(ms + (7 - p.h) * 3_600_000 + ((p.mi % 45) - p.mi) * 60_000, this.now - NOT_BEFORE_MINUTES * 60_000);
	}

	date(ms: number): string {
		const p = this.parts(ms);
		return `${MONTHS[p.mo]} ${p.d}, ${p.y}`;
	}

	monthName(ms: number): string {
		return MONTHS_LONG[this.parts(ms).mo];
	}

	short(ms: number): string {
		const p = this.parts(ms);
		return `${WEEKDAYS[p.wd]}, ${MONTHS[p.mo]} ${p.d}`;
	}

	time(ms: number): string {
		const p = this.parts(ms);
		return `${p.h % 12 || 12}:${String(p.mi).padStart(2, "0")} ${p.h < 12 ? "AM" : "PM"}`;
	}

	/** "Tue, Oct 6, 2026 at 9:14 AM", as a reply quotes it. */
	long(ms: number): string {
		const p = this.parts(ms);
		return `${WEEKDAYS[p.wd]}, ${MONTHS[p.mo]} ${p.d}, ${p.y} at ${this.time(ms)}`;
	}

	/** A day after `ms`, at hh:mm local. */
	nextDay(ms: number, days: number, hhmm: string): number {
		const p = this.parts(ms);
		const [h, m] = hhmm.split(":").map(Number);
		return Date.UTC(p.y, p.mo, p.d + days, h, m) + this.tz * 60_000;
	}

	/** `YYYYMMDDTHHMMSSZ`, for calendar files. */
	ics(ms: number): string {
		return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
	}
}

// ── Text and HTML ───────────────────────────────────────────────────

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function inline(text: string): string {
	return esc(text)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
		.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,])/g, '$1<a href="$2">$2</a>');
}

/**
 * Plain mail in a few lines: blank-line paragraphs, `- ` lists, `> ` quotes,
 * `**bold**` and `[text](url)`. Takes the reader's colours, like most mail people write.
 */
export function md(text: string): string {
	return text.trim().split(/\n\s*\n/).map((block) => {
		const lines = block.split("\n");
		if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
		if (lines.every((l) => /^>/.test(l))) return `<blockquote>${md(lines.map((l) => l.replace(/^>\s?/, "")).join("\n"))}</blockquote>`;
		return `<p>${lines.map(inline).join("<br>")}</p>`;
	}).join("");
}

/** The block a mail client puts under a reply: who wrote it, when, and what it said. */
export function quoteBlock(clock: { long(ms: number): string }, parent: { from: Person; at: number; html: string }): string {
	return `<div class="gmail_quote"><p>On ${esc(clock.long(parent.at))}, ${esc(parent.from.name)} &lt;${esc(parent.from.addr)}&gt; wrote:</p><blockquote>${parent.html}</blockquote></div>`;
}

/** A square brand mark as an image, so its letter stays out of list snippets and search. */
function logo(color: string, initial: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="${color}"/><text x="16" y="22.5" font-family="Helvetica,Arial,sans-serif" font-size="17" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(initial)}</text></svg>`;
	return `<img src="data:image/svg+xml;base64,${btoa(svg)}" width="32" height="32" alt="" style="display:block;border-radius:6px">`;
}

/** A designed mail: a white card with a brand bar, as shops, SaaS and newsletters send. */
export function card(opts: { brand: string; color: string; preheader?: string; body: string; footer?: string }): string {
	return `<div style="background:#f3f4f6;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#1f2933">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader)}</div>` : ""}
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:6px"><tr><td style="padding:20px 28px;border-bottom:1px solid #e5e7eb">
<table cellpadding="0" cellspacing="0"><tr><td width="32">${logo(opts.color, opts.brand.trim()[0] ?? "?")}</td><td style="padding-left:10px;font-size:16px;font-weight:700">${esc(opts.brand)}</td></tr></table>
</td></tr><tr><td style="padding:24px 28px;font-size:15px;line-height:1.6">${opts.body}</td></tr>
${opts.footer ? `<tr><td style="padding:16px 28px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280">${opts.footer}</td></tr>` : ""}
</table></div>`;
}

export function button(label: string, href: string, color: string): string {
	return `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${esc(label)}</a></p>`;
}

/** Rows of label and value, for receipts and tickets. `strong` marks a total row. */
export function rows(items: ([string, string] | [string, string, "strong"])[]): string {
	return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;font-size:14px">${items.map(([k, v, s]) =>
		`<tr><td style="padding:6px 0;border-bottom:1px solid #eef0f2;color:#6b7280">${esc(k)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #eef0f2;${s ? "font-weight:700;color:#111827" : ""}">${esc(v)}</td></tr>`).join("")}</table>`;
}

// ── Files people attach ─────────────────────────────────────────────

const text = (s: string) => new TextEncoder().encode(s);

export const file = {
	text: (filename: string, body: string, mimetype = "text/plain"): Attachment => ({ filename, mimetype, bytes: text(body) }),
	csv: (filename: string, table: (string | number)[][]): Attachment => ({
		filename, mimetype: "text/csv",
		bytes: text(table.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(",")).join("\n") + "\n"),
	}),
	pdf: (filename: string, lines: PdfLine[], style?: PdfStyle): Attachment => ({ filename, mimetype: "application/pdf", bytes: makePdf(lines, style) }),
	ics: (filename: string, ev: { uid: string; start: number; end: number; summary: string; location?: string; description?: string; organizer?: Person; attendee?: Person; clock: Clock; method?: "REQUEST" | "PUBLISH" }): Attachment => ({
		filename, mimetype: "text/calendar",
		bytes: text([
			"BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//Sample Calendar//EN", `METHOD:${ev.method ?? "REQUEST"}`,
			"BEGIN:VEVENT", `UID:${ev.uid}@example.com`, `DTSTAMP:${ev.clock.ics(ev.clock.now)}`,
			`DTSTART:${ev.clock.ics(ev.start)}`, `DTEND:${ev.clock.ics(ev.end)}`, `SUMMARY:${ev.summary}`,
			...(ev.location ? [`LOCATION:${ev.location}`] : []),
			...(ev.description ? [`DESCRIPTION:${ev.description}`] : []),
			...(ev.organizer ? [`ORGANIZER;CN=${ev.organizer.name}:mailto:${ev.organizer.addr}`] : []),
			...(ev.attendee ? [`ATTENDEE;CN=${ev.attendee.name};RSVP=TRUE:mailto:${ev.attendee.addr}`] : []),
			"STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR", "",
		].join("\r\n")),
	}),
	svg: (filename: string, title: string, values: number[], color: string): Attachment => {
		const max = Math.max(...values);
		const bars = values.map((v, i) => {
			const h = Math.round((v / max) * 150);
			return `<rect x="${30 + i * 44}" y="${190 - h}" width="32" height="${h}" rx="3" fill="${color}"/>`;
		}).join("");
		return { filename, mimetype: "image/svg+xml", bytes: text(`<svg xmlns="http://www.w3.org/2000/svg" width="${60 + values.length * 44}" height="230" viewBox="0 0 ${60 + values.length * 44} 230"><rect width="100%" height="100%" fill="#ffffff"/><text x="30" y="24" font-family="Helvetica,Arial" font-size="14" fill="#111827">${esc(title)}</text>${bars}<line x1="24" y1="190" x2="${36 + values.length * 44}" y2="190" stroke="#9ca3af"/></svg>`) };
	},
	vcf: (filename: string, p: Person & { org?: string; phone?: string; title?: string }): Attachment => ({
		filename, mimetype: "text/vcard",
		bytes: text(["BEGIN:VCARD", "VERSION:3.0", `FN:${p.name}`, ...(p.org ? [`ORG:${p.org}`] : []), ...(p.title ? [`TITLE:${p.title}`] : []), ...(p.phone ? [`TEL;TYPE=WORK:${p.phone}`] : []), `EMAIL:${p.addr}`, "END:VCARD", ""].join("\r\n")),
	}),
};

export interface PdfLine {
	t: string;
	/** Font size in points. Default 11. */
	size?: number;
	bold?: boolean;
	/** Blank space before the line, in points. */
	gap?: number;
	/** Text colour, #rrggbb. */
	color?: string;
	/** A thin rule across the page instead of text. */
	rule?: boolean;
}

/** A brand's colour on a document: a filled band across the top of each page. */
export interface PdfStyle {
	band?: string;
	/** Colour of rules. */
	rule?: string;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");

const ASCII = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x20-\x7e]/g, "?");

/** A small valid PDF: Helvetica text, top to bottom, new pages as needed. */
export function makePdf(lines: PdfLine[], style: PdfStyle = {}): Uint8Array {
	const band = style.band ? `${rgb(style.band)} rg 0 770 612 22 re f 0 0 0 rg` : "";
	const pages: string[][] = [band ? [band] : []];
	let y = 760;
	for (const line of lines) {
		const size = line.rule ? 4 : line.size ?? 11;
		y -= (line.gap ?? 0) + size * 1.45;
		if (y < 60) { pages.push(band ? [band] : []); y = 760 - size * 1.45; }
		const page = pages[pages.length - 1];
		if (line.rule) page.push(`${rgb(style.rule ?? "#c8ccd0")} RG 0.75 w 56 ${(y + 3).toFixed(1)} m 556 ${(y + 3).toFixed(1)} l S 0 0 0 RG`);
		else page.push(`BT ${line.color ? `${rgb(line.color)} rg ` : ""}/${line.bold ? "F2" : "F1"} ${size} Tf 56 ${y.toFixed(1)} Td (${ASCII(line.t).replace(/[\\()]/g, "\\$&")}) Tj ET${line.color ? " 0 0 0 rg" : ""}`);
	}
	const objects: string[] = [];
	const add = (body: string) => { objects.push(body); };
	add("<< /Type /Catalog /Pages 2 0 R >>");
	add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`);
	add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
	add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
	for (const page of pages) {
		const stream = page.join("\n");
		const pageNo = objects.length + 1;
		add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageNo + 1} 0 R >>`);
		add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	}
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
