// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: written-out conversations for hello@ and billing@. Example Co
// makes booking and intake software for small businesses.

import { CO, type Ctx, at, convo, who } from "./cast";
import { type Msg, file, money } from "./kit";

export function helloAndBilling(ctx: Ctx): Msg[] {
	const { clock } = ctx;
	const fut = (days: number, hhmm: string) => clock.nextDay(clock.now, days, hhmm);
	const out: Msg[] = [];
	const month = clock.monthName(clock.now);
	const mm = String(clock.parts(clock.now).mo + 1).padStart(2, "0");
	const last3 = [2, 1, 0].map((back) => clock.monthName(Date.UTC(clock.parts(clock.now).y, clock.parts(clock.now).mo - back, 15)).slice(0, 3));

	const mira = who("Mira Castellan", CO.larkspur);
	out.push(...convo(ctx, { id: "larkspur", box: "hello", subject: "Cross-promo idea for spring", with: mira, labels: ["Clients"], starred: true, unread: true }, [
		{ at: [9, "10:42"], attach: [file.pdf("larkspur-partnership-deck.pdf", [
			{ t: "Larkspur Studio x Example Co", size: 22, bold: true }, { t: "Spring partnership proposal", size: 14, gap: 6 },
			{ t: "1. Who we are", size: 13, bold: true, gap: 24 },
			{ t: "Larkspur is a 9-person brand studio. We build sites and identity work for clinics, studios and", gap: 4 },
			{ t: "independent retailers. About 60% of our clients need online booking within a year of launch." },
			{ t: "2. The offer", size: 13, bold: true, gap: 18 },
			{ t: "- Larkspur recommends Example Co's booking pages to every new client.", gap: 4 },
			{ t: "- Example Co lists Larkspur as a design partner on its partners page." },
			{ t: "- Shared case study: Brightwater Dental, launched in March." },
			{ t: "- Referral credit: 2 months free for each client who signs up through Larkspur." },
			{ t: "3. Timeline", size: 13, bold: true, gap: 18 },
			{ t: "Kickoff call this month. Case study live within six weeks. Review after one quarter.", gap: 4 },
		])], body: `Hi Morgan,

I run Larkspur Studio. We build sites for a lot of the same businesses that use you (Brightwater Dental told me about the intake forms last month).

I put together a short deck on a spring cross-promo. The short version: we recommend your booking pages to new clients, you list us as a design partner, and we write one case study together.

Would 20 minutes this week work?

Mira` },
		{ me: true, at: { after: 190 }, body: `Hi Mira,

Thanks for the deck. The case study with Brightwater is the part I like most. They've been happy and their numbers are good: no-shows down about a third since reminders went on.

Two questions before a call:

- What would the referral credit cost you? I want to be sure it isn't coming out of your margin.
- Do you want an exclusive, or is this open to other studios?

Morgan` },
		{ at: { after: 1280 }, body: `Morgan,

No cost to us, the credit is yours to give. I'd rather not do an exclusive. Two other studios in town would ask for the same thing, and I'd like to be able to say yes to them.

I'm free Thursday or Friday afternoon. Mira` },
		{ me: true, at: { after: 95 }, body: `Perfect. Friday at 2:00 works. I'll send an invite.

I'll also ask Brightwater if they're comfortable being named.` },
		{ at: [1, "16:20"], body: `Brightwater said yes, and they'll give us a quote. I drafted the outline for the case study and put it in the shared folder. Can you take a look before Friday?` },
	]));

	const dev = who("Dev Banerjee", CO.orbit);
	out.push(...convo(ctx, { id: "orbit", box: "hello", subject: "Volume pricing for 12 locations?", with: dev, labels: ["Clients", "Follow up"], unread: true }, [
		{ at: [5, "08:55"], body: `Hello,

We run Orbit Bikes, 12 shops across three states. Every shop books repairs and fittings on its own spreadsheet. We want one system with a booking page per shop, and the owner of each shop only sees their own calendar.

Is there a plan for that? What would 12 locations cost per month?

Dev Banerjee
Operations, Orbit Bikes` },
		{ me: true, at: { after: 340 }, body: `Hi Dev,

Yes. The Business plan covers multiple locations: a booking page and calendar per location, and roles so each shop owner sees only theirs. It's ${money(199)} a month for up to 5 locations and ${money(25)} per extra location, so 12 would be ${money(199 + 7 * 25)} a month.

For 12 shops I'd offer a 20% discount on a yearly plan. That brings it to ${money(Math.round((199 + 7 * 25) * 0.8 * 100) / 100)} a month.

I can set up a sandbox with three of your shops so you can see how roles work. Does that help?

Morgan` },
		{ at: { after: 1500 }, body: `That's a better number than I expected. Yes to the sandbox. Use Eastgate, Harbor St. and the Riverside shop.

One more question: can customers pick a mechanic, not just a time? Our fitters are booked by name.` },
		{ me: true, at: { after: 120 }, body: `Yes, each booking page can offer staff by name or "first available." I'll set the sandbox up with a fitter per shop so you can try both.` },
		{ at: [1, "11:08"], body: `Sandbox looks good. The owners liked the calendar view. Can you send the annual quote as a PDF? Finance needs it before they approve.` },
	]));

	const frank = who("Frank Delacroix", CO.hollowpines);
	out.push(...convo(ctx, { id: "hollowpines", box: "hello", subject: "Tee sheet booking page: kickoff", with: frank, labels: ["Clients"] }, [
		{ at: [16, "09:12"], body: `Morgan,

Signed the order form this morning. We're ready to move our tee sheet over. Season ends in 7 weeks, so I'd like members booking on the new page before then.

I attached our member list as it exports today. 412 members, 38 with guest privileges.` , attach: [file.csv("hollow-pines-members.csv", [
			["member_id", "name", "email", "tier", "guest_passes"],
			["HP-1001", "Alan Whitaker", "alan.whitaker@members.example.com", "Full", 4],
			["HP-1002", "Becca Lindqvist", "becca.l@members.example.com", "Full", 4],
			["HP-1003", "Carlos Duarte", "carlos.duarte@members.example.com", "Weekday", 0],
			["HP-1004", "Dina Okafor", "dina.okafor@members.example.com", "Full", 4],
			["HP-1005", "Edgar Pruitt", "edgar.pruitt@members.example.com", "Junior", 0],
			["HP-1006", "Fiona McAllister", "fiona.mc@members.example.com", "Social", 2],
		])] },
		{ me: true, at: { after: 150 }, body: `Welcome aboard, Frank. Thanks for the list. Three things I'll need before import:

- Which tiers can book 14 days ahead, and which 7?
- Tee time interval: still 9 minutes?
- Who can edit the sheet on busy days (starter, pro shop, you)?

I'll also set up a call so we can do the first week together.` },
		{ at: { after: 1100 }, body: `Full members 14 days, everyone else 7. Intervals are 9 minutes, 10 on Sundays for the shotgun events. The pro shop (Terry and Gail) and I can edit.` },
		{ me: true, at: { after: 60 }, body: `Got it. Invite for the kickoff attached. We'll do 45 minutes and import a test week during it.`, attach: [file.ics("kickoff.ics", { uid: "hp-kickoff", start: clock.at([14, "13:00"]), end: clock.at([14, "13:45"]), summary: "Hollow Pines: tee sheet kickoff", location: "Video call", organizer: ctx.me.hello, attendee: frank, clock })] },
		{ at: [14, "14:20"], body: `That went well. Terry says the drag-and-drop is faster than what we had. One thing: members keep asking if they can book from their phone without a login.` },
		{ me: true, at: { after: 35 }, body: `They can. Booking pages work without an account; the member just enters their member ID and email. I'll turn on the member-ID check so only your 412 can book. It'll be on by tomorrow morning.` },
		{ at: [2, "07:45"], body: `First weekend on the new sheet and not a single phone call about tee times. Terry wants to know if we can send a text reminder the night before. How much is that?`, starred: true },
	]));

	const priya = { name: "Priya Raman", addr: "priya.raman@mail.example.net" };
	out.push(...convo(ctx, { id: "dinner", box: "hello", subject: "Dinner Saturday?", with: priya, labels: ["Personal"] }, [
		{ at: [3, "18:02"], body: `Are you around Saturday? Dan and I are trying the new Ethiopian place on Fulton. 7:30. They don't take reservations over 4 so we'd need to be on time.` },
		{ me: true, at: { after: 25 }, body: `Yes! I'm in. Can I bring anything or is this just dinner?` },
		{ at: { after: 9 }, body: `Just yourself. Dan's bringing the good hot sauce he won't shut up about.`, quote: false },
		{ me: true, at: { after: 4 }, body: `See you at 7:30.`, quote: false },
	]));

	const sam = who("Sam Okonkwo", CO.tidepool);
	const dana = { name: "Dana Whitcomb", addr: "dana@whitcomb.example.org" };
	out.push(...convo(ctx, { id: "intro", box: "hello", subject: "Intro: Dana Whitcomb and Morgan Reyes", with: sam, labels: ["Follow up"], unread: true }, [
		{ at: [4, "13:30"], cc: [dana], body: `Morgan, meet Dana. Dana runs operations for a group of eight physical therapy clinics and she's been asking me which scheduling tools don't make the front desk miserable. I said yours.

Dana, Morgan builds booking software for small businesses. Hands down the most responsive founder I know.

I'll let you two take it from here.

Sam` },
		{ me: true, at: { after: 80 }, to: [dana], cc: [sam], body: `Thanks for the intro, Sam. Hi Dana, nice to meet you.

Eight clinics is a good fit for what we do. If it helps, tell me the one thing the front desk hates most about your current setup and I'll show you how we handle it. 20 minutes next week?` },
		{ at: [2, "09:50"], from: dana, body: `Hi Morgan, thanks Sam. The thing they hate most is double bookings when a patient reschedules by phone and online at the same time. We lose about 6 appointments a week to it across all clinics.

Next Tuesday or Wednesday morning works.`, cc: [sam] },
	]));

	const greg = { name: "Gregory Hale", addr: "greg.hale@sounder.example.com" };
	out.push(...convo(ctx, { id: "greg", box: "hello", subject: "Third email. Still no response to my ticket", with: greg, labels: ["Follow up"], where: "archive" }, [
		{ at: [22, "07:12"], body: `This is my third email. I opened a ticket nine days ago because my reminders stopped sending and I have received nothing back. My patients are no-showing. Please respond today.

Gregory Hale
Hale Chiropractic` },
		{ me: true, at: { after: 48 }, body: `Mr. Hale, I'm sorry. This should not have taken nine days, and I found why: your ticket went to an address that doesn't exist anymore. That's on us.

I've looked at your account. Your reminders stopped because your SMS number was flagged by the carrier after a spike of messages on the 3rd. I've reregistered it and sent a test to my own phone. It went through. Reminders are sending again as of 10 minutes ago.

For the 9 days you were without them, I've credited your account for the month. If any patients no-showed because of it, tell me how many and I'll add to the credit.

Morgan` },
		{ at: { after: 410 }, body: `Thank you. That's the response I wanted nine days ago. 4 no-shows that I can attribute. I appreciate the credit.` },
		{ me: true, at: { after: 70 }, body: `Added another ${money(116)} for the four. Thanks for your patience, and for telling me.` },
	]));

	const helen = who("Helen Marsh", CO.quill);
	out.push(...convo(ctx, { id: "helen", box: "hello", subject: "Thank you (really)", with: helen, labels: ["Clients"], starred: true }, [
		{ at: [11, "20:41"], body: `Morgan, I wanted to write instead of leaving a review. We started taking bookings for our Thursday author evenings through your page in the spring. Before, I used a clipboard. Last night we sold out a 40-seat reading in under an hour and nobody had to call me.

My daughter set it up and said "that was the easy one." I think that's the nicest thing you can say about software.

Thank you.

Helen
Quill & Ink Bookshop` },
		{ me: true, at: { after: 150 }, body: `Helen, this made my week. I'll tell the team (all of us, it's a small team). Your daughter is right, and I'm glad it was easy.

If you ever want a reading to have a waitlist, there's a switch for it under the event. And thanks for the offer of a review. If you're up for it, a sentence or two I can quote on the site would be amazing, but only if you'd like to.

Morgan` },
		{ at: { after: 800 }, body: `Quote away. "I used a clipboard. Now I don't." You can put my name on it.` },
	]));

	// Billing
	const linda = who("Linda Okafor", CO.okafor);
	out.push(...convo(ctx, { id: "cpa", box: "billing", subject: "Estimated tax this quarter: numbers needed", with: linda, labels: ["Billing"], unread: true }, [
		{ at: [8, "15:30"], attach: [file.pdf("q3-estimate-worksheet.pdf", [
			{ t: "Okafor & Lind CPAs", size: 18, bold: true }, { t: "Quarterly estimated tax worksheet", size: 13, gap: 4 },
			{ t: "Revenue for the quarter", bold: true, gap: 20 }, { t: "Subscriptions: ____________", gap: 4 }, { t: "Services and one-time: ____________" },
			{ t: "Expenses", bold: true, gap: 16 }, { t: "Hosting and tools: ____________", gap: 4 }, { t: "Contractors (1099): ____________" }, { t: "Software subscriptions: ____________" }, { t: "Insurance and legal: ____________" },
			{ t: "Safe harbor: 110% of last year's liability.", gap: 24 },
		])], body: `Hi Morgan,

The quarterly estimate is due on the 15th. To calculate it I need:

- Revenue by month, split between subscriptions and one-time services
- Contractor payments (so I can confirm the 1099s)
- Any equipment over $500
- Mileage log if you want to claim it

The attached worksheet has the layout. A spreadsheet export is fine too.

Linda Okafor, CPA` },
		{ me: true, at: { after: 5400 }, attach: [file.csv("quarter-revenue-and-expenses.csv", [
			["month", "subscriptions", "services", "hosting_tools", "contractors", "software", "insurance_legal"],
			[last3[0], 18420, 2400, 2145.18, 3600, 1318.9, 410],
			[last3[1], 19175, 0, 2210.4, 3600, 1318.9, 410],
			[last3[2], 20360, 4800, 2288.75, 4200, 1342.0, 1480],
		])], body: `Linda, numbers attached. No equipment over $500 this quarter. Contractor payments are all to the same person (Jo Whitfield). The latest month's insurance and legal is higher because of the NDA review and the policy renewal.

Morgan` },
		{ at: { after: 1600 }, body: `Thanks, this is clean. One question: the $4,800 in services last month, was that a single customer? If it's a single prepaid project I may want to treat part of it as deferred.

I'll have the estimate to you by the 12th.` },
	]));

	const marlowAp = who("Teresa Kwon", CO.marlow);
	out.push(...convo(ctx, { id: "marlow", box: "billing", subject: "Invoice 1043: PO number and W-9", with: marlowAp, labels: ["Billing"], where: "archive" }, [
		{ at: [27, "10:05"], body: `Hello,

Our accounts payable system rejected invoice 1043 because it has no PO number. Please reissue with PO 55871. We also don't have a W-9 on file for Example Co. Can you send one?

Thanks,
Teresa Kwon
Accounts Payable, Marlow Logistics` },
		{ me: true, at: { after: 130 }, attach: [file.pdf("example-co-w9.pdf", [
			{ t: "Form W-9 (sample)", size: 18, bold: true }, { t: "Request for Taxpayer Identification Number and Certification", size: 11, gap: 2 },
			{ t: "Name: Example Co, LLC", gap: 20 }, { t: "Business type: Limited liability company" }, { t: "Address: 100 Example Street, Suite 4, Springfield" }, { t: "TIN: XX-XXXXXXX" },
			{ t: "This is a sample document for development only.", gap: 40 },
		])], body: `Hi Teresa,

Reissued invoice 1043 with PO 55871 is attached to this thread's earlier invoice email (same number, marked "reissued"). The W-9 is attached here.

Let me know if AP wants anything else.

Morgan` },
		{ at: { after: 2900 }, body: `Received both. Approved for the next payment run, which is on the 5th. You should see it in 5 to 7 business days after.` },
		{ at: [8, "09:30"], body: `Payment sent today. Remittance advice will follow from the bank.` },
	]));

	const jo = who("Jo Whitfield", CO.whitfield);
	out.push(...convo(ctx, { id: "jo-invoice", box: "billing", subject: `${month} invoice and status`, with: jo, labels: ["Billing"] }, [
		{ at: [1, "17:48"], attach: [file.csv("jo-whitfield-hours.csv", [
			["date", "project", "hours", "note"],
			[`${mm}-01`, "API", 6.5, "Rate limit headers"], [`${mm}-02`, "API", 7, "Webhook retries"], [`${mm}-05`, "Calendar sync", 5, "iCal feed timezone bug"],
			[`${mm}-06`, "Calendar sync", 6, "Recurring events"], [`${mm}-07`, "Intake forms", 4.5, "Conditional fields"], [`${mm}-08`, "Ops", 3, "Latency postmortem"],
			[`${mm}-09`, "Intake forms", 7, "File upload field"], [`${mm}-12`, "API", 5, "Pagination cursors"],
		]), file.pdf("whitfield-dev-invoice-1012.pdf", [
			{ t: "Whitfield Dev", size: 20, bold: true }, { t: "Invoice 1012", size: 13, gap: 4 }, { t: "Bill to: Example Co", gap: 14 },
			{ t: `Contract development, ${month} 1-12`, gap: 18 }, { t: "44.0 hours x $95.00 = $4,180.00", bold: true, gap: 6 },
			{ t: "Due in 14 days. Pay by ACH.", gap: 20 },
		])], body: `Hey Morgan, this month's invoice and hours attached, 44 hours so far. Status:

- Webhook retries are done and deployed.
- iCal timezone bug is fixed, and I added a test for the DST case that bit Atlas.
- File upload for intake forms is in review (PR #231).
- Still on my list: pagination cursors for the API, and the 429 headers.

Let me know if you want me to prioritise differently next week.

Jo` },
		{ me: true, at: { after: 220 }, body: `Thanks, Jo. Invoice approved; it'll go out Friday. Next week: finish pagination, then upload field. The 429 headers can wait.

Can you also write up last week's latency incident? I want a short postmortem for the status page.` },
	]));

	const remit = at(CO.remit, "disputes", "Remit Disputes");
	out.push(...convo(ctx, { id: "dispute", box: "billing", subject: "Action needed: a payment was disputed (#DP-30418)", with: remit, labels: ["Billing"], starred: true }, [
		{ at: [6, "06:14"], body: `A customer's bank opened a dispute on a payment.

**Amount:** ${money(79)}
**Customer:** juniper-health (card ending 4417)
**Reason:** Unrecognized
**Respond by:** ${clock.short(fut(8, "00:00"))}

Submit evidence from your dashboard. Disputes with no response are lost automatically.` },
		{ me: true, at: { after: 600 }, body: `Hi,

Submitting evidence now. The customer, Juniper Health, has been on the Studio plan since March and logged in on 14 of the last 30 days. I've attached the invoice history and the signed order form to the dispute in the dashboard.

Can you confirm what else the bank usually looks for in cases like this?`, quote: false },
		{ at: { after: 1900 }, body: `Thanks for the evidence. The bank looks for proof the cardholder knew about the recurring charge: the signed order form and receipts emailed to the customer help most. We've attached what you gave us. We'll tell you the outcome in 30 to 60 days.

Remit Disputes` },
	]));

	return out;
}
