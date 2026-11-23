// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: customers writing to support@. Twenty-two customers, each with
// a different problem, answered the way a small team answers.

import { type Company, type Ctx, type Turn, convo } from "./cast";
import { type Attachment, type Msg, type Person, type When, file, money } from "./kit";

interface Customer {
	name: string;
	biz: string;
	slug: string;
	tld: "com" | "org" | "net";
	plan: "Starter" | "Studio" | "Business";
}

const PRICE = { Starter: 29, Studio: 79, Business: 199 } as const;

const CUSTOMERS: Customer[] = [
	{ name: "Ines Calloway", biz: "Calloway Physio", slug: "calloway", tld: "com", plan: "Studio" },
	{ name: "Marcus Teo", biz: "Teo Tutoring", slug: "teotutoring", tld: "org", plan: "Starter" },
	{ name: "Brenda Alvarez", biz: "Alvarez Auto Care", slug: "alvarezauto", tld: "net", plan: "Studio" },
	{ name: "Tomás Ibarra", biz: "Ibarra Barbers", slug: "ibarrabarbers", tld: "com", plan: "Starter" },
	{ name: "Yuki Tanaka", biz: "Tanaka Pilates", slug: "tanakapilates", tld: "org", plan: "Business" },
	{ name: "Owen Fitzgerald", biz: "Fitzgerald & Sons Plumbing", slug: "fitzplumbing", tld: "net", plan: "Studio" },
	{ name: "Grace Nwosu", biz: "Nwosu Family Dental", slug: "nwosudental", tld: "com", plan: "Business" },
	{ name: "Peter Lindgren", biz: "Lindgren Tennis Academy", slug: "lindgrentennis", tld: "org", plan: "Studio" },
	{ name: "Sofia Marchetti", biz: "Marchetti Photography", slug: "marchettiphoto", tld: "net", plan: "Starter" },
	{ name: "Hassan Qureshi", biz: "Qureshi Tax Prep", slug: "qureshitax", tld: "com", plan: "Starter" },
	{ name: "Emily Stratton", biz: "Stratton Vet Clinic", slug: "strattonvet", tld: "org", plan: "Business" },
	{ name: "Raj Mehta", biz: "Mehta Driving School", slug: "mehtadriving", tld: "net", plan: "Studio" },
	{ name: "Lucy Chen", biz: "Little Lotus Yoga", slug: "littlelotus", tld: "com", plan: "Starter" },
	{ name: "Bram De Vries", biz: "De Vries Bike Repair", slug: "devriesbikes", tld: "org", plan: "Starter" },
	{ name: "Naomi Fischer", biz: "Fischer Music School", slug: "fischermusic", tld: "net", plan: "Studio" },
	{ name: "Carlos Mendes", biz: "Mendes Landscaping", slug: "mendeslandscape", tld: "com", plan: "Starter" },
	{ name: "Anita Joshi", biz: "Joshi Counseling", slug: "joshicounseling", tld: "org", plan: "Studio" },
	{ name: "Walter Pike", biz: "Pike's Fishing Charters", slug: "pikescharters", tld: "net", plan: "Starter" },
	{ name: "Hannah Brooks", biz: "Brooks Flower Studio", slug: "brooksflowers", tld: "com", plan: "Studio" },
	{ name: "Diego Ramos", biz: "Ramos Martial Arts", slug: "ramosma", tld: "org", plan: "Business" },
	{ name: "Kerry Ann Doyle", biz: "Doyle Dog Grooming", slug: "doylegroom", tld: "net", plan: "Starter" },
	{ name: "Ben Adeyemi", biz: "Adeyemi Law Office", slug: "adeyemilaw", tld: "com", plan: "Studio" },
];

interface Issue {
	subject: string;
	ask: (c: Customer) => string;
	answer: (c: Customer) => string;
	thanks?: (c: Customer) => string;
	attach?: (c: Customer, ctx: Ctx) => Attachment[];
	labels?: string[];
	starred?: boolean;
}

const first = (c: Customer) => c.name.split(" ")[0];

const ISSUES: Issue[] = [
	{ subject: "Reminders going out an hour late", ask: (c) => `Hi, my text reminders for tomorrow's appointments just arrived an hour late. Two clients already showed up confused. Did something change?\n\n${first(c)}, ${c.biz}`,
		answer: (c) => `Hi ${first(c)}, sorry about that. Your business timezone was set to Mountain, but your calendar and clients are in Central, so reminders went out an hour after they should. I've changed it to Central and re-queued tomorrow's reminders. You can check it under Settings > Business > Timezone.\n\nMorgan` },
	{ subject: "Importing my client list from a spreadsheet", ask: (c) => `I have about 300 clients in an Excel sheet. Is there a way to bring them in without typing each one?`,
		answer: () => `Yes. Export your sheet as CSV and go to Clients > Import. The columns we look for are in the attached sample: name, email, phone and notes. Extra columns get ignored. Duplicates (same email) update the existing client instead of creating a new one.\n\nIf anything looks wrong in the preview, don't confirm and send me the file.\n\nMorgan`,
		attach: () => [file.csv("client-import-sample.csv", [["name", "email", "phone", "notes"], ["Ada Lovelace", "ada@clients.example.com", "+1 555 0142", "Prefers mornings"], ["Grace Hopper", "grace@clients.example.com", "+1 555 0177", ""]])],
		thanks: () => `Worked on the first try. 297 clients imported, 3 skipped for missing emails. Thank you!` },
	{ subject: "Can I take a deposit when someone books?", ask: (c) => `Some clients book and then don't show. Can I ask for a deposit upfront? Something like $20 to hold the slot.`,
		answer: (c) => `Yes. Under Services, open the one you want and turn on "Require deposit". You can set a flat amount or a percentage. The deposit is taken at booking and subtracted from the final bill. Cancelling inside your cancellation window refunds it automatically.\n\nPayments are handled by Remit, so you'll need to connect your account first (Settings > Payments). It takes about 10 minutes.\n\nMorgan`, labels: ["Billing"] },
	{ subject: "Someone got my 2pm slot twice", ask: (c) => `Two people booked the same 2pm slot this morning, seconds apart. I had to call one of them. How does this happen and can you stop it?\n\n${first(c)}`,
		answer: (c) => `Thanks for the details, ${first(c)}. I found it: both bookings were made within the same second, which beat our slot lock. That's a bug on our side. I've shipped a fix that holds a slot for 5 minutes once someone starts booking it, so the second person now sees "just taken" and picks another time.\n\nI've also credited your account for this month. Sorry for the awkward phone call.\n\nMorgan`, starred: true },
	{ subject: "Intake form: show a field only if they answer yes", ask: () => `On my intake form I ask "Are you on any medication?" and I want a text box for details to appear only if they say yes. I can't find how.`,
		answer: () => `That's "Conditional fields". Click the field you want to hide (the details box), then Logic > Show when, and pick the question and the answer "Yes". You can chain conditions too.\n\nHere's a 40-second recording of the steps: https://example.com/help/conditional-fields\n\nMorgan`, thanks: () => `Got it, thanks. That was easy once I knew where to look.` },
	{ subject: "Appointments not appearing in my phone calendar", ask: (c) => `I added my booking calendar feed to my phone but new appointments take forever to show up. A client booked an hour ago and I still don't see it.`,
		answer: () => `That's how calendar feeds work, unfortunately. Phones refresh subscribed calendars every few hours (sometimes 24) and we can't speed that up from our side.\n\nTwo options:\n\n- Connect via two-way sync instead of the feed. It pushes changes within a minute. Settings > Calendars > Connect.\n- Keep the feed but check the Example Co dashboard for anything urgent.\n\nMorgan` },
	{ subject: "Adding a second hairdresser", ask: (c) => `My business partner wants her own calendar. How do we add her and what does it cost?`,
		answer: (c) => `On ${c.plan} a second staff member is ${money(c.plan === "Starter" ? 12 : 9)} a month. Go to Team > Invite and enter her email. She'll get her own calendar and booking link, and you can offer "any available stylist" on the booking page.\n\nIf the two of you will split the day, consider the Studio plan, which has up to 5 staff included.\n\nMorgan` },
	{ subject: "Please cancel my subscription", ask: (c) => `We're closing the business at the end of the month. Please cancel the subscription and let me know if I get anything back.\n\n${first(c)}`,
		answer: (c) => `I'm sorry to hear that, ${first(c)}. I've cancelled your subscription effective the last day of this month, so you keep access until then. You won't be charged again.\n\nYour data stays available for export for 90 days. If you want a copy sooner, Settings > Export will give you CSV files of clients and bookings.\n\nBest of luck with what's next.\n\nMorgan`, thanks: () => `Thank you for making it painless. I'll recommend you to anyone who asks.` },
	{ subject: "Why was I charged $79?", ask: (c) => `I'm on the $29 plan but my card was charged $79 this month. What happened?`,
		answer: (c) => `Hi ${first(c)}, you upgraded to Studio on the 3rd when you turned on SMS reminders (they're part of Studio). That's why the charge is $79.\n\nIf you don't need SMS, I can move you back to Starter and refund the difference for the days you weren't using it. Which would you like?\n\nMorgan`, labels: ["Billing"] },
	{ subject: "Booking page on my own web address", ask: (c) => `Can the booking page live at book.${c.slug}.example.com instead of your address?`,
		answer: (c) => `Yes. In Settings > Domain, enter book.${c.slug}.example.com and add the CNAME record we show to your DNS (pointing to pages.example.com). We issue the certificate automatically; it usually takes about 15 minutes after DNS propagates.\n\nIf you tell me where your domain is registered, I can point you to the exact screen.\n\nMorgan` },
	{ subject: "One client isn't getting texts", ask: () => `Everyone else gets my reminders except one client, Mrs. Okafor. Her number is right. What's wrong?`,
		answer: () => `I checked the delivery log. Her number is a landline, and landlines can't receive text messages. Our system tried and the carrier rejected it. The simplest fix is to ask her for a mobile number. If she has none, switch her to email reminders on her client page.\n\nMorgan` },
	{ subject: "Feature idea: waitlist for full days", ask: (c) => `When a day is full, I'd love a way for people to join a waitlist and get notified if someone cancels. Any plans?\n\n${first(c)}`,
		answer: () => `Great idea. We have a waitlist for events and classes already (Event > Settings > Waitlist). For one-to-one appointments it's on the roadmap for next quarter. I've added your note to the request, and I'll write to you when it ships.\n\nMorgan`, labels: ["Follow up"] },
	{ subject: "Do you have an API?", ask: (c) => `We build our own website and want to show open slots on it. Is there an API?`,
		answer: () => `Yes. Create a key under Settings > Developers. The \`/availability\` endpoint returns open slots for a service and date range, and \`/bookings\` creates one. The rate limit is 120 requests a minute per key.\n\nDocs: https://example.com/docs/api\n\nMorgan`, thanks: () => `Perfect, thank you. I'll have our web person look at it.` },
	{ subject: "Webhook isn't firing on cancellations", ask: (c) => `We receive webhooks for new bookings but nothing when a booking is cancelled. Is that expected?`,
		answer: () => `Not expected. First check that your endpoint is subscribed to \`booking.cancelled\`. New webhook endpoints default to \`booking.created\` only. If it is subscribed, send me the endpoint ID and I'll look at the delivery log.\n\nSample payload for reference:\n\n\`{"type":"booking.cancelled","id":"bk_8841","reason":"client"}\`\n\nMorgan`, thanks: () => `That was it. Subscribed and working.` },
	{ subject: "How do I get all my data out?", ask: () => `I'd like a full export of clients and appointment history. Is there a button?`,
		answer: () => `Settings > Export. Choose clients, bookings or both, and CSV or JSON. We email you a link in a few minutes (it's usually quick, a bit longer for big accounts). The link works for 24 hours.\n\nMorgan` },
	{ subject: "The new calendar view is great", ask: (c) => `Just wanted to say the new week view is a big improvement. Colour by staff member is exactly what I wanted.\n\n${first(c)}`,
		answer: (c) => `This made my morning, ${first(c)}. Thank you. If anything about it bugs you after a week of use, tell me; we're still polishing.\n\nMorgan` },
	{ subject: "Password reset email never arrives", ask: () => `I asked for a reset three times and nothing arrives. I checked spam.`,
		answer: () => `Sorry about that. Reset emails come from no-reply@mail.example.com. Some business mail servers (especially older ones) hold messages from new senders. I've sent a reset link to you directly from my address, which should land. Once you're in, I'd also suggest switching your login to a personal email you control.\n\nMorgan`, thanks: () => `Got it, thanks. I'm in.` },
	{ subject: "Is there a dark mode?", ask: () => `The dashboard is bright in the evening. Dark mode?`,
		answer: (c) => `Not yet, ${first(c)}. It's on the list for the next big dashboard update. In the meantime, your browser's reader or a dark-mode extension should cover most pages.\n\nMorgan` },
	{ subject: "Block off the holidays", ask: () => `How do I block off Christmas week and a few other days so nobody can book?`,
		answer: () => `Settings > Availability > Time off. Add a date range, give it a name, and it blocks booking across all your services. Existing appointments in the range stay, but you'll see a warning with the list so you can move them.\n\nMorgan` },
	{ subject: "Need receipts for my accountant", ask: (c) => `My accountant wants a PDF receipt for each subscription payment this year. Where do I find them?\n\n${first(c)}`,
		answer: (c) => `Settings > Billing > Invoices has all of them as PDFs. I've also attached your most recent one so you can see what it looks like.\n\nMorgan`,
		attach: (c, ctx) => [file.pdf(`receipt-${c.slug}.pdf`, [
			{ t: "Example Co", size: 18, bold: true }, { t: "Receipt", size: 13, gap: 4 }, { t: `Billed to: ${c.biz}`, gap: 16 },
			{ t: `${c.plan} plan, one month: ${money(PRICE[c.plan])}` , gap: 14 }, { t: "Paid by card ending 4417", gap: 4 }, { t: `Date: ${ctx.clock.date(ctx.clock.at([30, "09:00"]))}`, gap: 4 },
			{ t: "Sample document for development only.", gap: 30 },
		])], labels: ["Billing"] },
];

/** When each thread starts, in days back. The first few are minutes old and still wait for an answer. */
const SCHEDULE: When[] = [32, 95, 255, [1, "09:20"], [1, "15:40"], [2, "10:05"], [3, "08:30"], [4, "11:45"], [6, "13:10"], [8, "09:00"], [10, "14:25"], [13, "10:40"], [16, "16:15"], [19, "09:55"], [23, "12:30"], [27, "08:05"], [33, "10:20"], [39, "15:00"], [45, "11:10"], [52, "09:35"], [58, "14:45"], [66, "10:00"]];

export function supportThreads(ctx: Ctx): Msg[] {
	const out: Msg[] = [];
	for (const [i, issue] of ISSUES.entries()) {
		const c = CUSTOMERS[i % CUSTOMERS.length];
		const company: Company = { name: c.biz, domain: `${c.slug}.example.${c.tld}`, color: "#5f6b74" };
		const person: Person = { name: c.name, addr: `${c.name.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "")}@${company.domain}` };
		const awaiting = i < 5;
		const old = i >= 12;
		const turns: Turn[] = [{ at: SCHEDULE[i], body: issue.ask(c) }];
		if (!awaiting) {
			turns.push({ me: true, at: { after: ctx.r.int(14, 420) }, body: issue.answer(c), attach: issue.attach?.(c, ctx) });
			if (issue.thanks && ctx.r.chance(0.8)) turns.push({ at: { after: ctx.r.int(30, 2200) }, body: issue.thanks(c), quote: ctx.r.chance(0.5) });
		}
		out.push(...convo(ctx, {
			id: `support-${i + 1}`, box: "support", subject: issue.subject, with: person, labels: issue.labels, starred: issue.starred,
			unread: awaiting || (i === 5 && ctx.r.chance(0.5)), where: old ? "archive" : undefined,
		}, turns));
	}
	return out;
}
