// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// The rest of Alex's life: family, rent, the bank, the agency client's
// kickoff, two more league emails, The Late Commits (Alex plays bass and
// books the shows, booking@latecommits.band) and Riverbend Code Club (Alex is
// its volunteer treasurer, alex@riverbendcode.org).

import { button as plainButton, card, esc, file, money, rows as plainRows } from "../kit";
import { SIGNERS, button, mail, para, rows } from "./brands";
import { P, alex, box } from "./cast";
import type { StoryClock } from "./clock";
import { human, prose } from "./html";
import type { Slot } from "./slots";

export const RENT = 1850;
export const STUDIO = { hours: 3, rate: 45, deposit: 40 };
export const SHIRTS = { count: 36, each: 11.5, setup: 35 };
export const GIG = { guarantee: 300, doorSplit: 70, doorAfter: 400 };
export const LAPTOPS = { count: 12, each: 95 };
/** The code club's books for the treasurer report: money in, money out, money promised. */
export const CLUB_BOOKS = { grant: 2500, donations: 350, snacks: 85.4 };

const cents = (n: number) => Math.round(n * 100);
export const studioTotal = () => STUDIO.hours * STUDIO.rate;
export const shirtTotal = () => (cents(SHIRTS.count * SHIRTS.each) + cents(SHIRTS.setup)) / 100;
export const laptopTotal = () => LAPTOPS.count * LAPTOPS.each;
export const clubBalance = () => (cents(CLUB_BOOKS.grant) + cents(CLUB_BOOKS.donations) - cents(CLUB_BOOKS.snacks)) / 100;
export const clubAfterLaptops = () => (cents(clubBalance()) - cents(laptopTotal())) / 100;

function personal(c: StoryClock): Slot[] {
	return [
		{
			key: "A-09", box: "personal", folder: "archive", at: "2026-09-26T18:05", from: P.elena, to: [box("personal")],
			subject: "Sunday dinner?", read: true, labels: ["Family"], thread: "A-09",
			html: prose(`Hi sweetheart,

Are you coming for dinner tomorrow? I'm making the green chile stew. Your father wants to know if your band is playing anywhere he can drive to, and whether he needs earplugs.

Also, you haven't called since your birthday. I'm only saying.

Love,
Mom`),
		},
		{
			key: "A-10", box: "personal", folder: "sent", at: "2026-09-26T20:40", from: alex("personal"), to: [P.elena],
			subject: "Re: Sunday dinner?", read: true, labels: ["Family"], thread: "A-09", replyTo: "A-09",
			quote: "Your father wants to know if your band is playing anywhere he can drive to, and whether he needs earplugs.",
			html: prose(`Hi Mom,

I can't do tomorrow, I'm behind on work before a customer pilot starts. Next Sunday, ${esc(c.day("2026-10-04"))}? Save me some stew.

We're playing The Foundry Room on Saturday, ${esc(c.day("2026-10-17"))}. Doors at 8, we're on at 9:30. Tell Dad yes to the earplugs, and I'll put you both on the guest list.

I'll call this week. Promise.

Alex`),
		},
		{
			key: "A-11", box: "personal", folder: "archive", at: "2026-10-01T07:02", from: P.linden, to: [box("personal")],
			subject: `Rent payment received for ${c.month("2026-10-01T07:02").name}`, read: true, labels: ["Receipts"], thread: "A-11", auto: true,
			html: card({
				brand: "Linden Court Residences", color: "#4f6d5a", preheader: `We received your ${c.month("2026-10-01T07:02").name} rent: ${money(RENT)}.`,
				body: `<h2 style="margin:0 0 8px;font-size:20px">Payment received</h2>${plainRows([["Unit", "4B"], ["Due", c.date("2026-10-01")], ["Paid", c.date("2026-10-01")], ["Method", "Bank transfer"], ["Amount", money(RENT), "strong"]])}<p>Thank you. Your next payment is due on ${esc(c.date(c.monthLater("2026-10-01")))}.</p>${plainButton("View your ledger", "https://lindencourt.net/residents/ledger", "#4f6d5a")}`,
				footer: "Linden Court Residences · Resident payments",
			}),
		},
		{
			key: "A-12", box: "personal", folder: "archive", at: "2026-10-03T09:15", from: P.fernhill, to: [box("personal")],
			subject: `Your ${c.month("2026-10-03T09:15", 1).name} statement is ready`, read: true, thread: "A-12", auto: true,
			html: card({
				brand: "Fernhill Credit Union", color: "#2f5d8a", preheader: "Your statement for checking ending 2290 is ready to view.",
				body: `<h2 style="margin:0 0 8px;font-size:20px">Your statement is ready</h2><p>Your ${c.month("2026-10-03T09:15", 1).name} statement for checking ending 2290 is ready in online banking.</p>${plainButton("Sign in to view", "https://fernhillcu.org/statements", "#2f5d8a")}<p style="font-size:13px;color:#6b7280">We never ask for your password or codes by email.</p>`,
				footer: "Fernhill Credit Union · Member statements",
			}),
		},
		{
			key: "A-13", box: "personal", folder: "archive", at: "2026-09-29T09:40", from: P.mara, to: [box("personal")],
			subject: "Migration plan for the Westhaven site", read: true, labels: ["Clients"], thread: "A-13",
			attachments: [file.pdf("westhaven-migration-plan.pdf", [
				{ t: "Westhaven Studio", size: 20, bold: true, color: "#2447E8" },
				{ t: "Website migration plan", size: 14, gap: 4 },
				{ t: `${c.date("2026-09-29")}`, gap: 4 },
				{ t: "", rule: true, gap: 10 },
				{ t: "Milestones", size: 13, bold: true, gap: 8 },
				{ t: `1. Inventory and redirect list: ${c.day("2026-10-02")}`, gap: 4 },
				{ t: `2. Staging site with migrated content: ${c.day("2026-10-07")}` },
				{ t: `3. Review with Westhaven: ${c.day("2026-10-09")}` },
				{ t: `4. Content freeze: ${c.day("2026-10-16")}` },
				{ t: `5. Launch: ${c.day("2026-10-21")}` },
				{ t: "Owners", size: 13, bold: true, gap: 12 },
				{ t: "Westhaven: Mara Lewis (content, sign-off). Alex Rivera: migration, redirects, hosting.", gap: 4 },
			], { band: "#2447E8", rule: "#E9E8F8" })],
			html: human(`Hi Alex,

Here's the plan we talked through on Friday, with the five milestones and who owns what. The one date we can't move is the content freeze on the ${c.nth("2026-10-16")}; our fall campaign goes out the week after.

Can you check the staging date? You said the ${c.nth("2026-10-07")} was tight.

Mara`, SIGNERS.mara),
		},
		{
			key: "A-14", box: "personal", folder: "sent", at: "2026-09-29T11:55", from: alex("personal"), to: [P.mara],
			subject: "Re: Migration plan for the Westhaven site", read: true, labels: ["Clients"], thread: "A-13", replyTo: "A-13",
			quote: `Can you check the staging date? You said the ${c.nth("2026-10-07")} was tight.`,
			html: prose(`Hi Mara,

The plan looks right. I'll send you the redirect list on Thursday. The ${c.nth("2026-10-07")} works for staging if you can sign it off by the ${c.nth("2026-10-02")}; if that slips, staging slips by the same number of days, and the review with it.

Alex`),
		},
	];
}

function league(c: StoryClock): Slot[] {
	return [
		{
			key: "L-07", box: "league", folder: "archive", at: "2026-09-28T09:12", from: P.nia, to: [box("league"), P.sam],
			subject: "Red Zone Requests would like a word", read: true, labels: ["Fantasy"], thread: "L-07",
			html: prose(`Morning, league.

123.4. The highest score of round 1. I'd like it entered into the record.

Sam, 118 is a respectable number and you should be proud of it. It was just not 123.4.

Nia`),
		},
		{
			key: "L-08", box: "league", folder: "inbox", at: "2026-10-07T19:30", from: P.sam, to: [box("league")],
			subject: "Waiver claim: who took my kicker", read: true, labels: ["Fantasy"], thread: "L-08",
			html: prose(`Alex,

Last night's waivers gave you the kicker I had queued. You started a kicker on his bye week on Sunday. You don't get to have nice things.

I'll trade you a backup running back for him. Think about it before Thursday's lock.

Sam`),
		},
	];
}

function band(c: StoryClock): Slot[] {
	const gig = c.day("2026-10-17");
	const kai = { name: "Kai Brennan", title: "Drums", org: "The Late Commits", mark: "late-commits" as const };
	return [
		{
			key: "BAND-01", box: "band", folder: "inbox", at: "2026-09-23T14:20", from: P.dana, to: [box("band")],
			subject: `Hold for Saturday, ${gig}`, read: true, starred: true, labels: ["Band"], thread: "BAND-01",
			html: human(`Hi Late Commits,

I caught your set at the Brick Room open night and I'd like you to open for Pale Signal at The Foundry Room on Saturday, ${esc(gig)}. Thirty-five minutes, doors at 8, you'd be on at 9:30.

I'm holding the date until Friday. Let me know if you want it.

Dana Ruiz
Booking, The Foundry Room`),
		},
		{
			key: "BAND-02", box: "band", folder: "sent", at: "2026-09-23T17:05", from: alex("band"), to: [P.dana],
			subject: `Re: Hold for Saturday, ${gig}`, read: true, labels: ["Band"], thread: "BAND-01", replyTo: "BAND-01",
			quote: "I'm holding the date until Friday. Let me know if you want it.",
			html: human(`Hi Dana,

Yes, we'd love to. Thank you.

Two questions. What time is load-in, and what are the terms for the opener? We're four, with our own drums and amps.

Alex`, SIGNERS.alexBand),
		},
		{
			key: "BAND-03", box: "band", folder: "archive", at: "2026-09-24T10:12", from: P.dana, to: [alex("band")],
			subject: `Re: Hold for Saturday, ${gig}`, read: true, labels: ["Band"], thread: "BAND-01", replyTo: "BAND-02",
			quote: "What time is load-in, and what are the terms for the opener?",
			html: human(`Great, you're confirmed.

Load-in is 6 pm through the side door on Fulton, soundcheck 6:30. Terms: a ${money(GIG.guarantee)} guarantee, or ${GIG.doorSplit}% of the door after the first ${money(GIG.doorAfter)}, whichever is more. Four guest-list spots.

I'll send the advance sheet the week of the show.

Dana`),
		},
		{
			key: "BAND-04", box: "band", folder: "inbox", at: "2026-09-30T21:15", from: P.kai, to: [box("band")],
			subject: "Setlist v2 + rehearsal Saturday", read: true, labels: ["Band"], thread: "BAND-04",
			attachments: [file.text("setlist-v2.txt", `THE LATE COMMITS - The Foundry Room - ${c.date("2026-10-17")}
Opening for Pale Signal. 35 minutes.

1. Merge Window          3:40
2. Night Build           4:10
3. Cold Cache            3:55
4. Off by One            2:50
5. Retry Storm           4:30
6. Detached Head         4:05
7. Last Known Good       5:20

Total                   28:30, plus tuning and talking
`)],
			html: human(`Setlist v2 attached. I moved Retry Storm to fifth so we don't start too fast, and cut the long intro on Last Known Good. That gets us to 28:30 of music.

Rehearsal Saturday at Tape Room, 1 to 4. Alex, you booked it, right?

Kai`, kai),
		},
		{
			key: "BAND-05", box: "band", folder: "archive", at: "2026-10-02T12:00", from: P.taperoom, to: [box("band")],
			subject: `Booking confirmed: Saturday ${c.day("2026-10-03")}, Room B`, read: true, labels: ["Band", "Receipts"], thread: "BAND-05", auto: true,
			html: card({
				brand: "Tape Room Studios", color: "#8a3b2e", preheader: `Room B, ${c.day("2026-10-03")}, 1:00 to 4:00 PM. Balance due at the door: ${money(studioTotal() - STUDIO.deposit)}.`,
				body: `<h2 style="margin:0 0 8px;font-size:20px">You're booked</h2>${plainRows([["Room", "B (live room, backline included)"], ["Date", `Saturday, ${c.day("2026-10-03")}`], ["Time", "1:00 – 4:00 PM"], [`${STUDIO.hours} hours × ${money(STUDIO.rate)}`, money(studioTotal())], ["Deposit paid", `−${money(STUDIO.deposit)}`], ["Due at the door", money(studioTotal() - STUDIO.deposit), "strong"]])}<p>Cancel up to 24 hours before for a full deposit refund.</p>${plainButton("Manage booking", "https://taperoomstudios.com/bookings/TR-5531", "#8a3b2e")}`,
				footer: "Tape Room Studios · Rehearsal rooms",
			}),
		},
		{
			key: "BAND-06", box: "band", folder: "inbox", at: "2026-10-06T15:30", from: P.inkwell, to: [box("band")],
			subject: "Proof ready: The Late Commits tee", read: false, labels: ["Band"], thread: "BAND-06",
			attachments: [file.pdf("late-commits-tee-proof.pdf", [
				{ t: "Inkwell Print Co.", size: 18, bold: true },
				{ t: "Proof INK-4471: The Late Commits tee", size: 13, gap: 4 },
				{ t: "", rule: true, gap: 10 },
				{ t: "Front: THE LATE COMMITS wordmark, 10 in wide, one colour (bone on black).", gap: 6 },
				{ t: "Back: tour list, 'NIGHT BUILDS ONLY', 3 in wide." },
				{ t: "Garment: black heavyweight cotton. Sizes S 6, M 12, L 12, XL 6." },
				{ t: "", rule: true, gap: 10 },
				{ t: `${SHIRTS.count} shirts x ${money(SHIRTS.each)}: ${money(SHIRTS.count * SHIRTS.each)}`, gap: 6 },
				{ t: `Screen setup: ${money(SHIRTS.setup)}` },
				{ t: `Total: ${money(shirtTotal())}`, bold: true },
				{ t: `Approve by Thursday to print in time for the ${c.nth("2026-10-17")}.`, gap: 10 },
			], { band: "#1B1B1F", rule: "#E2DCCF" })],
			html: human(`Hi Alex,

Your proof is attached: one-colour front, small back print, 36 shirts in four sizes.

Total is ${money(shirtTotal())} including the screen setup. If you approve by Thursday, we print Friday and you'll have them on ${esc(c.day("2026-10-14"))}, in time for the show.

Reply "approved" or send changes.

Jess
Inkwell Print Co.`),
		},
		{
			key: "BAND-07", box: "band", folder: "inbox", at: "2026-10-10T13:05", from: P.kai, to: [box("band")],
			subject: "We moved rehearsal", read: false, labels: ["Band"], thread: "BAND-07",
			html: human(`Heard you were up all night keeping the internet alive, so we moved tomorrow's rehearsal from 1 pm to 3 pm. Same room. Bring the tuner you borrowed from me last spring.

Also: shirts. Did you approve the proof?

Kai`),
		},
		{
			key: "BAND-08", box: "band", folder: "spam", at: "2026-10-08T16:40", from: P.spinboost, to: [box("band")],
			subject: "Get The Late Commits on 500 playlists this month", read: false, thread: "BAND-08",
			html: card({
				brand: "Spinboost Promo", color: "#7b3fe4", preheader: "Guaranteed placement on 500 curated playlists. Packages from $149.",
				body: `<p>Hey The Late Commits!</p><p>We loved your sound. Our network of 500 curated playlists can put your next single in front of listeners in days. Packages start at $149 with guaranteed placements.</p>${plainButton("See packages", "https://spinboost-promo.com/packages", "#7b3fe4")}`,
				footer: "Spinboost Promo · Unsubscribe",
			}),
		},
	];
}

function club(c: StoryClock): Slot[] {
	const grace = { name: "Grace Okafor", title: "Director", org: "Riverbend Code Club", link: "riverbendcode.org", mark: "riverbend-code-club" as const };
	const board = c.day("2026-10-14");
	return [
		{
			key: "RCC-01", box: "club", folder: "archive", at: "2026-09-21T19:30", from: P.grace, to: [box("club")],
			subject: "Fall session: 24 kids, 9 laptops", read: true, labels: ["Code Club"], thread: "RCC-01",
			html: human(`Hi Alex,

Sign-ups closed tonight: 24 kids for the fall session, ages 11 to 15, Tuesdays and Thursdays at the library. That's our biggest group yet.

The problem is laptops. We have 9 that work. The library can lend us 3 on Thursdays only.

Can you look at what we could spend if the community fund grant comes through? I'd like a plan before the board meets.

Grace`, grace),
		},
		{
			key: "RCC-02", box: "club", folder: "archive", at: "2026-09-24T11:00", from: P.hvcf, to: [box("club")],
			subject: "Grant award: Riverbend Code Club", read: true, starred: true, labels: ["Code Club"], thread: "RCC-02",
			attachments: [file.pdf("hvcf-award-letter.pdf", [
				{ t: "Hudson Valley Community Fund", size: 18, bold: true, color: "#2f5d8a" },
				{ t: "Grant award letter", size: 13, gap: 4 },
				{ t: c.date("2026-09-24"), gap: 4 },
				{ t: "", rule: true, gap: 10 },
				{ t: "Grantee: Riverbend Code Club (treasurer: Alex Rivera)", gap: 6 },
				{ t: "Program: Fall coding session for ages 11 to 15" },
				{ t: `Award: ${money(CLUB_BOOKS.grant)}`, bold: true, gap: 6 },
				{ t: "Use of funds: equipment and program supplies.", gap: 6 },
				{ t: `Report due: ${c.date("2027-01-15")}, with receipts for purchases over $100.` },
			], { band: "#2f5d8a", rule: "#d5e0ea" })],
			html: human(`Dear Riverbend Code Club,

I'm pleased to tell you that the Fund's board approved your application. Your award of ${money(CLUB_BOOKS.grant)} is for equipment and program supplies for the fall session. The award letter is attached.

Funds will be transferred within ten business days. Please send a short report with receipts by ${esc(c.date("2027-01-15"))}.

Congratulations to you and your volunteers.

Amara Diallo
Program Officer, Hudson Valley Community Fund`),
		},
		{
			key: "RCC-03", box: "club", folder: "sent", at: "2026-09-24T20:15", from: alex("club"), to: [P.grace],
			subject: "Re: Fall session: 24 kids, 9 laptops", read: true, labels: ["Code Club"], thread: "RCC-01", replyTo: "RCC-01",
			quote: "Can you look at what we could spend if the community fund grant comes through?",
			html: human(`Hi Grace,

Good news first: the grant came through today, ${money(CLUB_BOOKS.grant)} for equipment and supplies.

My plan: 12 refurbished Chromebooks gets us to 21 machines. With the library's 3 that's one per kid on Thursdays; on Tuesdays three kids pair up. I'm asking two refurbishers for quotes; I expect around ${money(LAPTOPS.each)} each. That leaves room for chargers, a few mice and snacks for the whole session.

I'll bring the quotes to the board meeting.

Alex`, SIGNERS.alexClub),
		},
		{
			key: "RCC-04", box: "club", folder: "inbox", at: "2026-09-29T18:45", from: P.marcus, to: [box("club")],
			subject: "Mentoring Thursdays", read: true, labels: ["Code Club"], thread: "RCC-04",
			html: human(`Hi Alex,

Grace said you coordinate volunteers on Thursdays. I'm a front-end developer and I'd like to help, starting next week if you need someone.

I can do 5:30 to 7. I'm good with HTML and CSS, less so with Python, but I can learn alongside the kids.

Marcus Lee`),
		},
		{
			key: "RCC-05", box: "club", folder: "inbox", at: "2026-10-02T10:30", from: P.secondbyte, to: [box("club")],
			subject: "Quote SB-2207: 12 refurbished Chromebooks", read: true, labels: ["Code Club"], thread: "RCC-05",
			attachments: [file.pdf("SB-2207-quote.pdf", [
				{ t: "Second Byte Laptops", size: 18, bold: true, color: "#3a7d44" },
				{ t: "Quote SB-2207", size: 13, gap: 4 },
				{ t: `Date: ${c.date("2026-10-02")}  ·  Valid for 30 days`, gap: 4 },
				{ t: "", rule: true, gap: 10 },
				{ t: "Customer: Riverbend Code Club (alex@riverbendcode.org)", gap: 6 },
				{ t: `${LAPTOPS.count} x refurbished 11.6 in Chromebook, 4 GB, 32 GB, charger, grade A: ${money(LAPTOPS.count * LAPTOPS.each)}`, gap: 6 },
				{ t: "Tax: $0.00 (exempt, certificate on file)" },
				{ t: `Total: ${money(laptopTotal())}`, bold: true },
				{ t: "Includes a 12-month warranty and free delivery.", gap: 10 },
			], { band: "#3a7d44", rule: "#d6e6d8" })],
			html: human(`Hi Alex,

Thanks for thinking of us for the code club. Your quote is attached: ${LAPTOPS.count} refurbished Chromebooks at ${money(LAPTOPS.each)} each, ${money(laptopTotal())} with no tax under your exemption. Each comes with a charger and a 12-month warranty.

We can deliver within a week of your order.

Priscilla Moreno
Second Byte Laptops`),
		},
		{
			key: "RCC-06", box: "club", folder: "archive", at: "2026-10-05T14:02", from: P.stripe, to: [box("club")],
			subject: "You received a payment of $50.00", read: true, labels: ["Code Club", "Receipts"], thread: "RCC-06", auto: true,
			html: mail("stripe", {
				preheader: "Riverbend Code Club received a $50.00 donation through its donation link.",
				eyebrow: "Riverbend Code Club · Payment link: Donate",
				body: `<p style="margin:0 0 4px;font-size:32px;line-height:38px;font-weight:600;color:#0A2540;font-variant-numeric:tabular-nums">$50.00</p>
${para("stripe", "from a donor through your <strong>Donate</strong> payment link.", "color:#596171")}
${rows("stripe", [["Amount", "$50.00"], ["Fee", "−$1.75", "muted"], ["Net", "$48.25", "total"]], 16)}
${button("stripe", "View payment", "https://dashboard.stripe.com/payments")}`,
				footer: "You're receiving this because payment notifications are on for Riverbend Code Club.",
			}),
		},
		{
			key: "RCC-07", box: "club", folder: "inbox", at: "2026-10-07T09:10", from: P.grace, to: [box("club")],
			subject: `Board meeting ${board}: treasurer report?`, read: false, starred: true, labels: ["Code Club", "Follow up"], thread: "RCC-07",
			html: human(`Hi Alex,

Board meets on Wednesday, ${esc(board)}, at 6:30. Could you send a short treasurer report by Monday: what's come in, what we've spent, and the laptop purchase you want approved?

Just the numbers is fine.

Grace`, grace),
		},
		{
			key: "RCC-08", box: "club", folder: "draft", at: "2026-10-10T21:30", from: alex("club"), to: [P.grace],
			subject: `Re: Board meeting ${board}: treasurer report?`, read: true, labels: ["Code Club"], thread: "RCC-07", replyTo: "RCC-07",
			quote: "Could you send a short treasurer report by Monday: what's come in, what we've spent, and the laptop purchase you want approved?",
			attachments: [file.csv("treasurer-report.csv", [
				["date", "item", "type", "amount_usd", "running_balance_usd"],
				[c.iso("2026-09-24"), "Hudson Valley Community Fund grant", "income", CLUB_BOOKS.grant.toFixed(2), CLUB_BOOKS.grant.toFixed(2)],
				[c.iso("2026-10-08"), "Snacks for the fall session", "expense", (-CLUB_BOOKS.snacks).toFixed(2), (CLUB_BOOKS.grant - CLUB_BOOKS.snacks).toFixed(2)],
				[c.iso("2026-10-10"), `Donations through the payment link, ${c.short("2026-09-21")} to ${c.short("2026-10-10")}`, "income", CLUB_BOOKS.donations.toFixed(2), clubBalance().toFixed(2)],
				[c.iso("2026-10-14"), `Second Byte quote SB-2207, ${LAPTOPS.count} Chromebooks (for approval)`, "committed", (-laptopTotal()).toFixed(2), clubAfterLaptops().toFixed(2)],
			])],
			html: human(`Hi Grace,

Treasurer report for the board, with the detail in the attached CSV:

- In: ${money(CLUB_BOOKS.grant)} grant and ${money(CLUB_BOOKS.donations)} in donations.
- Out: ${money(CLUB_BOOKS.snacks)} for snacks.
- Balance today: ${money(clubBalance())}.
- For approval: ${LAPTOPS.count} Chromebooks from Second Byte, ${money(laptopTotal())}, which would leave ${money(clubAfterLaptops())}.

Alex`, SIGNERS.alexClub),
		},
	];
}

export function lifeSlots(c: StoryClock): Slot[] {
	return [...personal(c), ...league(c), ...band(c), ...club(c)];
}
