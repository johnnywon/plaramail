// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: the whole sample inbox as plain data. Nothing here touches
// storage, so tests can build it and check it (index.ts writes it).

import type { AttachmentInput, EmailInput } from "../../store/d1/rows";
import { bank, calendar, engineering, payments, receipts, security, shopping, travel } from "./automated";
import { CO, type Ctx, FROM_NAMES, at } from "./cast";
import { helloAndBilling } from "./conversations-a";
import { legalOpsPress } from "./conversations-b";
import { nonsenseThreads, peopleThreads } from "./conversations-c";
import { drafts, junk, pitches, started } from "./junk";
import { type Box, type LabelSpec, type Msg, type Person, ROLES, type Role, Clock, md, rng } from "./kit";
import { newsletters } from "./newsletters";
import { shoppingThreads } from "./shopping";
import { supportThreads } from "./support";

/** Bump when the sample data changes shape. Older sample mail is replaced the next time the server starts. */
export const SEED_VERSION = 1;
export const ID_PREFIX = `seed-mail-v${SEED_VERSION}-`;
/** The message that arrived a moment ago (workers/lib/dev-seed/automated.ts). */
const NEWEST_KEY = "signin-1";
export { NEWEST_MINUTES } from "./kit";

export const LABELS: LabelSpec[] = [
	{ name: "Receipts", color: "#4f8a3c" },
	{ name: "Billing", color: "#d9822b" },
	{ name: "Clients", color: "#2f6db3" },
	{ name: "Travel", color: "#2e8b84" },
	{ name: "Dev", color: "#5b4fb0" },
	{ name: "Legal", color: "#2d2f31" },
	{ name: "Press", color: "#b0457f" },
	{ name: "Newsletters", color: "#7a5a3a" },
	{ name: "Follow up", color: "#c8372d" },
	{ name: "Personal", color: "#5f6b74" },
	{ name: "Family", color: "#c8372d" },
	{ name: "Shopping", color: "#e2c044" },
];

export const SEARCHES: { name: string; query: string }[] = [
	{ name: "Unread with files", query: "is:unread has:attachment" },
	{ name: "Client mail", query: "label:clients" },
	{ name: "Needs follow-up", query: 'label:"follow up"' },
];

/** Which configured address plays each part: the one named for it, else one by position. */
export function resolveAddresses(configured: string[]): Record<Role, string> {
	const list = configured.map((a) => a.toLowerCase());
	const out = {} as Record<Role, string>;
	for (const [i, role] of ROLES.entries()) {
		out[role] = list.find((a) => a.split("@")[0] === role) ?? list[i % Math.max(list.length, 1)] ?? `${role}@example.com`;
	}
	return out;
}

export interface Inbox {
	messages: Msg[];
	/** The address that plays each part. */
	addresses: Partial<Record<Box, string>>;
}

export interface BuildOptions {
	now: number;
	/** Date.getTimezoneOffset() of the developer's machine: the sample mail arrives in their working hours. */
	tzOffset: number;
	addresses: Record<Role, string>;
	/** Plain extra messages, for testing long lists. */
	extra?: number;
}

export function buildInbox(opts: BuildOptions): Inbox {
	const me = Object.fromEntries(ROLES.map((role) => [role, { name: FROM_NAMES[role], addr: opts.addresses[role] }])) as Record<Role, Person>;
	const ctx: Ctx = { clock: new Clock(opts.now, opts.tzOffset), r: rng(20261013), me };

	const messages: Msg[] = [
		...helloAndBilling(ctx), ...legalOpsPress(ctx), ...supportThreads(ctx), ...started(ctx),
		...peopleThreads(ctx), ...nonsenseThreads(ctx), ...shoppingThreads(ctx),
		...receipts(ctx), ...payments(ctx), ...bank(ctx), ...engineering(ctx), ...security(ctx), ...shopping(ctx), ...travel(ctx), ...calendar(ctx),
		...newsletters(ctx), ...pitches(ctx), ...junk(ctx),
	];
	messages.push(...drafts(ctx, messages));
	if (opts.extra) messages.push(...filler(ctx, opts.extra));

	// Replies are placed after what they answer, which can run past the clock for something that just arrived.
	for (const m of messages) if (m.key !== NEWEST_KEY) m.at = Math.min(m.at, ctx.clock.at(0));
	messages.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
	return { messages, addresses: opts.addresses };
}

const FILLER_SUBJECTS = ["Quick question", "Following up", "Updated numbers", "Notes from our call", "Re: schedule", "FYI", "Photos from last week", "Draft attached", "Thanks!", "Can you take a look?", "Reminder", "Update"];
const FILLER_LINES = ["Wanted to follow up on what we discussed.", "Let me know if Thursday still works.", "I've attached the latest version.", "Sorry for the delay, it was a busy week.", "No rush on this, whenever you get a chance."];

function filler(ctx: Ctx, n: number): Msg[] {
	const companies = Object.values(CO);
	return Array.from({ length: n }, (_, i): Msg => {
		const company = ctx.r.pick(companies);
		const box = ctx.r.pick(ROLES);
		const mine = ctx.r.chance(0.12);
		const person = at(company, ctx.r.pick(["ann", "lee", "sam", "kim", "raj", "eva", "tom", "joy"]), undefined);
		const folder = mine ? "sent" : ctx.r.chance(0.7) ? "inbox" : ctx.r.chance(0.85) ? "archive" : "trash";
		return {
			key: `filler-${i + 1}`, box, folder, at: ctx.clock.now - Math.floor(ctx.r.next() * 120 * 86_400_000) - 3_600_000,
			from: mine ? ctx.me[box] : person, to: [mine ? person : ctx.me[box]], subject: `${ctx.r.pick(FILLER_SUBJECTS)} ${i + 1}`,
			html: md(`${ctx.r.pick(FILLER_LINES)}\n\n${ctx.r.pick(FILLER_LINES)}`), read: mine || ctx.r.chance(0.85), thread: `filler-${i + 1}`,
		};
	});
}

// ── As stored ───────────────────────────────────────────────────────

export interface Stored {
	msg: Msg;
	id: string;
	email: EmailInput;
	attachments: (AttachmentInput & { bytes: Uint8Array })[];
}

/** The address a message is stored under. A profile names every box it writes to. */
export function addressOf(inbox: Inbox, m: Msg): string {
	const addr = inbox.addresses[m.box];
	if (!addr) throw new Error(`no address for the ${m.box} mailbox (${m.key})`);
	return addr;
}

const rfc = (m: Msg) => `<${m.key}@${m.from.addr.split("@")[1]}>`;
const named = (p: Person) => `"${p.name.replace(/"/g, "")}" <${p.addr}>`;

/** One message in the shape the store takes: ids, RFC threading and the headers a real delivery would carry. */
export function toStored(inbox: Inbox, prefix = ID_PREFIX): Stored[] {
	const byKey = new Map(inbox.messages.map((m) => [m.key, m]));
	const ancestors = (m: Msg): Msg[] => {
		const chain: Msg[] = [];
		for (let p = m.replyTo ? byKey.get(m.replyTo) : undefined; p; p = p.replyTo ? byKey.get(p.replyTo) : undefined) chain.unshift(p);
		return chain;
	};
	return inbox.messages.map((m) => {
		const id = prefix + m.key;
		const mx = addressOf(inbox, m).split("@")[1];
		const refs = ancestors(m).map((p) => rfc(p));
		const mine = m.folder === "sent" || m.folder === "draft";
		const headers: { key: string; value: string }[] = [
			{ key: "from", value: named(m.from) },
			{ key: "to", value: m.to.map(named).join(", ") },
			...(m.cc?.length ? [{ key: "cc", value: m.cc.map(named).join(", ") }] : []),
			{ key: "subject", value: m.subject },
			{ key: "date", value: new Date(m.at).toUTCString() },
			{ key: "message-id", value: rfc(m) },
			...(m.replyTo ? [{ key: "in-reply-to", value: refs[refs.length - 1] }, { key: "references", value: refs.join(" ") }] : []),
			...(mine ? [] : [
				{ key: "return-path", value: `<${m.auto ? "bounces" : m.from.addr.split("@")[0]}@${m.from.addr.split("@")[1]}>` },
				{ key: "received", value: `from mail.${m.from.addr.split("@")[1]} (mail.${m.from.addr.split("@")[1]} [203.0.113.${(m.key.length * 7) % 200 + 10}]) by mx.${mx} with ESMTPS; ${new Date(m.at + 1500).toUTCString()}` },
				{ key: "authentication-results", value: `mx.${mx}; dkim=${m.folder === "spam" ? "none" : "pass"} header.d=${m.from.addr.split("@")[1]}; spf=${m.folder === "spam" ? "fail" : "pass"}; dmarc=${m.folder === "spam" ? "fail" : "pass"}` },
			]),
			...(m.auto && !mine ? [{ key: "auto-submitted", value: "auto-generated" }] : []),
			...(m.list ? [
				{ key: "list-id", value: `<${m.list.id}>` },
				{ key: "list-unsubscribe", value: `<${m.list.unsubscribe}>, <mailto:unsubscribe@${m.from.addr.split("@")[1]}>` },
				...(m.list.oneClick ? [{ key: "list-unsubscribe-post", value: "List-Unsubscribe=One-Click" }] : []),
				{ key: "precedence", value: "bulk" },
			] : []),
		];
		const parent = m.replyTo ? byKey.get(m.replyTo) : undefined;
		return {
			msg: m, id,
			email: {
				id, subject: m.subject, sender: m.from.addr, recipient: m.to.map((p) => p.addr).join(", "), cc: m.cc?.map((p) => p.addr).join(", ") ?? null,
				date: new Date(m.at).toISOString(), body: m.html, read: m.read, starred: !!m.starred,
				// A reply draft names its parent by stored id, as drafts the app saves do: it groups with that conversation and sends as its reply.
				in_reply_to: parent ? (m.folder === "draft" ? prefix + parent.key : rfc(parent)) : null, email_references: refs.length ? JSON.stringify(refs) : null,
				thread_id: prefix + m.thread, message_id: rfc(m), raw_headers: JSON.stringify(headers),
			},
			attachments: (m.attachments ?? []).map((a, i) => ({
				id: `${id}-a${i + 1}`, email_id: id, filename: a.filename, mimetype: a.mimetype, size: a.bytes.length, content_id: a.contentId ? `<${a.contentId}>` : null, disposition: a.contentId ? "inline" : "attachment", bytes: a.bytes,
			})),
		};
	}).sort((a, b) => a.email.date.localeCompare(b.email.date));
}