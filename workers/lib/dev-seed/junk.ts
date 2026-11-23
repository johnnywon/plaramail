// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: cold pitches and their follow-ups, spam, Trash, drafts and
// mail the owner started.

import { note } from "./automated";
import { CO, type Company, type Ctx, type Turn, at, convo, who } from "./cast";
import { type Msg, type Person, type Role, type When, md, quoteBlock } from "./kit";

interface Pitch {
	co: Company;
	person: string;
	box: Role;
	subject: string;
	ago: When;
	/** The first message and each nudge after it. `gaps[i]` is the days between note i and the next. */
	notes: string[];
	gaps: number[];
	list?: boolean;
}

const PITCHES: Pitch[] = [
	{ co: CO.growthwise, person: "Brandon Lee", box: "hello", subject: "Quick question about your SEO", ago: [3, "09:12"], gaps: [4, 5], notes: [
		"Hi there,\n\nI was looking at your site and noticed a few things that are holding back your search rankings. We helped a dental practice go from page 4 to page 1 in 60 days.\n\nCan I send you a short audit? No cost, no catch.\n\nBrandon Lee\nGrowthwise Agency",
		"Hi, just floating this to the top of your inbox. Happy to send the audit whenever you're ready.\n\nBrandon",
		"Last one from me, I promise. If SEO isn't a priority right now, no worries at all. Should I close your file?\n\nBrandon" ] },
	{ co: CO.leadly, person: "Kayla Torres", box: "hello", subject: "1,200 verified leads for dental and physio practices", ago: [6, "13:40"], gaps: [3], notes: [
		"Hello,\n\nWe maintain a list of 1,200 verified decision-makers at dental and physio practices in your region. It's $0.40 per lead and includes direct emails.\n\nWant a sample of 25 leads?\n\nKayla Torres\nLeadly",
		"Following up on my note. The sample is free. Want it?\n\nKayla" ], list: true },
	{ co: CO.rankrocket, person: "Steve Marlowe", box: "press", subject: "Guest post opportunity", ago: [1, "10:30"], gaps: [], notes: [
		"Hi,\n\nI love your content and would like to contribute a guest post to your blog about booking software trends. I'd link to a couple of my own sites, of course.\n\nLet me know if you're interested.\n\nSteve Marlowe\nRankRocket SEO" ] },
	{ co: CO.talentbridge, person: "Priscilla Ng", box: "hello", subject: "Senior engineers, no placement fee until you hire", ago: [9, "08:55"], gaps: [6, 7], notes: [
		"Hi Morgan,\n\nWe place senior engineers with small software companies. We only invoice when you hire, and we guarantee the placement for 6 months.\n\nWould it be useful to hear about 3 candidates?\n\nPriscilla Ng\nTalentBridge Recruiting",
		"Hi Morgan, I wanted to share three profiles that match what small booking software companies usually look for. Happy to send them over.\n\nPriscilla",
		"Morgan, checking in one last time. If you're not hiring, would you be open to a referral fee for any engineers you know?\n\nPriscilla" ] },
	{ co: CO.cloudsaver, person: "Everett Cho", box: "hello", subject: "Cut your cloud bill by up to 40%", ago: [12, "15:15"], gaps: [4], notes: [
		"Hi,\n\nTeams using Cobalt Cloud often overspend on idle instances and oversized storage. We analyse your bill and find savings. You pay only a share of what we save.\n\nShall I run a free analysis?\n\nEverett Cho\nCloudSaver",
		"Hi again, we ran a quick public analysis and found 3 likely savings in your setup. Want the report?\n\nEverett" ] },
	{ co: CO.pixelmint, person: "Hana Sato", box: "hello", subject: "I redesigned your homepage (free mockup inside)", ago: [15, "11:00"], gaps: [5], notes: [
		"Hi Morgan,\n\nI took the liberty of making a mockup of what your homepage could look like. It's a cleaner layout with a bigger call to action. No obligation. Reply and I'll send the Figma link.\n\nHana Sato\nPixelmint Design",
		"Just checking if you saw the mockup. I'm happy to walk you through it.\n\nHana" ] },
	{ co: CO.outbound, person: "Wes", box: "hello", subject: "Re: your open sales role", ago: [20, "07:50"], gaps: [3, 6], notes: [
		"Hey,\n\nSaw you might be hiring for sales. Our AI SDR books meetings 24/7 for $499 a month. It writes in your voice, and it never takes a day off.\n\nWorth a 15 min demo?\n\nWes\nOutbound AI",
		"Hey, bumping this. We have a 14 day trial.\n\nWes", "Closing the loop. Should I stop reaching out?\n\nWes" ] },
	{ co: CO.buildnotes, person: "Podcast Booking Co.", box: "press", subject: "Get your founder on 40 podcasts this year", ago: [8, "12:12"], gaps: [], notes: [
		"Hello,\n\nWe pitch founders to podcasts for you. Our clients average 12 interviews in their first 90 days. Plans start at $1,200 a month.\n\nWant to see our recent placements?\n\nThe Booking Team" ], list: true },
];

export function pitches(ctx: Ctx): Msg[] {
	const out: Msg[] = [];
	for (const [n, p] of PITCHES.entries()) {
		const sender = who(p.person, p.co);
		// `ago` is when the newest note arrived; each earlier note came `gaps` days before the next.
		const times = p.notes.map(() => ctx.clock.at(p.ago));
		for (let k = p.notes.length - 2; k >= 0; k--) times[k] = times[k + 1] - p.gaps[k] * 86_400_000;
		const first = `pitch-${n + 1}-1`;
		for (const [k, body] of p.notes.entries()) {
			out.push(note(ctx, {
				key: `pitch-${n + 1}-${k + 1}`, box: p.box, from: sender, at: times[k], thread: first,
				subject: k === 0 ? p.subject : `Re: ${p.subject.replace(/^Re: /, "")}`, html: md(body),
				list: p.list ? { id: `outreach.${p.co.domain}`, unsubscribe: `https://${p.co.domain}/u/${n}` } : undefined,
				read: k < p.notes.length - 1 ? true : undefined, auto: false,
			}));
		}
	}
	return out;
}

const SPAM: { co: Company; name: string; box: Role; subject: string; body: string }[] = [
	{ co: CO.prizedesk, name: "Prize Desk", box: "hello", subject: "Congratulations! You've been selected for a $500 gift card", body: "Dear winner,\n\nYou have been selected to receive a $500 gift card. Claim it within 24 hours: https://prizedesk.example.net/claim/9f2a\n\nThis is a limited offer." },
	{ co: { name: "Mail Admin", domain: "mailadmin-help.example.net", color: "#c8372d" }, name: "Mail Administrator", box: "support", subject: "Your mailbox storage is 98% full", body: "Your mailbox is almost full. To avoid losing messages, verify your account now:\n\nhttps://mailadmin-help.example.net/verify\n\nFailure to verify will lead to suspension." },
	{ co: { name: "Parcel Notice", domain: "parcel-notice.example.org", color: "#d9822b" }, name: "Delivery Service", box: "hello", subject: "Delivery attempt failed: reschedule now", body: "We could not deliver your package. A small fee of $1.99 is required to reschedule: https://parcel-notice.example.org/pay" },
	{ co: { name: "Accounts", domain: "accounts-dept.example.com", color: "#5f6b74" }, name: "A. Walker", box: "billing", subject: "Invoice 8821 overdue: payment required", body: "Hello,\n\nPlease find the attached invoice. Payment is overdue. Kindly remit today to avoid penalties.\n\nA. Walker, Accounts" },
	{ co: { name: "Crypto Alert", domain: "coinquick.example.net", color: "#2d2f31" }, name: "CoinQuick", box: "ops", subject: "Double your balance in 24 hours", body: "Deposit any amount and receive double back. Limited spots. https://coinquick.example.net/join" },
	{ co: { name: "Domain Renewal", domain: "domain-renew.example.org", color: "#2f6db3" }, name: "Domain Registry Services", box: "billing", subject: "Final notice: your domain listing expires", body: "This is not a bill. This is a solicitation for a domain listing. Pay $289 for a 2-year listing at https://domain-renew.example.org/pay" },
	{ co: { name: "Security Team", domain: "secure-verify.example.net", color: "#c8372d" }, name: "Security Team", box: "support", subject: "Unusual activity on your account", body: "We noticed unusual activity. Please confirm your password at https://secure-verify.example.net/confirm within 12 hours." },
	{ co: { name: "Wholesale Lists", domain: "listdepot.example.org", color: "#7a5a3a" }, name: "List Depot", box: "press", subject: "Buy 50,000 business emails for $39", body: "Verified lists by industry. Instant download. https://listdepot.example.org/buy" },
	{ co: { name: "Rewards", domain: "rewards-today.example.com", color: "#b0457f" }, name: "Rewards Center", box: "hello", subject: "Your reward points are about to expire", body: "You have 18,420 points that will expire tonight. Redeem here: https://rewards-today.example.com/redeem" },
	{ co: { name: "Elena", domain: "bizloans.example.net", color: "#4f8a3c" }, name: "Elena Petrova", box: "billing", subject: "Business loan pre-approved, no credit check", body: "You are pre-approved for up to $250,000. Reply YES to receive your terms.\n\nElena Petrova, Senior Funding Specialist" },
];

const TRASH: { co: Company; name: string; box: Role; subject: string; body: string; ago: When }[] = [
	{ co: CO.tasklane, name: "Tasklane", box: "billing", subject: "Your trial of Tasklane Business ends in 3 days", body: "Your 14-day trial ends soon. Add a card to keep your boards.", ago: [40, "09:00"] },
	{ co: CO.huddle, name: "Huddle", box: "hello", subject: "Webinar: Make meetings shorter", body: "Join us for a live session on cutting meeting time in half. Tomorrow at 11 AM.", ago: [33, "08:00"] },
	{ co: CO.gitbranch, name: "Gitbranch", box: "ops", subject: "Gitbranch Universe: save the date", body: "Our annual conference returns this spring. Early-bird tickets are open.", ago: [29, "10:30"] },
	{ co: CO.sendwave, name: "Sendwave Mail", box: "ops", subject: "New: email analytics dashboard", body: "See opens and clicks in one view. Available on all plans.", ago: [25, "14:15"] },
	{ co: CO.cobalt, name: "Cobalt Cloud", box: "ops", subject: "Cobalt Summit recordings are live", body: "Missed a session? All talks are now online.", ago: [22, "09:40"] },
	{ co: { name: "Test", domain: "mail.example.net", color: "#5f6b74" }, name: "Morgan Reyes", box: "hello", subject: "test", body: "test", ago: [21, "16:02"] },
	{ co: CO.fernwood, name: "Fernwood Credit Union", box: "billing", subject: "Switch to paperless statements", body: "Go paperless and help the planet.", ago: [18, "07:00"] },
	{ co: CO.tallowoak, name: "Tallow & Oak", box: "hello", subject: "Autumn sale: 20% off everything", body: "This weekend only. Free shipping over $50.", ago: [14, "08:30"] },
	{ co: CO.meridian, name: "Meridian Air", box: "hello", subject: "Double miles on weekend flights", body: "Book by Friday and earn double miles on any weekend trip.", ago: [10, "12:00"] },
	{ co: CO.keyring, name: "Keyring", box: "ops", subject: "Keyring tips: three habits for safer passwords", body: "Use a long passphrase, never reuse, and turn on two-factor sign-in.", ago: [6, "09:25"] },
];

export function junk(ctx: Ctx): Msg[] {
	const { clock, r } = ctx;
	const out: Msg[] = [];
	for (const [i, s] of SPAM.entries()) {
		out.push(note(ctx, { key: `spam-${i + 1}`, box: s.box, from: { name: s.name, addr: `${s.name.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "")}@${s.co.domain}` }, at: clock.at([Math.floor(i * 2.4) + 1, `${String(r.int(0, 23)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}`]), subject: s.subject, html: md(s.body), folder: "spam", read: i > 2, auto: false }));
	}
	for (const [i, t] of TRASH.entries()) {
		out.push(note(ctx, { key: `trash-${i + 1}`, box: t.box, from: at(t.co, "news", t.name), at: clock.at(t.ago), subject: t.subject, html: md(t.body), folder: "trash", read: true }));
	}
	return out;
}

/** Mail the owner started, and what came back. */
export function started(ctx: Ctx): Msg[] {
	const out: Msg[] = [];
	const bw = who("Grace Nwosu", { name: "Nwosu Family Dental", domain: "nwosudental.example.com", color: "#2f6db3" });
	out.push(...convo(ctx, { id: "testimonial", box: "hello", subject: "Could we quote you on our site?", with: bw, labels: ["Clients"] }, [
		{ me: true, at: [23, "11:20"], body: `Hi Grace,\n\nThe reminders have worked well for your practice (no-shows down from 14% to 9%, if I read your dashboard right). Would you be open to us quoting you on our site, with your practice name and photo?\n\nIf you'd rather not, no problem at all.\n\nMorgan` },
		{ at: { after: 1900 }, body: `Hi Morgan, happy to. Here's a quote you can use: "We stopped chasing patients on the phone. Reminders do it for us, and the front desk finally has time for the people in the room." Photo attached to a later email, I need to find a good one.\n\nGrace` },
		{ me: true, at: { after: 45 }, body: `This is perfect. Thank you, Grace. Send the photo whenever.` },
	]));
	const tasklane = at(CO.tasklane, "support", "Tasklane Support");
	out.push(...convo(ctx, { id: "tasklane-refund", box: "billing", subject: "Refund for unused seats", with: tasklane, labels: ["Billing"], where: "archive" }, [
		{ me: true, at: [36, "10:05"], body: `Hello,\n\nWe reduced our team from 6 to 4 on the 2nd but were billed for 6 seats this month. Can you refund the difference of ${"$24.00"}?\n\nThanks,\nMorgan Reyes, Example Co` },
		{ at: { after: 380 }, body: `Hi Morgan,\n\nThanks for reaching out. I can see the seat change was made after your billing date, so the 6-seat charge was correct. As a courtesy, I've refunded $12.00 (half the difference). Your next invoice will bill 4 seats.\n\nBest,\nDiana\nTasklane Support` },
		{ me: true, at: { after: 40 }, body: `Thanks, that's fair. Appreciated.` },
	]));
	out.push(...convo(ctx, { id: "okafor-question", box: "billing", subject: "Home office deduction: what do you need from me?", with: who("Linda Okafor", CO.okafor), labels: ["Billing"], where: "archive" }, [
		{ me: true, at: [47, "09:30"], body: `Hi Linda, I work from a room in my apartment about 4 days a week. Can I claim a home office deduction, and what do you need from me for it?\n\nMorgan` },
		{ at: { after: 600 }, body: `Hi Morgan,\n\nYes, if the room is used regularly and exclusively for the business. I'll need:\n\n- The square footage of the room and of the whole apartment\n- Annual rent or mortgage interest, and utilities\n- A photo of the space, for your records\n\nThe simplified method ($5 per sq ft, up to 300 sq ft) is easiest; I'll compare it with the actual-expense method and take the better one.\n\nLinda` },
		{ me: true, at: { after: 90 }, body: `Thanks. I'll send the numbers this week.` },
	]));
	return out;
}

/** Half-written mail waiting in Drafts. `all` is every other message, for the ones that answer something. */
export function drafts(ctx: Ctx, all: Msg[]): Msg[] {
	const { clock } = ctx;
	const byKey = new Map(all.map((m) => [m.key, m]));
	const reply = (key: string, parentKey: string, body: string, ago: When): Msg => {
		const parent = byKey.get(parentKey);
		if (!parent) throw new Error(`dev seed: draft ${key} answers ${parentKey}, which doesn't exist`);
		return {
			key, box: parent.box, folder: "draft", at: clock.at(ago), from: ctx.me[parent.box], to: [parent.from],
			subject: parent.subject.startsWith("Re: ") ? parent.subject : `Re: ${parent.subject}`,
			html: md(body) + quoteBlock(clock, parent), read: true, thread: parent.thread, replyTo: parent.key,
		};
	};
	const fresh = (key: string, box: Role, to: Person, subject: string, body: string, ago: When): Msg => ({
		key, box, folder: "draft", at: clock.at(ago), from: ctx.me[box], to: [to], subject, html: md(body), read: true, thread: key,
	});
	return [
		reply("draft-orbit", "orbit-5", "Hi Dev,\n\nGlad the sandbox worked for the owners. Here's the annual quote for 12 locations:\n\n- Business plan, 5 locations\n- 7 extra locations\n- 20% yearly discount\n\n[attach quote PDF]\n\nOne thing to confirm before I send it:", [0, "08:10"]),
		reply("draft-larkspur", "larkspur-5", "Mira,\n\nThanks for the outline. Two edits:\n\n- Lead with the no-show numbers, then the story.\n- Cut the paragraph about", 95),
		reply("draft-intro", "intro-3", "Hi Dana,\n\nTuesday at 9:30 works for me. I'll send an invite with a video link.\n\nIf you can, send me a screenshot of how a rescheduled", [1, "19:40"]),
		fresh("draft-legal", "legal", who("Anneliese Pierce", CO.harlan), "Question about the trademark watch note", "Anneliese,\n\nBefore you draft the opposition note, can you tell me roughly what an opposition would cost if they", [1, "14:05"]),
		fresh("draft-jo", "billing", who("Jo Whitfield", CO.whitfield), "Next quarter's budget for contractor hours", "Jo,\n\nI'm planning next quarter. I'd like to keep hours at about 40 a week through December and then", [2, "16:30"]),
	];
}
