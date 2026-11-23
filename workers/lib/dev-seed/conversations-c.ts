// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: people writing to hello@ (family, friends, the landlord) and
// the mail nobody needed (chain forwards, reply-all storms, nudges, the building).

import { note } from "./automated";
import { CO, type Company, type Ctx, type Turn, at, convo, who } from "./cast";
import { type Msg, type Person, type When, card, file, md } from "./kit";

const friend = (name: string, tld: "com" | "org" | "net" = "net", local?: string): Person => ({
	name, addr: `${local ?? name.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, ".")}@mail.example.${tld}`,
});

const MOM = friend("Elena Reyes");
const DAD = friend("Ray Reyes", "org", "ray.reyes");
const JULES = friend("Jules Reyes", "com", "jules");
const PRIYA = friend("Priya Raman", "net", "priya.raman");
const DAN = friend("Dan Kessler");
const MARISOL = friend("Marisol Vega", "org");
const NATE = friend("Nate Halloran", "com");

/** A turn in a thread with several people: from `speaker` to everyone else in `group`. */
function say(group: Person[], speaker: Person | "me", when: Turn["at"], body: string, extra: Partial<Turn> = {}): Turn {
	const them = speaker === "me" ? null : speaker;
	return { me: speaker === "me", from: them ?? undefined, to: group.filter((p) => p.addr !== them?.addr), at: when, body, ...extra };
}

export function peopleThreads(ctx: Ctx): Msg[] {
	const { clock } = ctx;
	const fut = (days: number, hhmm: string) => clock.nextDay(clock.now, days, hhmm);
	const out: Msg[] = [];
	const me = ctx.me.hello;

	// Family
	const fam = [me, MOM, DAD, JULES];
	out.push(...convo(ctx, { id: "thanksgiving", box: "hello", subject: "Thanksgiving: who's bringing what", with: MOM, labels: ["Family"], unread: true, starred: true }, [
		say(fam, MOM, [9, "08:12"], `Hi my loves,

It's time to plan. Ray is doing the turkey (again). Jules, rolls. Morgan, are you still making the pie? And does anyone have an allergy I should know about?

Love, Mom

P.S. Please reply all so I don't have to forward things.`),
		say(fam, "me", { after: 140 }, `Mom, yes, pumpkin and the pecan one. No allergies on my side. What time are we eating? I'm looking at the train.`),
		say(fam, DAD, { after: 55 }, `I'm brining it this year. Do not tell your mother.\n\nR`),
		say(fam, MOM, { after: 20 }, `Ray, I can see this email.`, { quote: false }),
		say(fam, JULES, { after: 300 }, `Rolls are on me. Can I bring a friend? Her name is Cass. She's vegetarian.`),
		say(fam, MOM, { after: 90 }, `Of course! The more the merrier. I'll make the mushroom thing. Morgan, do you still have Grandma's pie crust card? I found a copy but the ink is gone.`, {
			attach: [file.text("grandmas-pie-crust.txt", "Grandma's pie crust (as copied by Mom)\n\n2 1/2 cups flour\n1 tsp salt\n1 tbsp sugar\n1 cup cold butter, cubed\n6 to 8 tbsp ice water\n\nPulse the dry things. Add butter until it looks like peas. Add water one spoon at a time.\nChill an hour. Do not overwork it. She was firm about this.\n")] }),
		say(fam, "me", { after: 600 }, `Found it, thank you. It's attached to your last message, so you have it. The train gets in at ${clock.time(fut(0, "14:40"))} the day before. Can someone pick me up?`),
		say(fam, DAD, { after: 35 }, `I'll get you. Bring a coat, it's already cold up here.`),
	]));

	const flights = [me, JULES, MOM];
	out.push(...convo(ctx, { id: "birthday", box: "hello", subject: "Flights for Mom's birthday weekend", with: JULES, labels: ["Family"] }, [
		say(flights, JULES, [30, "21:05"], `Ok, I'm pricing flights for Mom's 65th. She doesn't know. Do you want to fly in Friday night or Saturday morning? Saturday morning is cheaper by $90.`),
		say(flights, "me", { after: 80 }, `Saturday morning is fine as long as I'm there for lunch. Can you book mine too and I'll pay you back? What's the total?`),
		say(flights, JULES, { after: 45 }, `Two tickets, $412. I'll send a request. Also, Dad wants to do a dinner for 14. I told him that's absurd. He said "it's her 65th."`),
		say(flights, "me", { after: 20 }, `It is, in fairness. Let's do 14 and I'll book the room. What does Mom like?`),
		say(flights, JULES, { after: 600 }, `Anything with butter. The place on Fulton has a private room. I'll call tomorrow.`),
		say(flights, "me", [27, "12:10"], `Paid you back. Check your account. I also bought a card for the table, so don't buy one.`),
	]));

	out.push(...convo(ctx, { id: "flowers", box: "hello", subject: "The flowers!", with: MOM, labels: ["Family"], where: "archive" }, [
		{ at: [6, "17:45"], body: `Morgan,\n\nThe flowers just came. They are so beautiful. I put them on the piano. Dad says you shouldn't have, and then he took a picture.\n\nYou are a good son. Call me this weekend.\n\nMom` },
		{ me: true, at: { after: 70 }, body: `You're welcome, Mom. Happy early birthday. I'll call Sunday after lunch.` },
		{ at: { after: 8 }, body: `Sunday is perfect. Bring your appetite. XO`, quote: false },
	]));

	// Friends
	const trip = [me, MARISOL, PRIYA, DAN, NATE];
	out.push(...convo(ctx, { id: "camping", box: "hello", subject: "Camping trip: dates?", with: MARISOL, labels: ["Personal"], unread: true }, [
		say(trip, MARISOL, [4, "20:11"], `Ok people. Lake trip. It's the last good weekend before it gets cold. Which one works: the 7th or the 14th? Reply with your pick or I'm choosing for you.`),
		say(trip, DAN, { after: 6 }, `7th`),
		say(trip, PRIYA, { after: 9 }, `7th works. I can drive if someone else does snacks.`),
		say(trip, NATE, { after: 22 }, `14th. I'm at a wedding on the 7th. Sorry.`),
		say(trip, MARISOL, { after: 5 }, `Nate. Nate. Of course.`, { quote: false }),
		say(trip, "me", { after: 60 }, `I can do either. Whichever gets the most people. Can we do the 14th and Nate drives?`),
		say(trip, NATE, { after: 12 }, `I don't have a car that goes on dirt.`, { quote: false }),
		say(trip, DAN, { after: 4 }, `I have a car that goes on dirt. 14th. Fine. I'm in.`, { quote: false }),
		say(trip, PRIYA, { after: 33 }, `14th it is then. Marisol, are we reserving the lakeside site or the one with the bathroom?`),
		say(trip, MARISOL, { after: 15 }, `Bathroom. We're adults now. Booked. I'll send the confirmation.`, {
			attach: [file.ics("camping-lake.ics", { uid: "camp", start: fut(10, "15:00"), end: fut(12, "11:00"), summary: "Camping at the lake", location: "Pine Lake campground, site 14", organizer: MARISOL, attendee: me, clock, method: "PUBLISH" })] }),
	]));

	const gabe = friend("Gabe Ortiz", "com");
	const wedding = [me, MARISOL];
	out.push(...convo(ctx, { id: "wedding", box: "hello", subject: "Save the date: Marisol and Gabe", with: MARISOL, labels: ["Personal"], where: "archive" }, [
		say(wedding, MARISOL, [41, "09:30"], `Morgan! We're getting married. Save the date, and the real invitation will follow. We want you there. Gabe says hi.`, {
			attach: [file.pdf("save-the-date.pdf", [{ t: "Marisol Vega and Gabe Ortiz", size: 22, bold: true }, { t: "are getting married", size: 14, gap: 10 }, { t: "Saturday, in late spring, at the Orchard House", gap: 30 }, { t: "Invitation to follow. Sample document for development only.", gap: 20 }])] }),
		say(wedding, "me", { after: 55 }, `MARISOL. Congratulations to both of you. I'm so happy. I'll be there, wild horses and all. Tell Gabe he did well.`),
		say(wedding, MARISOL, { after: 2000 }, `He says he knows. Question: are you bringing a plus one? Our caterer needs a number in a few weeks.`),
		say(wedding, "me", { after: 90 }, `Probably just me, but I'll confirm when the invitation arrives. Thank you for asking early.`),
		{ at: { after: 600 }, from: gabe, to: [me], body: `Morgan, Gabe here (on Marisol's account, don't tell her). There's a hotel block at the Orchard Inn. It closes a month before the wedding, so book soon. I'll send the link when we have it.\n\nG`, quote: false },
	]));

	const ellis = friend("Ellis Park", "org", "ellis.park");
	out.push(...convo(ctx, { id: "roommate", box: "hello", subject: "Long time!", with: ellis, labels: ["Personal"] }, [
		{ at: [12, "22:15"], body: `Morgan Reyes. It's Ellis. Your roommate in the house with the broken oven. I saw your name on a piece about booking software and thought, that has to be the same guy who ate cereal for dinner for a year.\n\nHow are you? I'm in Portland now with two cats and a job I'm not sure I like. Would love to catch up.` },
		{ me: true, at: { after: 400 }, body: `Ellis!! Yes, same guy, same cereal. I think about the oven all the time. I'm in Springfield, running a small software company, which means I eat at my desk and the cereal has become a lifestyle.\n\nCats! Tell me everything. Send photos. Do you ever get east? I owe you a dinner for the time you covered my half of rent.` },
		{ at: { after: 1900 }, body: `I get east for a conference in the spring. Dinner, yes. Rent, no, I forgave that in 2014.\n\nHere's one of the cats (Pickle) for evidence.`, attach: [file.svg("pickle-the-cat.svg", "Pickle's weight (lb), by month", [9, 9.4, 9.8, 10.2, 10.1, 10.9, 11.2, 11.6], "#b0457f")] },
		{ me: true, at: { after: 55 }, body: `Pickle looks like an executive. Spring it is. I'll send you my number and you can send me yours.` },
	]));

	const rosalind = who("Rosalind Aguilar", { name: "Aguilar Advisory", domain: "aguilaradvisory.example.com", color: "#2e8b84" });
	out.push(...convo(ctx, { id: "mentor", box: "hello", subject: "Coffee when you're back?", with: rosalind, labels: ["Personal"] }, [
		{ at: [19, "08:40"], body: `Morgan, you've been quiet, which usually means you're busy or stuck. Coffee? I'm free ${clock.short(fut(3, "00:00"))} or the week after.\n\nRosalind` },
		{ me: true, at: { after: 120 }, body: `Both, honestly. Busy and a bit stuck on pricing. I'd love to. ${clock.short(fut(3, "00:00"))} at 9?` },
		{ at: { after: 45 }, body: `9 works. The usual place. Bring your pricing page and your three worst customers.`, quote: false },
	]));

	const ref = who("Hana Mitchell", { name: "Mitchell Studio", domain: "mitchellstudio.example.org", color: "#7a5a3a" });
	out.push(...convo(ctx, { id: "reference", box: "hello", subject: "Reference for a job?", with: ref, labels: ["Personal"], where: "archive" }, [
		{ at: [37, "14:12"], body: `Hi Morgan, I'm applying for a design lead role and they asked for two references. You worked with me on the intake form redesign. Would you be one? It's mostly a 15-minute call.` },
		{ me: true, at: { after: 95 }, body: `Absolutely. You did excellent work on that and the clinics still mention the new form. Send me the recruiter's name and I'll make time this week.` },
		{ at: { after: 140 }, body: `Thank you!! The recruiter is Kim at Larkspur Studio. She'll email you.\n\nI owe you lunch.` },
	]));

	const landlord = who("Walter Greaves", CO.maplecourt);
	out.push(...convo(ctx, { id: "lease", box: "hello", subject: "Lease renewal for next year", with: landlord, labels: ["Personal"] }, [
		{ at: [21, "10:00"], attach: [file.pdf("lease-renewal-offer.pdf", [
			{ t: "Maple Court Apartments", size: 18, bold: true }, { t: "Lease renewal offer, Unit 4B", size: 13, gap: 4 },
			{ t: "Term: 12 months", gap: 18 }, { t: "Monthly rent: $2,140 (currently $1,990)", gap: 4 }, { t: "Deposit: unchanged" }, { t: "Renewal must be signed within 30 days of this notice.", gap: 14 },
			{ t: "Sample document for development only.", gap: 30 },
		])], body: `Hi Morgan,\n\nYour lease ends soon. The renewal offer is attached. Rent goes up to $2,140 because of the new roof and boiler. Please sign and return within 30 days.\n\nWalter Greaves\nMaple Court Apartments` },
		{ me: true, at: { after: 1500 }, body: `Hi Walter, thanks for sending this. A $150 increase is steep: that's 7.5%. I've been a tenant for five years and have never paid late. Would you consider $2,050? I'm happy to sign for 18 months if that helps.` },
		{ at: { after: 2900 }, body: `Morgan, 18 months is useful to me. I can do $2,075 for 18 months. That's the lowest I can go with the boiler loan.` },
		{ me: true, at: { after: 400 }, body: `Deal at $2,075 for 18 months. Can you send the new version?` },
		{ at: { after: 600 }, attach: [file.pdf("lease-renewal-18-months.pdf", [{ t: "Maple Court Apartments", size: 18, bold: true }, { t: "Lease renewal, Unit 4B, 18 months at $2,075", gap: 12 }, { t: "Sample document for development only.", gap: 30 }])], body: `Attached. Sign and return when you can. Thank you for being a good tenant.` },
	]));

	const neighbor = friend("Mei Lin", "org", "mei.lin");
	out.push(...convo(ctx, { id: "package", box: "hello", subject: "Your package ended up at my door", with: neighbor, labels: ["Personal"], where: "archive" }, [
		{ at: [15, "18:20"], body: `Hi, it's Mei from 4C. The delivery guy left a box addressed to you at my door. It's on your mat now. Hope that's ok!` },
		{ me: true, at: { after: 25 }, body: `Thank you, Mei, I just found it. I owe you a coffee. I'm sorry about that.` },
		{ at: { after: 3 }, body: `Anytime!`, quote: false },
	]));

	return out;
}

export function nonsenseThreads(ctx: Ctx): Msg[] {
	const { clock, r } = ctx;
	const out: Msg[] = [];
	const me = ctx.me.hello;

	// Dad's chain letter, answered gently, then Mom
	const chain = [me, DAD, MOM];
	out.push(...convo(ctx, { id: "chain", box: "hello", subject: "Fwd: Fwd: Fwd: FW: READ THIS BEFORE FRIDAY!!!", with: DAD, labels: ["Family"], unread: true }, [
		say(chain, DAD, [2, "07:55"], `Forwarded as received. Please read.\n\n---------- Forwarded message ----------\n\n> From: Dolores\n> THIS IS REAL. Starting Friday the social network will begin charging $4.99 a month for accounts. To keep your account free, copy this message and post it on your wall. The lawyers have confirmed it. Do not ignore!!!\n\nJust in case. Dad`),
		say(chain, "me", { after: 130 }, `Hi Dad, thanks for looking out. That one's been going around for years and it isn't real. You can skip it. If you're ever not sure, send it to me and I'll check before you post anything.`),
		say(chain, DAD, { after: 40 }, `Ok but what if it IS real this time.\n\nR`),
		say(chain, MOM, { after: 15 }, `Ray. We talked about this. Morgan is right. Please stop forwarding.`, { quote: false }),
		say(chain, DAD, { after: 8 }, `Fine. Forwarded this one anyway because it's about sun exposure.`),
	]));

	// A reply-all storm on a conference list
	const list = at(CO.northernlights, "attendees", "Northern Lights Attendees");
	const strangers: [string, string, string][] = [
		["Please remove me from this list.", "Pat Donnelly", "orchardmedia.example.org"],
		["Remove me too. I never signed up for this.", "Aisha Karim", "tidepool.example.net"],
		["STOP REPLYING ALL", "Doug Bevan", "atlas.example.com"],
		["Please don't reply all. Just email the organisers.", "Naoko Sasaki", "juniper.example.com"],
		["Unsubscribe", "Frank Dutta", "okaforlind.example.net"],
		["If you reply all asking to be removed, you're the problem.", "Elaine Wright", "redwood.example.org"],
		["Whoever started this, I hope you're proud.", "Dev Anand", "larkspur.example.org"],
		["Remove me from this list please", "Rick Hollis", "copperline.example.net"],
		["This is not the unsubscribe address!!", "Pat Donnelly", "orchardmedia.example.org"],
		["Hello! Can the organisers confirm I can still get the group rate? Sorry if this is the wrong place.", "Jo-Ann Lau", "quillink.example.org"],
	];
	const stormTurns: Turn[] = [
		{ at: [11, "09:02"], from: at(CO.northernlights, "welcome", "Northern Lights Team"), body: `Welcome to the Northern Lights attendee list. You can use this address to meet other attendees before the conference. Please keep the list friendly. To unsubscribe, use the link at the bottom of any message.`, cc: [list] },
		...strangers.map(([body, name, domain], i): Turn => ({ at: { after: i === 0 ? 38 : r.int(3, 55) }, from: { name, addr: `${name.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "")}@${domain}` }, cc: [list], body, quote: false })),
	];
	out.push(...convo(ctx, { id: "storm", box: "hello", subject: "Welcome to the Northern Lights attendee list!", with: at(CO.northernlights, "welcome", "Northern Lights Team"), where: "archive" }, stormTurns));

	// Pre-read for the pre-read
	const preston = who("Preston Vale", CO.tessera);
	out.push(...convo(ctx, { id: "synergy", box: "hello", subject: "Alignment sync: pre-read for the pre-read", with: preston, labels: ["Follow up"] }, [
		{ at: [8, "10:05"], body: `Hi Morgan,\n\nCircling back to socialise a few thoughts ahead of Thursday's alignment sync. To maximise the value of our time, I've attached a pre-read for the pre-read. The goal is to capture synergies across our respective go-to-market motions and ensure we're leaning into the partnership.\n\nPlease come ready to double-click on the key learnings.\n\nPreston Vale\nDirector, Strategic Partnerships\nTessera Database`, attach: [file.pdf("pre-read-for-the-pre-read.pdf", [{ t: "Alignment: pre-read", size: 20, bold: true }, { t: "Objective: align on alignment.", gap: 12 }, { t: "Agenda: 1. Level-set. 2. Re-baseline. 3. Next steps (TBD).", gap: 8 }, { t: "Sample document for development only.", gap: 30 }])] },
		{ me: true, at: { after: 200 }, body: `Hi Preston, thanks. Before Thursday: could you send the agenda, and tell me what decision you want from me? I want to be useful.` },
		{ at: { after: 1500 }, body: `Great question, Morgan. The agenda is evolving, and we'll socialise it live. The decision we're looking for is a directional green light on the partnership framework.\n\nLooking forward to it!` },
		{ me: true, at: { after: 120 }, body: `What's in the framework? I haven't seen a draft.` },
		{ at: { after: 2900 }, body: `Totally hear you. We're finalising the framework off the back of Thursday's sync. Happy to hop on a quick call to align on how to align. 15 minutes? I'll send a few times.` },
	]));

	// The ladder of follow-ups
	const brooke = who("Brooke Whitlock", CO.tessera);
	const ladder = [
		["Checking in on your Tessera trial", `Hi Morgan,\n\nI noticed you signed up for a Tessera trial and haven't connected a database yet. Can I help you get started? I'd love to show you a 20-minute walkthrough.\n\nBrooke, Customer Success`],
		["Re: Checking in on your Tessera trial", `Hi Morgan, just bumping this to the top of your inbox. Is a walkthrough something that would be helpful?`],
		["Re: Checking in on your Tessera trial", `Hi Morgan, is this still a priority for you? If now isn't the right time, let me know and I'll circle back next quarter.`],
		["Should I close your file?", `Morgan, I haven't heard back, so I'm assuming you've found another solution. I'll close your file. If I'm wrong, reply with "still here" and I'll reopen it.\n\nWishing you the best,\nBrooke`],
	] as const;
	let t = clock.at([22, "11:00"]);
	for (const [i, [subject, body]] of ladder.entries()) {
		out.push(note(ctx, { key: `ladder-${i + 1}`, box: "hello", from: brooke, at: t, thread: "ladder-1", replyTo: i ? `ladder-${i}` : undefined, subject, html: md(body), auto: false, read: i < 3 }));
		t += (i === 0 ? 4 : i === 1 ? 5 : 8) * 86_400_000;
	}

	// A friend of a friend with an opportunity
	const brittany = friend("Brittany Cole", "com", "brittany.cole");
	out.push(...convo(ctx, { id: "wellness", box: "hello", subject: "Hey stranger! Quick question", with: brittany, labels: ["Personal"], where: "archive" }, [
		{ at: [28, "19:40"], body: `Morgan!!! It's been forever. I saw you're doing so well with your company. I'm partnering with a wellness brand and I think you'd be amazing at it. It's flexible, you set your own hours. Do you have 10 minutes for a quick call this week? No pressure!!!` },
		{ me: true, at: { after: 180 }, body: `Hi Brittany, thanks for thinking of me. I'm heads down at work and not looking for a side business right now. Good luck with it.` },
		{ at: { after: 1300 }, body: `Totally get it!! But this isn't a side business, it's a lifestyle. Our top people are earning 6 figures from home. At least let me send you the info?` },
		{ me: true, at: { after: 90 }, body: `I appreciate it, but it's a no from me. Please take me off your list.` },
		{ at: { after: 4300 }, body: `No hard feelings! If you change your mind, my door is always open. Also would you like to try our lavender oil? It's amazing for stress.` },
	]));

	// The building
	const building = at(CO.maplecourt, "residents", "Maple Court Residents");
	const gloria = who("Gloria Tran", CO.maplecourt);
	const walt = who("Walt Pruitt (3A)", CO.maplecourt);
	const mei = who("Mei Lin (4C)", CO.maplecourt);
	const kai = who("Kai Berger (5B)", CO.maplecourt);
	const bgroup = [me, building];
	out.push(...convo(ctx, { id: "recycling", box: "hello", subject: "Recycling room (again)", with: gloria, where: "archive" }, [
		say(bgroup, gloria, [13, "08:05"], `Dear residents,\n\nThe recycling room has been left in a state again this week. Cardboard must be flattened. Glass must not go in the paper bin. Please take care of the shared space.\n\nGloria Tran\nBuilding Manager`),
		say(bgroup, walt, { after: 90 }, `To whoever keeps putting wet pizza boxes in the paper bin: it isn't recycling, it's a crime scene.`),
		say(bgroup, kai, { after: 40 }, `I flatten my boxes every time. I feel personally accused.`),
		say(bgroup, walt, { after: 25 }, `Nobody accused you, Kai.`, { quote: false }),
		say(bgroup, kai, { after: 12 }, `You said "whoever keeps".`, { quote: false }),
		say(bgroup, mei, { after: 300 }, `Can we please not reply all about this. Gloria, could you put a sign up with a picture instead.`),
		say(bgroup, gloria, { after: 70 }, `A sign has been ordered. Please note that all residents are subject to the recycling policy in your lease, section 14.`),
		say(bgroup, "me", { after: 40 }, `Not me, but I'll take the extra boxes down tonight. Thanks, Gloria.`),
		say(bgroup, walt, { after: 20 }, `Thanks, Morgan. At least one person here is reasonable.`),
	]));

	// Marketing nobody asked for
	const lw = at(CO.linkwise, "notifications", "Linkwise");
	const lwList = { id: `notifications.${CO.linkwise.domain}`, unsubscribe: `https://${CO.linkwise.domain}/unsubscribe` };
	const lwMessages: [When, string, string][] = [
		[[3, "06:15"], "Congratulations on your work anniversary, Morgan!", "Say congrats to yourself. 6 years at Example Co."],
		[[5, "07:30"], "You appeared in 9 searches this week", "See who's looking. Upgrade to Linkwise Premium to find out."],
		[[9, "07:30"], "You appeared in 11 searches this week", "Your profile is getting attention. See the list with Premium."],
		[[12, "08:00"], "Priya Raman endorsed you for Email", "Endorse Priya back? Skills are optional and meaningless."],
		[[16, "07:30"], "You appeared in 4 searches this week", "That's fewer than last week. Don't let your profile go cold."],
		[[20, "09:10"], "5 jobs you might like", "Senior Prompt Engineer. Head of Vibes. Chief Alignment Officer."],
	];
	for (const [i, [when, subject, body]] of lwMessages.entries()) {
		out.push(note(ctx, { key: `linkwise-${i + 1}`, box: "hello", from: lw, at: clock.at(when), subject, list: lwList, labels: ["Newsletters"],
			html: card({ brand: "Linkwise", color: CO.linkwise.color, body: `<h2 style="margin:0 0 8px;font-size:20px">${subject}</h2><p>${body}</p><p style="margin:20px 0"><a href="https://${CO.linkwise.domain}/u" style="display:inline-block;background:${CO.linkwise.color};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">See more</a></p>`, footer: `You are receiving Linkwise notification emails. <a href="https://${CO.linkwise.domain}/unsubscribe">Unsubscribe</a>.` }) }));
	}
	const surveys: [string, Company, When][] = [
		["How did we do? (1 minute survey)", CO.cobalt, [4, "15:00"]],
		["Tell us about your recent experience", CO.sojourn, [14, "11:00"]],
		["Rate your support interaction", CO.tasklane, [26, "16:30"]],
	];
	for (const [i, [subject, company, when]] of surveys.entries()) {
		out.push(note(ctx, { key: `survey-${i + 1}`, box: "hello", from: at(company, "feedback"), at: clock.at(when), subject, folder: "trash", read: true,
			html: md(`Hi Morgan,\n\nYour feedback helps us improve. It takes less than a minute.\n\n[Take the survey](https://${company.domain}/survey/${i + 1})`) }));
	}
	return out;
}
