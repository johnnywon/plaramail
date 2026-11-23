// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Alex's own mailboxes: alex@ (food, a keyboard, a friend, an agency client)
// and league@ (the Sunday Deploy League, eight friends, half-PPR).

import { esc, file, money } from "../kit";
import { SIGNERS, button, mail, para, rows } from "./brands";
import { P, alex, box } from "./cast";
import type { StoryClock } from "./clock";
import { human, photo, photoFile, photoPart, prose } from "./html";
import type { Slot } from "./slots";

const h3 = (text: string) => `<h3 style="margin:22px 0 4px;font-family:'Arial Narrow',Arial,sans-serif;font-size:18px;line-height:24px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase">${esc(text)}</h3>`;

// ── Food orders ─────────────────────────────────────────────────────

export interface Order {
	id: string;
	restaurant: string;
	items: [string, number][];
	tax: number;
	delivery: number;
	service: number;
	tip: number;
}

const cents = (n: number) => Math.round(n * 100);
export const orderFood = (o: Order) => o.items.reduce((s, [, v]) => s + cents(v), 0) / 100;
export const orderTotal = (o: Order) => (cents(orderFood(o)) + cents(o.tax) + cents(o.delivery) + cents(o.service) + cents(o.tip)) / 100;

export const RICE_BOWL: Order = { id: "UE-73102", restaurant: "Hana Rice House", items: [["Teriyaki chicken rice bowl", 9.95], ["Sparkling yuzu soda", 2.0]], tax: 1.06, delivery: 1.99, service: 0.87, tip: 3.0 };
export const BURRITO: Order = { id: "UE-73419", restaurant: "Night Owl Burrito Co.", items: [["Red chile pork burrito", 11.5], ["Chips and salsa", 2.0]], tax: 1.2, delivery: 2.99, service: 1.5, tip: 4.0 };

function orderRows(o: Order, totalLabel: string) {
	return rows("ubereats", [
		...o.items.map(([name, price]) => [`1 × ${name}`, money(price)] as [string, string]),
		["Subtotal", money(orderFood(o)), "muted"],
		["Tax", money(o.tax), "muted"],
		["Delivery fee", money(o.delivery), "muted"],
		["Service fee", money(o.service), "muted"],
		["Tip", money(o.tip), "muted"],
		[totalLabel, money(orderTotal(o)), "total"],
	], 24);
}

const uberFooter = `Order updates for Alex Rivera. For help with an order, open it in the app and choose Help. <a href="https://www.ubereats.com/privacy" style="color:#5E5E5E">Privacy</a>`;

// ── The league ──────────────────────────────────────────────────────

export const TEAMS = {
	alex: "Bye Week Deployers",
	priya: "Merge Conflict",
	ben: "Fourth and Long Polling",
	jordan: "Emoji End Zone",
	maya: "Sunday Screenshots",
	theo: "Cache Me Outside",
	nia: "Red Zone Requests",
	sam: "The Waiver Workers",
} as const;
export type Manager = keyof typeof TEAMS;
const NAMES: Record<Manager, string> = { alex: "Alex", priya: "Priya", ben: "Ben", jordan: "Jordan", maya: "Maya", theo: "Theo", nia: "Nia", sam: "Sam" };

type Game = [Manager, number, Manager, number];
/** Three Sundays of head-to-head results, first named team at home. Fictional scoring. */
export const ROUNDS: { day: string; games: Game[] }[] = [
	{ day: "2026-09-27", games: [["alex", 112.4, "ben", 108.6], ["priya", 120.2, "jordan", 115.8], ["theo", 104.6, "maya", 99.8], ["nia", 123.4, "sam", 118.0]] },
	{ day: "2026-10-04", games: [["priya", 128.1, "alex", 97.6], ["ben", 119.2, "maya", 101.0], ["jordan", 110.3, "nia", 109.9], ["sam", 111.2, "theo", 106.8]] },
	{ day: "2026-10-11", games: [["alex", 131.7, "jordan", 130.9], ["nia", 114.6, "priya", 102.4], ["ben", 117.3, "theo", 111.0], ["maya", 120.0, "sam", 116.8]] },
];

export interface Standing { who: Manager; w: number; l: number; pf: number }

/** Standings after the first `n` rounds: wins, then points for. */
export function standings(n: number): Standing[] {
	const table = new Map<Manager, Standing>((Object.keys(TEAMS) as Manager[]).map((who) => [who, { who, w: 0, l: 0, pf: 0 }]));
	for (const { games } of ROUNDS.slice(0, n)) {
		for (const [a, as, b, bs] of games) {
			const A = table.get(a)!;
			const B = table.get(b)!;
			A.pf = Math.round((A.pf + as) * 10) / 10;
			B.pf = Math.round((B.pf + bs) * 10) / 10;
			if (as > bs) { A.w++; B.l++; } else { B.w++; A.l++; }
		}
	}
	return [...table.values()].sort((x, y) => y.w - x.w || y.pf - x.pf);
}

const pts = (n: number) => n.toFixed(1);

const TEAM_COLORS: Record<Manager, string> = { alex: "#286B45", priya: "#4E6E9E", ben: "#D66B2D", jordan: "#E7B54A", maya: "#B0457F", theo: "#2454A4", nia: "#C8372D", sam: "#5F6B74" };

/** A team's badge: its initials in its colour. Original, no franchise marks. */
export function teamBadge(who: Manager, size = 22): string {
	const initials = TEAMS[who].replace(/^The /, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="19" fill="${TEAM_COLORS[who]}"/><text x="20" y="25.5" font-family="Arial,sans-serif" font-size="15" font-weight="700" text-anchor="middle" fill="#FFF9E9">${initials}</text></svg>`;
	return `<img src="data:image/svg+xml;base64,${btoa(svg)}" width="${size}" height="${size}" alt="" style="display:inline-block;vertical-align:middle;border:0;margin-right:8px">`;
}

function scoreboard(games: Game[]): string {
	return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:12px 0;font-size:14px;font-variant-numeric:tabular-nums">${games.map(([a, as, b, bs]) => {
		const aw = as > bs;
		const side = (who: Manager, s: number, won: boolean, last: boolean) => `<td style="padding:7px 0;${last ? "border-bottom:1px solid #D6D6D6;padding-bottom:12px;" : ""}${won ? "font-weight:700;color:#14223B" : "color:#69758A"}${who === "alex" ? ";background:#F3EBD3" : ""}">${teamBadge(who)}${esc(TEAMS[who])} <span style="font-weight:400;color:#69758A">${NAMES[who]}</span></td><td align="right" style="padding:7px 4px 7px 8px;${last ? "border-bottom:1px solid #D6D6D6;padding-bottom:12px;" : ""}${won ? "font-weight:700;color:#14223B" : "color:#69758A"}${who === "alex" ? ";background:#F3EBD3" : ""}">${pts(s)}</td>`;
		return `<tr>${side(a, as, aw, false)}</tr><tr>${side(b, bs, !aw, true)}</tr>`;
	}).join("")}</table>`;
}

function table(n: number): string {
	const head = (t: string, right = false) => `<td${right ? ' align="right"' : ""} style="padding:6px 0;border-bottom:1px solid #3A3A3A;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;color:#69758A">${t}</td>`;
	const cell = (t: string, who: Manager, right = false) => `<td${right ? ' align="right"' : ""} style="padding:7px ${right ? "4px" : "0"} 7px ${right ? "8px" : "0"};border-bottom:1px solid #D6D6D6;${who === "alex" ? "font-weight:700;background:#F3EBD3;" : ""}">${t}</td>`;
	return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:12px 0;font-size:14px;font-variant-numeric:tabular-nums"><tr>${head("#")}${head("Team")}${head("W–L", true)}${head("PF", true)}</tr>${standings(n).map((s, i) =>
		`<tr>${cell(String(i + 1), s.who)}${cell(`${teamBadge(s.who, 18)}${esc(TEAMS[s.who])}`, s.who)}${cell(`${s.w}–${s.l}`, s.who, true)}${cell(pts(s.pf), s.who, true)}</tr>`).join("")}</table>`;
}

const leagueList = { id: "recaps.sundaydeployleague.com", unsubscribe: "https://sundaydeployleague.com/settings/email" };
const leagueFooter = `Sunday Deploy League recaps for league@alexrivera.me. Photo: illustrative college football. <a href="https://sundaydeployleague.com/settings/email" style="color:#69758A">Email settings</a>`;

// ── alex@ ──────────────────────────────────────────────────────────

function personal(c: StoryClock): Slot[] {
	return [
		{
			key: "A-01", box: "personal", folder: "archive", at: "2026-10-01T22:18", from: P.ubereats, to: [box("personal")],
			subject: `Order ${RICE_BOWL.id} confirmed`, read: true, labels: ["Personal", "Receipts"], thread: "A-01", auto: true,
			html: mail("ubereats", {
				preheader: `${RICE_BOWL.restaurant} is preparing your order. Arriving around 10:52 PM.`,
				eyebrow: `Order ${RICE_BOWL.id} · ${c.day("2026-10-01")}`,
				heading: "Your order is confirmed",
				body: `${para("ubereats", `<strong>${esc(RICE_BOWL.restaurant)}</strong> is preparing your order.`)}
${rows("ubereats", [["Estimated arrival", "10:52 PM", "total"]], 20)}
${orderRows(RICE_BOWL, "Total")}
${button("ubereats", "Track your order", `https://www.ubereats.com/orders/${RICE_BOWL.id}`)}`,
				footer: uberFooter,
			}),
		},
		{
			key: "A-02", box: "personal", folder: "archive", at: "2026-10-01T22:46", from: P.ubereats, to: [box("personal")],
			subject: `A small substitution for ${RICE_BOWL.id}`, read: true, thread: "A-01", replyTo: "A-01", auto: true,
			html: mail("ubereats", {
				preheader: "Sparkling yuzu soda was swapped for sparkling lemon soda. Same price.",
				eyebrow: `Order ${RICE_BOWL.id}`,
				heading: "One item was substituted",
				body: `${para("ubereats", `${esc(RICE_BOWL.restaurant)} was out of <strong>Sparkling yuzu soda</strong>, so your courier picked up <strong>Sparkling lemon soda</strong> at the same price.`)}
${rows("ubereats", [["Your total", `${money(orderTotal(RICE_BOWL))} (unchanged)`, "total"]], 20)}`,
				footer: uberFooter,
			}),
		},
		{
			key: "A-03", box: "personal", folder: "archive", at: "2026-09-30T14:11", from: P.keyforge, to: [box("personal")],
			subject: "Your backlit keyboard has shipped", read: true, labels: ["Shopping"], thread: "A-03", auto: true,
			attachments: [photoPart("keyboard", "keyforgekeys.com"), photoFile("keyboard")],
			html: mail("keyforge", {
				preheader: `Order KF-20931 is on its way. Estimated delivery ${c.day("2026-10-02")}.`,
				eyebrow: "Order KF-20931",
				heading: "Your keyboard is on its way",
				body: `${photo("keyboard", "keyforgekeys.com", "A backlit mechanical keyboard", "Photo", 220, 8)}
<div style="height:16px"></div>
${rows("keyforge", [["Backlit mechanical keyboard", money(89)], ["Shipping", "Free", "muted"], ["Tax", money(5.34), "muted"], ["Total", money(94.34), "total"]], 18)}
${rows("keyforge", [["Carrier", "Parcel ground"], ["Tracking", "KF20931-77Q"], ["Estimated delivery", `Friday, ${c.day("2026-10-02")}`]])}
${button("keyforge", "Track your package", "https://keyforgekeys.com/orders/KF-20931")}`,
				footer: "Keyforge Keys · support@keyforgekeys.com · Returns are free within 30 days of delivery.",
			}),
		},
		{
			key: "A-04", box: "personal", folder: "archive", at: "2026-10-09T01:16", from: P.ubereats, to: [box("personal")],
			subject: `Order ${BURRITO.id} confirmed`, read: true, labels: ["Personal", "Receipts"], thread: "A-04", auto: true,
			attachments: [photoPart("food-burrito", "ubereats.com")],
			html: mail("ubereats", {
				preheader: `${BURRITO.restaurant} is preparing your order. Arriving around 1:51 AM.`,
				eyebrow: `Order ${BURRITO.id} · ${c.day("2026-10-09")}`,
				heading: "Your order is confirmed",
				body: `${photo("food-burrito", "ubereats.com", "A burrito cut in half on a plate, with two cups of salsa", "Menu photo", 220, 0)}
<div style="height:18px"></div>
${para("ubereats", `<strong>${esc(BURRITO.restaurant)}</strong> is preparing your order.`)}
${rows("ubereats", [["Estimated arrival", "1:51 AM", "total"]], 20)}
${orderRows(BURRITO, "Estimated total")}
${button("ubereats", "Track your order", `https://www.ubereats.com/orders/${BURRITO.id}`)}`,
				footer: uberFooter,
			}),
		},
		{
			key: "A-05", box: "personal", folder: "archive", at: "2026-10-09T01:48", from: P.ubereats, to: [box("personal")],
			subject: `Delivered — your receipt for ${BURRITO.id}`, read: true, thread: "A-04", replyTo: "A-04", auto: true,
			attachments: [photoPart("food-burrito", "ubereats.com"), file.pdf(`${BURRITO.id}-receipt.pdf`, [
				{ t: "Uber Eats", size: 20, bold: true },
				{ t: "Receipt", size: 14, gap: 4 },
				{ t: `Order ${BURRITO.id}`, bold: true, gap: 18 },
				{ t: `Restaurant: ${BURRITO.restaurant}`, gap: 4 },
				{ t: `Delivered: ${c.date("2026-10-09")} at 1:48 AM` },
				{ t: "Customer: Alex Rivera" },
				...BURRITO.items.map(([name, price], i) => ({ t: `${name}: ${money(price)}`, gap: i ? 0 : 16 })),
				{ t: `Food: ${money(orderFood(BURRITO))}`, gap: 10 },
				{ t: `Tax: ${money(BURRITO.tax)}` },
				{ t: `Delivery fee: ${money(BURRITO.delivery)}` },
				{ t: `Service fee: ${money(BURRITO.service)}` },
				{ t: `Tip: ${money(BURRITO.tip)}` },
				{ t: `Total charged: ${money(orderTotal(BURRITO))}`, bold: true, gap: 6 },
				{ t: "One charge. This receipt is the final amount for the order confirmed at 1:16 AM.", gap: 16 },
			], { band: "#111111", rule: "#E2E2E2" })],
			html: mail("ubereats", {
				preheader: `Delivered at 1:48 AM. You paid ${money(orderTotal(BURRITO))}.`,
				eyebrow: `Order ${BURRITO.id} · ${c.day("2026-10-09")}`,
				heading: "Your order was delivered",
				body: `${photo("food-burrito", "ubereats.com", "A burrito cut in half on a plate, with two cups of salsa", "Menu photo", 220, 0)}
<div style="height:18px"></div>
${para("ubereats", "Delivered at <strong>1:48 AM</strong>. The total matches your order confirmation; there is no second charge.")}
${orderRows(BURRITO, "Total charged")}
${para("ubereats", "Your receipt is attached as a PDF.", "margin-top:14px")}`,
				footer: uberFooter,
			}),
		},
		{
			key: "A-06", box: "personal", folder: "inbox", at: "2026-10-10T11:22", from: P.maya, to: [box("personal")],
			subject: "Coffee tomorrow if you've finished saving the internet?", read: false, labels: ["Personal"], thread: "A-06",
			attachments: [photoFile("coffee", "coffee.jpg")],
			html: prose(`Alex!

Priya says you were up until three on Thursday night fixing the internet. Hero behavior, terrible sleep schedule.

Coffee tomorrow? I'm thinking 10:30 at Larch & Pine on Fulton Street, the one with the window seats. My treat if you promise to check your phone no more than twice. Attached: a picture of coffee, in case you need a reason to get out of bed.

Also, congratulations in advance on losing to Jordan this week.

Maya`),
		},
		{
			key: "A-07", box: "personal", folder: "inbox", at: "2026-10-09T10:00", from: P.mara, to: [box("personal")],
			subject: "Can we still review the migration this morning?", read: true, starred: true, labels: ["Clients"], thread: "A-07",
			html: human(`Hi Alex,

We have the migration review on the calendar for 11 today. I saw your note that you were up most of the night with an outage, so I wanted to check before my team joins.

If today is too much, could we move it? I'd still like the review before our content freeze on ${c.day("2026-10-16")}. Monday or Tuesday morning works on our side.

The staging site went up on Wednesday, and the redirect list is as we left it last week.

Mara`, SIGNERS.mara),
		},
		{
			key: "A-08", box: "personal", folder: "draft", at: "2026-10-09T10:32", from: alex("personal"), to: [P.mara],
			subject: "Re: Can we still review the migration this morning?", read: true, labels: ["Clients"], thread: "A-07", replyTo: "A-07",
			draftNotes: { origin: "auto-draft", agent: null, instructions: [] },
			quote: "If today is too much, could we move it?",
			html: human(`Hi Mara,

Thanks for checking. Today is too tight after last night. Could we move the review to Tuesday, ${c.day("2026-10-13")} at 10:00?

Priya, who works with me on Partwell, can check the redirect list against staging first, so Tuesday's call can focus on what she finds. I'll confirm the rest of the schedule after that review rather than guess at it now.

Alex`),
		},
	];
}

// ── league@ ────────────────────────────────────────────────────────

function league(c: StoryClock): Slot[] {
	const [r1, r2, r3] = ROUNDS;
	const everyone = [box("league"), P.priya, P.ben, P.maya, P.theo, P.nia, P.sam];
	const r2s = Object.fromEntries(r2.games.flatMap(([a, as, b, bs]) => [[a, pts(as)], [b, pts(bs)]])) as Record<Manager, string>;
	return [
		{
			key: "L-01", box: "league", folder: "inbox", at: "2026-09-22T18:40", from: P.jordan, to: everyone,
			subject: "Sunday Deploy League: you're in 🏈", read: true, starred: true, labels: ["Fantasy"], thread: "L-01",
			attachments: [photoPart("football-stadium", "sundaydeployleague.com")],
			html: `${prose(`WELCOME TO THE SUNDAY DEPLOY LEAGUE 🏈🎉🚀

Eight teams, half-PPR, head-to-head, and absolutely zero mercy 😤🔥`)}${photo("football-stadium", "sundaydeployleague.com", "A college football game seen from the stands", undefined, 180)}<div style="height:12px"></div>${prose(`The teams:

- ${TEAMS.alex} (Alex)
- ${TEAMS.priya} (Priya)
- ${TEAMS.ben} (Ben)
- ${TEAMS.jordan} (me, obviously 😎)
- ${TEAMS.maya} (Maya)
- ${TEAMS.theo} (Theo)
- ${TEAMS.nia} (Nia)
- ${TEAMS.sam} (Sam)

Round 1 is Sunday, ${c.day(r1.day)} 🗓️ Lineups lock Thursday at 8 pm ⏰🔒

Round 1 matchups:

- Alex vs Ben
- Priya vs Jordan
- Theo vs Maya
- Nia vs Sam

Scoring is half-PPR: half a point per catch. Trash talk is full PPR 💬💯

Jordan 🏈✨
Commissioner, Sunday Deploy League`)}`,
		},
		{
			key: "L-02", box: "league", folder: "archive", at: "2026-09-27T20:10", from: P.league, to: [box("league")],
			subject: "Round 1 results: a win for the Deployers", read: true, labels: ["Fantasy"], thread: "L-02", auto: true, list: leagueList,
			html: mail("league", {
				preheader: `${TEAMS.alex} beat ${TEAMS.ben} 112.4–108.6. All four round 1 results inside.`,
				eyebrow: `Round 1 · Sunday, ${c.day(r1.day)}`,
				heading: "Round 1 is final",
				body: `${scoreboard(r1.games)}
${h3("Standings")}
${table(1)}
${h3("Round 2 matchups")}
${para("league", r2.games.map(([a, , b]) => `${teamBadge(a, 18)}${esc(TEAMS[a])} vs ${esc(TEAMS[b])}`).join("<br>"))}
${para("league", "Lineups lock Thursday at 8 pm.")}
${button("league", "Set your lineup", "https://sundaydeployleague.com/lineup")}`,
				footer: `Sunday Deploy League recaps for league@alexrivera.me. <a href="https://sundaydeployleague.com/settings/email" style="color:#69758A">Email settings</a>`,
			}),
		},
		{
			key: "L-03", box: "league", folder: "archive", at: "2026-10-01T18:50", from: P.ben, to: [box("league")],
			subject: "Cameron Lake for Devin Fox?", read: true, labels: ["Fantasy"], thread: "L-03",
			html: prose(`Alex,

Trade offer: my Cameron Lake for your Devin Fox.

You've been starting whichever tight end is healthy that week, and Lake would start for you every Sunday. I'm short at running back for the next few weeks, and Fox has been getting the carries. Happy to add a bench receiver if that gets it done.

I sent it through the league app too. It expires Friday at 6 pm, so let me know before then if you want to counter.

Ben`),
		},
		{
			key: "L-04", box: "league", folder: "inbox", at: "2026-10-04T20:15", from: P.jordan, to: everyone,
			subject: "ROUND 2 🏈🔥 Priya cooked us 👩‍🍳💀", read: true, labels: ["Fantasy"], thread: "L-04",
			html: prose(`OKAY LEAGUE PEOPLE 🏈📣🔥 round 2 is FINAL ✅🧾

Priya ${r2s.priya} → Alex ${r2s.alex} 👩‍💻🚀🍳💀 Alex buddy that lineup needed a code review 😭🛠️🫠

Ben ${r2s.ben} → Maya ${r2s.maya} 📈👏🥳

ME ${r2s.jordan} → Nia ${r2s.nia} 😱🤏🏆 I will be discussing this 0.4-point masterpiece for YEARS 😂📸🕺

Sam ${r2s.sam} → Theo ${r2s.theo} 🧰💪🎉

Set next round's lineups before the Thursday lock ⏰📅🔒 and CHECK YOUR BENCH 👀🪑🩹. Alex, please deploy a running back this time 🙏🏃💨 No spreadsheets at brunch ☕🥐🙅

Jordan 🏈✨`),
		},
		{
			key: "L-05", box: "league", folder: "sent", at: "2026-10-05T08:55", from: alex("league"), to: [P.jordan],
			subject: "Re: ROUND 2 🏈🔥 Priya cooked us 👩‍🍳💀", read: true, labels: ["Fantasy"], thread: "L-04", replyTo: "L-04",
			quote: `Priya ${r2s.priya} → Alex ${r2s.alex} 👩‍💻🚀🍳💀 Alex buddy that lineup needed a code review 😭🛠️🫠`,
			html: prose(`Fair. I started a kicker on bye and benched the only running back who scored. In my defense, I was writing a rollout plan for Cedar. This week I deploy a running back, and the rollout.

Alex`),
		},
		{
			key: "L-06", box: "league", folder: "inbox", at: "2026-10-11T19:58", from: P.league, to: [box("league")],
			subject: "Alex wins by 0.8 — Round 3 final 🏈", read: false, labels: ["Fantasy"], thread: "L-06", auto: true, list: leagueList,
			attachments: [photoPart("football-stadium", "sundaydeployleague.com")],
			html: mail("league", {
				preheader: `${TEAMS.alex} 131.7, ${TEAMS.jordan} 130.9. Round 3 results and standings after three rounds.`,
				eyebrow: `Round 3 · Sunday, ${c.day(r3.day)}`,
				heading: "Alex beats Jordan by 0.8",
				body: `${para("league", `${esc(TEAMS.alex)} edged ${esc(TEAMS.jordan)} <strong>131.7–130.9</strong>, decided by the last play of the night. Jordan's 130.9 would have beaten any other team this round.`)}
${photo("football-stadium", "sundaydeployleague.com", "A college football game seen from the stands", undefined, 180)}
${scoreboard(r3.games)}
${h3("Standings after three rounds")}
${table(3)}
${para("league", `Trades: none completed so far. Ben's offer of Cameron Lake for Devin Fox expired on ${esc(c.day("2026-10-02"))}.`)}
${button("league", "See the full recap", "https://sundaydeployleague.com/rounds/3")}`,
				footer: leagueFooter,
			}),
		},
	];
}

export function personalSlots(c: StoryClock): Slot[] {
	return [...personal(c), ...league(c)];
}
