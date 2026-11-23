// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: written-out conversations for legal@, ops@, support@ escalations and press@.

import { CO, type Ctx, at, convo, who } from "./cast";
import { type Msg, file, money } from "./kit";

export function legalOpsPress(ctx: Ctx): Msg[] {
	const { clock } = ctx;
	const fut = (days: number, hhmm: string) => clock.nextDay(clock.now, days, hhmm);
	const out: Msg[] = [];

	// ── legal@ ──
	const nda = [
		{ t: "MUTUAL NON-DISCLOSURE AGREEMENT", size: 16, bold: true }, { t: "Between Example Co, LLC and Tidepool Labs, Inc.", gap: 8 },
		{ t: "1. Purpose. The parties wish to explore a possible integration and may disclose confidential information.", gap: 16 },
		{ t: "2. Confidential Information means non-public technical, business and customer information marked or", gap: 8 },
		{ t: "reasonably understood to be confidential, excluding information that is public, already known, or" },
		{ t: "independently developed without use of the other party's information." },
		{ t: "3. Obligations. Each party will use the other's information only for the Purpose, protect it with", gap: 8 },
		{ t: "reasonable care, and disclose it only to employees and advisers who need it and are bound by" },
		{ t: "similar obligations." },
		{ t: "4. Term. This agreement lasts two years. Obligations survive for three years after disclosure.", gap: 8 },
		{ t: "5. Governing law. The laws of the State of Delaware. Venue: the courts of that State.", gap: 8 },
		{ t: "6. Residuals. Neither party is restricted from use of general knowledge retained in unaided memory.", gap: 8 },
		{ t: "(Sample text for development only. This is not legal advice.)", gap: 30 },
	];
	const harlan = who("Anneliese Pierce", CO.harlan);
	out.push(...convo(ctx, { id: "nda", box: "legal", subject: "Mutual NDA with Tidepool Labs: our comments", with: harlan, labels: ["Legal"], starred: true }, [
		{ at: [13, "11:20"], attach: [file.pdf("tidepool-mutual-nda-v2.pdf", nda)], body: `Morgan,

Tidepool's counsel sent their form of mutual NDA. I've reviewed it. It's a standard form with three points I'd change:

- **Residuals clause (section 6).** This lets them keep and use what they remember from our materials. I'd strike it, or limit it to general skills and knowledge.
- **Term.** Two years of disclosure plus three of survival is longer than we need. One plus two is more common for an early conversation.
- **Venue.** Delaware is fine, but I'd rather it be neutral on venue so you aren't forced to litigate there.

Redlined version attached to the next message. Tell me if you want me to push on all three or concede the venue point.

Anneliese Pierce
Harlan & Pierce LLP` },
		{ me: true, at: { after: 300 }, body: `Anneliese, thanks. Push on the residuals clause. I can live with the term but I'd like one year of disclosure. Concede venue.

Do we need anything signed before Sam's team shares their API docs? They'd like to look at them this week.` },
		{ at: { after: 150 }, body: `Reasonable. Until it's signed, tell Sam's team to send only public documentation. I'll send the counter today and I expect a quick turnaround on a mutual form.` },
		{ at: [8, "16:02"], body: `Tidepool agreed to strike residuals and shorten the term to 18 months. They kept Delaware. Clean copy for signature attached. I recommend signing.`, attach: [file.pdf("tidepool-mutual-nda-final.pdf", [...nda.slice(0, 6), { t: "[Residuals clause deleted by agreement.]", gap: 8 }, ...nda.slice(7)])] },
		{ me: true, at: { after: 70 }, body: `Signed and returned through the e-sign link. Thanks for turning this around so quickly.` },
	]));

	const noor = { name: "Noor Haddad", addr: "noor.haddad@mail.example.org" };
	out.push(...convo(ctx, { id: "privacy", box: "legal", subject: "Request for a copy of my personal data", with: noor, labels: ["Legal"] }, [
		{ at: [10, "21:09"], body: `Hello,

I'd like to request a copy of all the personal data you hold about me, and I'd like to know who you share it with. My account email is noor.haddad@mail.example.org.

Please confirm receipt.

Noor Haddad` },
		{ me: true, at: { after: 640 }, body: `Hello Noor,

We've received your request and will respond within 30 days. To keep your data safe, we'll verify it's you: we've sent a confirmation link to the address on your account. Please click it before we send anything.

Legal, Example Co` },
		{ at: { after: 300 }, body: `Done, I clicked the link.` },
		{ me: true, at: { after: 4300 }, attach: [file.text("noor-haddad-data-export.json", JSON.stringify({ account: { email: "noor.haddad@mail.example.org", created: "2025-02-11", plan: "Starter" }, bookings: 38, forms_submitted: 12, sms_sent: 0, subprocessors: ["Cobalt Cloud (hosting)", "Sendwave Mail (email delivery)", "Remit Payments (payments)"] }, null, 2), "application/json")], body: `Hello Noor,

Your export is attached. It lists your account details, your bookings and form submissions, and the services that process data on our behalf: Cobalt Cloud for hosting, Sendwave Mail for email delivery and Remit Payments for payments.

If you also want your data deleted, reply to this message and we'll confirm once it's done. Deleting an account is permanent.

Legal, Example Co` },
	]));

	const ins = who("Marcus Bell", CO.brightside);
	out.push(...convo(ctx, { id: "insurance", box: "legal", subject: "Renewal: general liability and cyber (policy GL-883412)", with: ins, labels: ["Legal", "Billing"], where: "archive" }, [
		{ at: [34, "09:00"], attach: [file.pdf("renewal-quote-gl-883412.pdf", [
			{ t: "Brightside Insurance", size: 18, bold: true }, { t: "Renewal quote: Policy GL-883412", size: 13, gap: 4 },
			{ t: "General liability, $1M per occurrence: $780 / year", gap: 20 }, { t: "Cyber liability, $1M aggregate: $1,140 / year" }, { t: "Total: $1,920 / year (was $1,720)", bold: true, gap: 6 },
			{ t: "Increase reflects the higher revenue band. Coverage is otherwise unchanged.", gap: 14 },
		])], body: `Hi Morgan,

Your policy renews next month. The quote attached is ${money(200)} higher than last year because your revenue moved into the next band. Coverage is the same.

If you'd like to compare, I can also quote $2M cyber for ${money(380)} more. Let me know by the end of the week and I'll lock a price.

Marcus Bell
Brightside Insurance` },
		{ me: true, at: { after: 260 }, body: `Hi Marcus, thanks. Keep the coverage as is. I'll take the quote at ${money(1920)}. Please send the certificate when it's issued, since two customers have asked for one.` },
		{ at: [21, "13:15"], attach: [file.pdf("certificate-of-insurance.pdf", [
			{ t: "CERTIFICATE OF INSURANCE", size: 18, bold: true }, { t: "Insured: Example Co, LLC", gap: 14 }, { t: "General liability: GL-883412, $1,000,000 per occurrence" },
			{ t: "Cyber liability: CY-110926, $1,000,000 aggregate" }, { t: "Sample document for development only.", gap: 30 },
		])], body: `Policy bound. Certificate attached. I can name an additional insured on request, free of charge, so just tell me who.` },
	]));

	const dmca = at(CO.orchard, "rights", "Orchard Media Rights");
	out.push(...convo(ctx, { id: "dmca", box: "legal", subject: "Notice of claimed infringement: example.com/blog/fairway-photos", with: dmca, labels: ["Legal"], unread: true }, [
		{ at: [2, "04:32"], body: `To the designated agent,

We represent Orchard Media, which holds the rights to a photograph of the 14th hole at a course we won't name here. The photograph appears at the URL above without a license.

We request that the image be removed within 5 business days. If you believe this claim is mistaken, you may send a counter-notice.

Orchard Media Rights
Notice reference: OM-24-77120` },
	]));

	const mark = who("Anneliese Pierce", CO.harlan);
	out.push(...convo(ctx, { id: "trademark", box: "legal", subject: "Watch notice: a similar mark was filed", with: mark, labels: ["Legal"], unread: true }, [
		{ at: 190, body: `Morgan,

Our trademark watch flagged a new application for "ExampleBook" in the same class as your mark. It was filed by a company in Ohio. It doesn't conflict outright but the overlap is close enough that I'd want to look.

I'll draft a short note you can use to decide whether to oppose. No action from you yet.

Anneliese` },
	]));

	out.push(...convo(ctx, { id: "contractor", box: "legal", subject: "Contractor agreement: renewal draft", with: harlan, labels: ["Legal"] }, [
		{ me: true, at: [19, "10:12"], body: `Anneliese, Jo Whitfield's contractor agreement is up for renewal. Can you look at what we signed last year and tell me what needs to change? Jo does about 40 hours a week now, which is more than we first expected.` },
		{ at: { after: 380 }, body: `Morgan, two things worth knowing at 40 hours a week:

- At that level the arrangement can look like employment in some states. The test turns on control over the work, not hours alone, but it's worth reviewing.
- The IP assignment is good but it doesn't cover pre-existing code Jo brings to the project. I'd add a license.

I'll mark up the agreement and send it. I'd also ask Jo to confirm they work for other clients; it helps the independent contractor story.` },
		{ me: true, at: { after: 300 }, body: `Thanks. Mark it up. Jo has two other clients, which I can have them confirm in writing.` },
	]));

	// ── ops@ ──
	const jo = who("Jo Whitfield", CO.whitfield);
	out.push(...convo(ctx, { id: "postmortem", box: "ops", subject: "Postmortem: API latency last week", with: jo, labels: ["Dev"], starred: true }, [
		{ at: [5, "18:30"], attach: [file.svg("p95-latency.svg", "p95 latency (ms), hourly", [180, 175, 190, 210, 960, 1480, 1320, 640, 260, 200, 185, 182], "#c8372d"), file.csv("slow-queries.csv", [["query", "calls", "avg_ms", "max_ms"], ["bookings by day", 18440, 812, 3920], ["member lookup", 6210, 14, 120], ["reminders due", 2900, 22, 95]])], body: `Morgan, here's what I know about the latency incident.

**Impact:** p95 API latency went from about 190 ms to 1.4 s for 2 hours and 10 minutes. About 3% of booking page loads timed out.

**Cause:** a new report query ("bookings by day") scanned the whole bookings table with no index on the date column. Running every few minutes from the dashboard, it saturated the database.

**Fix:** added the index and moved the report to run on a schedule instead of on every dashboard view. Latency is back to normal.

**Follow-ups:**
- Alert when p95 is above 500 ms for 10 minutes. Right now we only alert at 2 s.
- Add a query review step to PRs that touch reports.

Chart and slow query list attached.` },
		{ me: true, at: { after: 55 }, body: `Great write-up. Two questions:

- Why did it take 40 minutes to notice?
- Can the alert threshold be per route? The reports route will always be slower than booking.` },
		{ at: { after: 90 }, body: `It took 40 minutes because the 2 s alert never fired. P95 peaked at 1.4 s. Per-route thresholds: yes, Lumen supports it. I'll set booking at 500 ms and reports at 3 s.` },
		{ me: true, at: { after: 20 }, body: `Do it. I'll publish a short note on the status page tomorrow.` },
	]));

	out.push(...convo(ctx, { id: "keys", box: "ops", subject: "Rotate the staging keys?", with: jo, labels: ["Dev"] }, [
		{ at: [2, "12:44"], body: `Hey, the staging API key is in a screenshot I posted in the team channel last week. Probably fine since it's staging only, but I'd rotate it anyway. OK if I do it today?` },
		{ me: true, at: { after: 18 }, body: `Yes, rotate. And delete the screenshot. Let me know when it's done so I can update the integration tests.` },
		{ at: { after: 55 }, body: `Done. New key is in the shared vault under "staging/api". Old one is revoked, and I deleted the screenshot.` },
	]));

	const juniper = who("Alicia Moreno", CO.juniper);
	out.push(...convo(ctx, { id: "security-q", box: "ops", subject: "Security questionnaire from Juniper Health", with: juniper, labels: ["Clients"] }, [
		{ at: [14, "15:10"], body: `Hello,

Juniper Health is renewing and our compliance team needs your answers to the attached questionnaire. Topics: data encryption, access controls, incident response, backups and sub-processors. We need it back in 10 business days.

Alicia Moreno
Compliance, Juniper Health`, attach: [file.pdf("juniper-security-questionnaire.pdf", [
			{ t: "Vendor security questionnaire", size: 18, bold: true }, { t: "Juniper Health, 2026 renewal", gap: 4 },
			{ t: "1. Is data encrypted in transit and at rest? Describe.", gap: 20 }, { t: "2. How is access to production data controlled and logged?", gap: 14 },
			{ t: "3. Describe your incident response process and notification timeline.", gap: 14 }, { t: "4. How often are backups taken and tested?", gap: 14 },
			{ t: "5. List sub-processors that handle our data.", gap: 14 }, { t: "6. Do you hold SOC 2 or ISO 27001? If not, describe alternatives.", gap: 14 },
		])] },
		{ me: true, at: { after: 160 }, body: `Hi Alicia, got it. I'll have answers to you this week. One thing to flag now: we don't hold a SOC 2 report yet. We do have a written security policy, quarterly access reviews and a list of sub-processors. Would that be enough for your team, or should I plan for a call with them?` },
		{ at: { after: 1200 }, body: `That's helpful to know. Send the written policy and the other items. If compliance has follow-ups they'll tell me, and we can set a call then.` },
		{ me: true, at: [9, "11:30"], attach: [file.pdf("example-co-security-overview.pdf", [
			{ t: "Example Co: Security overview", size: 18, bold: true }, { t: "Encryption: TLS 1.3 in transit; AES-256 at rest.", gap: 18 },
			{ t: "Access: SSO, role-based access, access reviews every quarter.", gap: 6 }, { t: "Incidents: notification to customers within 72 hours.", gap: 6 },
			{ t: "Backups: continuous, point-in-time recovery for 30 days; restore tested quarterly.", gap: 6 }, { t: "Sub-processors: Cobalt Cloud, Sendwave Mail, Remit Payments.", gap: 6 },
			{ t: "Sample document for development only.", gap: 30 },
		])], body: `Alicia, the answers are in the attached overview, which also covers the questionnaire. Let me know what compliance would like to dig into.` },
		{ at: [7, "10:05"], body: `Compliance is satisfied. Please add us to the renewal list.`, starred: true },
	]));

	// ── press@ ──
	const alicia = who("Alicia Voss", CO.dailycircuit);
	out.push(...convo(ctx, { id: "reporter", box: "press", subject: "Request for comment: booking software and no-shows", with: alicia, labels: ["Press"], starred: true }, [
		{ at: [4, "14:06"], body: `Hi Morgan,

I'm a reporter at The Daily Circuit working on a piece about how small businesses cut down on no-shows. A dentist I spoke to mentioned your reminders. Do you have data on how much they help?

I'm on deadline for ${clock.short(fut(2, "00:00"))}. Could you do a 15-minute call, or answer a few questions by email?

Alicia Voss
The Daily Circuit` },
		{ me: true, at: { after: 120 }, body: `Hi Alicia,

Happy to help. Short version: across customers who turned on SMS reminders, no-shows dropped from 14% to 9% on average. Email-only reminders helped less, about 14% down to 12%. The best result we've seen is a dental practice that went from 18% to 6% by adding a reply-to-confirm step.

I can share the methodology and put you in touch with two customers who've said yes to speaking. When's a good time for a call tomorrow?` },
		{ at: { after: 380 }, body: `This is great. Call tomorrow at 10:30? And yes, please connect me with the customers. I'd like one dental practice and one non-medical business.` },
		{ me: true, at: { after: 25 }, body: `10:30 works. I'll introduce you to Brightwater Dental and Quill & Ink Bookshop in a separate email.` },
	]));

	const pod = who("Theo Brandt", CO.buildnotes);
	out.push(...convo(ctx, { id: "podcast", box: "press", subject: "Guest invite: Build Notes, episode 112", with: pod, labels: ["Press"] }, [
		{ at: [15, "09:41"], body: `Hi Morgan,

I host Build Notes, a podcast for people building small software businesses (about 8,000 listeners per episode). I'd love to have you on to talk about growing a booking product without a sales team.

It's a 40-minute conversation, recorded remotely, and I send questions ahead of time. No pressure to promote anything.

Theo Brandt` },
		{ me: true, at: { after: 200 }, body: `Hi Theo, I'd be glad to. I listen to the show, so this is a treat. Mornings are best for me. Would the week after next work?` },
		{ at: { after: 700 }, attach: [file.ics("build-notes-recording.ics", { uid: "bn-112", start: fut(9, "10:00"), end: fut(9, "10:45"), summary: "Recording: Build Notes episode 112", location: "Remote (link in invite)", organizer: pod, attendee: ctx.me.press, clock })], body: `Perfect. I've put us down for ${clock.short(fut(9, "10:00"))} at 10:00. Invite attached. I'll send the question list a few days before.` },
		{ me: true, at: { after: 30 }, body: `Confirmed. Talk then.` },
	]));

	const nl = who("Camille Fournier", CO.northernlights);
	out.push(...convo(ctx, { id: "speaker", box: "press", subject: "Speaker invitation: Northern Lights, March", with: nl, labels: ["Press"], unread: true }, [
		{ at: [3, "10:00"], body: `Dear Morgan,

We'd like to invite you to speak at Northern Lights in March. We're building a track about software for small and local businesses, and your name came up three times from our advisory group.

Talk length is 25 minutes plus Q&A. We cover travel and two nights' hotel, and there's a speaker fee of ${money(1500)}. Applications close in three weeks.

Camille Fournier
Programme Chair, Northern Lights` },
		{ me: true, at: { after: 500 }, body: `Camille, thank you, I'm flattered. I'd like to say yes. A few questions: what dates, and is the track the first day or the second? I travel with a family obligation in mind, so I'd rather not be gone on a weekend.` },
	]));

	out.push(...convo(ctx, { id: "award", box: "press", subject: "You've been nominated: Small Business Tech Awards", with: at(CO.sbawards, "awards", "Small Business Tech Awards"), labels: ["Press"], where: "archive" }, [
		{ at: [26, "08:00"], body: `Congratulations. Example Co has been nominated in the "Best Booking Tool" category. Winners are announced next month. Finalists receive a badge for their site and a mention in the programme.

To confirm your nomination, complete the short form by the end of next week.` },
		{ me: true, at: { after: 90 }, body: `Thanks for the nomination. Form submitted.` },
	]));

	const maker = who("Noelle Park", CO.indiefounders);
	out.push(...convo(ctx, { id: "spotlight", box: "press", subject: "Maker spotlight: can we feature Example Co?", with: maker, labels: ["Press"] }, [
		{ at: [18, "12:20"], body: `Hi Morgan,

We write Indie Founders Digest (31,000 subscribers) and run a "maker spotlight" every week. I'd love to feature you. It's six questions by email and we edit lightly. We'll send a link when it's live.

Noelle` },
		{ me: true, at: { after: 400 }, body: `Hi Noelle, I'd be glad to. Send the questions.` },
		{ at: { after: 90 }, body: `Wonderful, questions below. No rush; we've got a slot in three weeks.\n\n- What's the one decision that changed your company the most?\n- What do you wish you'd known a year ago?\n- What does a normal week look like?\n- What's a tool you couldn't live without?\n- What's next?\n- Anything else you'd like readers to know?` },
	]));

	return out;
}
