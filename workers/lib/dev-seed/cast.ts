// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: the made-up companies and people in the sample inbox. Every
// domain is under example.com, example.org or example.net, which are reserved
// for documentation. None of these is a real business.

import { type Attachment, type Clock, type Msg, type Person, type Rng, type Role, type When, md, quoteBlock } from "./kit";

export interface Company {
	name: string;
	domain: string;
	color: string;
}

const co = (name: string, slug: string, tld: "com" | "org" | "net", color: string): Company => ({ name, domain: `${slug}.example.${tld}`, color });

export const CO = {
	// Tools the business runs on
	cobalt: co("Cobalt Cloud", "cobalt", "com", "#2f6db3"),
	gitbranch: co("Gitbranch", "gitbranch", "net", "#2d2f31"),
	pipewright: co("Pipewright CI", "pipewright", "org", "#5b4fb0"),
	lumen: co("Lumen Logs", "lumen", "net", "#d9822b"),
	tessera: co("Tessera Database", "tessera", "com", "#2e8b84"),
	sendwave: co("Sendwave Mail", "sendwave", "org", "#b0457f"),
	beacon: co("Beacon Status", "beacon", "net", "#4f8a3c"),
	domaindock: co("DomainDock", "domaindock", "com", "#7a5a3a"),
	keyring: co("Keyring", "keyring", "org", "#c8372d"),
	tasklane: co("Tasklane", "tasklane", "com", "#5b4fb0"),
	marginalia: co("Marginalia", "marginalia", "org", "#7a5a3a"),
	slotbook: co("Slotbook", "slotbook", "net", "#2f6db3"),
	threadline: co("Threadline", "threadline", "com", "#b0457f"),
	huddle: co("Huddle Video", "huddle", "net", "#2e8b84"),
	// Money
	ledgerly: co("Ledgerly", "ledgerly", "com", "#2e8b84"),
	fernwood: co("Fernwood Credit Union", "fernwood", "org", "#4f8a3c"),
	remit: co("Remit Payments", "remit", "net", "#2f6db3"),
	tallyho: co("Tallyho Payroll", "tallyho", "com", "#d9822b"),
	// Travel and shopping
	meridian: co("Meridian Air", "meridian", "com", "#2f6db3"),
	sojourn: co("Sojourn Hotels", "sojourn", "org", "#7a5a3a"),
	northline: co("Northline Rail", "northline", "net", "#c8372d"),
	parcelhop: co("Parcelhop", "parcelhop", "net", "#d9822b"),
	tallowoak: co("Tallow & Oak", "tallowoak", "com", "#7a5a3a"),
	kettle: co("Kettle & Co", "kettle", "org", "#c8372d"),
	// Newsletters
	devdrift: co("Dev Drift", "devdrift", "org", "#5b4fb0"),
	weeklyledger: co("The Weekly Ledger", "weeklyledger", "com", "#4f8a3c"),
	fieldnotes: co("Field Notes Quarterly", "fieldnotes", "net", "#b0457f"),
	fairway: co("The Fairway Report", "fairway", "org", "#4f8a3c"),
	indiefounders: co("Indie Founders Digest", "indiefounders", "com", "#d9822b"),
	// Advisers and media
	harlan: co("Harlan & Pierce LLP", "harlanpierce", "com", "#2d2f31"),
	brightside: co("Brightside Insurance", "brightside", "org", "#d9822b"),
	okafor: co("Okafor & Lind CPAs", "okaforlind", "net", "#2e8b84"),
	dailycircuit: co("The Daily Circuit", "dailycircuit", "com", "#c8372d"),
	buildnotes: co("Build Notes Podcast", "buildnotes", "org", "#5b4fb0"),
	northernlights: co("Northern Lights Conf", "northernlights", "net", "#2f6db3"),
	// Customers and contacts
	larkspur: co("Larkspur Studio", "larkspur", "org", "#b0457f"),
	hollowpines: co("Hollow Pines Golf Club", "hollowpines", "com", "#4f8a3c"),
	brightwater: co("Brightwater Dental", "brightwater", "net", "#2f6db3"),
	orbit: co("Orbit Bikes", "orbitbikes", "com", "#d9822b"),
	quill: co("Quill & Ink Bookshop", "quillink", "org", "#7a5a3a"),
	marlow: co("Marlow Logistics", "marlow", "net", "#5f6b74"),
	pinecone: co("Pinecone Preschool", "pinecone", "org", "#4f8a3c"),
	atlas: co("Atlas Surveying", "atlas", "com", "#2d2f31"),
	copperline: co("Copperline Coffee", "copperline", "net", "#7a5a3a"),
	juniper: co("Juniper Health", "juniper", "com", "#2e8b84"),
	redwood: co("Redwood Realty", "redwood", "org", "#c8372d"),
	tidepool: co("Tidepool Labs", "tidepool", "net", "#2f6db3"),
	whitfield: co("Whitfield Dev", "whitfield", "org", "#2f6db3"),
	orchard: co("Orchard Media", "orchardmedia", "org", "#d9822b"),
	sbawards: co("Small Business Tech Awards", "sbtawards", "net", "#b0457f"),
	// Shopping, networking, the building
	wren: co("Wren Outfitters", "wren", "com", "#4f8a3c"),
	halcyonhome: co("Halcyon Home", "halcyonhome", "org", "#7a5a3a"),
	pinepixel: co("Pine & Pixel", "pinepixel", "net", "#2f6db3"),
	dogear: co("Dog-Ear Books", "dogear", "org", "#c8372d"),
	fable: co("Fable Footwear", "fable", "net", "#2d2f31"),
	bloom: co("Bloom Market", "bloom", "com", "#b0457f"),
	linkwise: co("Linkwise", "linkwise", "com", "#2f6db3"),
	maplecourt: co("Maple Court Residents", "maplecourt", "org", "#5f6b74"),
	// Sales pitches
	growthwise: co("Growthwise Agency", "growthwise", "net", "#d9822b"),
	leadly: co("Leadly", "leadly", "com", "#5b4fb0"),
	rankrocket: co("RankRocket SEO", "rankrocket", "org", "#c8372d"),
	talentbridge: co("TalentBridge Recruiting", "talentbridge", "com", "#2f6db3"),
	cloudsaver: co("CloudSaver", "cloudsaver", "net", "#2e8b84"),
	pixelmint: co("Pixelmint Design", "pixelmint", "org", "#b0457f"),
	outbound: co("Outbound AI", "outboundai", "com", "#2d2f31"),
	// Junk
	prizedesk: co("Prize Desk", "prizedesk", "net", "#c8372d"),
} satisfies Record<string, Company>;

/** A sender at a company: `noreply@billing.cobalt.example.com`, or a name and a local part. */
export const at = (company: Company, local: string, name?: string): Person => ({ name: name ?? company.name, addr: `${local}@${company.domain}` });

/** Someone who works somewhere: `Mira Castellan` at Larkspur is mira.castellan@larkspur.example.org. */
export const who = (name: string, company: Company): Person => ({ name, addr: `${name.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, ".")}@${company.domain}` });

// The mailbox owner. One name, a sign-off that fits each address.
export const OWNER = "Morgan Reyes";
export const COMPANY = "Example Co";

export const FROM_NAMES: Record<Role, string> = {
	hello: OWNER,
	billing: `${COMPANY} Billing`,
	support: `${OWNER} at ${COMPANY}`,
	legal: OWNER,
	ops: `${COMPANY} Ops`,
	press: OWNER,
};

// ── Conversations ───────────────────────────────────────────────────

export interface Ctx {
	clock: Clock;
	r: Rng;
	me: Record<Role, Person>;
}

export interface Turn {
	/** From the mailbox owner. Otherwise from `with`. */
	me?: boolean;
	/** Someone else in the thread, instead of `with`. */
	from?: Person;
	/** Who it goes to, instead of `with`. */
	to?: Person[];
	/** The first turn: a time. After that: minutes after the turn before. */
	at: When | { after: number };
	body: string;
	attach?: Attachment[];
	cc?: Person[];
	/** Quote the turn before under the reply. On by default after the first turn. */
	quote?: boolean;
	starred?: boolean;
}

export interface Convo {
	id: string;
	box: Role;
	subject: string;
	with: Person;
	labels?: string[];
	starred?: boolean;
	/** Their mail sits in Archive, or Trash, or Spam. */
	where?: "archive" | "trash" | "spam";
	/** The newest message from them is still unread. */
	unread?: boolean;
	/** The newest turn is a draft the owner hasn't sent. */
	draft?: boolean;
}

/** A conversation, as stored: their mail in the inbox (or where it was filed), the owner's replies in Sent. */
export function convo(ctx: Ctx, spec: Convo, turns: Turn[]): Msg[] {
	const out: Msg[] = [];
	const lastTheirs = turns.map((t) => !t.me).lastIndexOf(true);
	for (const [i, turn] of turns.entries()) {
		const prev = out[i - 1];
		const t = turn.at;
		const raw = typeof t === "object" && !Array.isArray(t) ? prev.at + t.after * 60_000 : ctx.clock.at(t);
		// People write in waking hours. A time given as minutes ago is what it is.
		const when = typeof t === "number" ? raw : ctx.clock.awake(raw);
		const mine = !!turn.me;
		const asDraft = !!spec.draft && i === turns.length - 1 && mine;
		const html = md(turn.body) + (i > 0 && turn.quote !== false ? quoteBlock(ctx.clock, prev) : "");
		out.push({
			key: `${spec.id}-${i + 1}`,
			box: spec.box,
			folder: asDraft ? "draft" : mine ? "sent" : spec.where ?? "inbox",
			at: when,
			from: mine ? ctx.me[spec.box] : turn.from ?? spec.with,
			to: turn.to ?? [mine ? spec.with : ctx.me[spec.box]],
			cc: turn.cc,
			subject: i === 0 ? spec.subject : `Re: ${spec.subject.replace(/^(re|fwd?): /i, "")}`,
			html,
			read: mine || !(spec.unread && i === lastTheirs),
			starred: turn.starred ?? (spec.starred && i === 0),
			labels: spec.labels,
			attachments: turn.attach,
			thread: `${spec.id}-1`,
			replyTo: i > 0 ? prev.key : undefined,
		});
	}
	return out;
}
