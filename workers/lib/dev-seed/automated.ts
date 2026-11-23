// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: mail sent by machines. Receipts, payouts, builds, incidents,
// sign-in alerts, shipping, travel, calendar and bank mail.

import { CO, type Company, type Ctx, at } from "./cast";
import { type Attachment, type Msg, type Person, type Role, type SeedFolder, type When, button, card, esc, file, money, rows } from "./kit";

export interface Note {
	key: string;
	box: Role;
	from: Person;
	subject: string;
	html: string;
	at: number;
	labels?: string[];
	attach?: Attachment[];
	list?: Msg["list"];
	thread?: string;
	replyTo?: string;
	starred?: boolean;
	read?: boolean;
	folder?: SeedFolder;
	/** Sent by a machine. On unless said otherwise. */
	auto?: boolean;
}

const DAY = 86_400_000;

/** One automated message. Unless told otherwise, how read and filed it is depends on how old it is. */
export function note(ctx: Ctx, n: Note): Msg {
	const age = (ctx.clock.now - n.at) / DAY;
	const unreadP = age < 0.5 ? 0.85 : age < 1.5 ? 0.6 : age < 4 ? 0.25 : age < 10 ? 0.06 : 0;
	const archiveP = age < 3 ? 0 : age < 14 ? 0.25 : 0.7;
	const unread = n.read === undefined ? ctx.r.chance(unreadP) : !n.read;
	const folder = n.folder ?? (!unread && ctx.r.chance(archiveP) ? "archive" : "inbox");
	return {
		key: n.key, box: n.box, folder, at: n.at, from: n.from, to: [ctx.me[n.box]], subject: n.subject, html: n.html,
		read: !unread, starred: n.starred, labels: n.labels, attachments: n.attach, thread: n.thread ?? n.key, replyTo: n.replyTo, list: n.list, auto: n.auto ?? true,
	};
}

const hex = (r: Ctx["r"], n: number) => Array.from({ length: n }, () => r.int(0, 15).toString(16)).join("");

// ── Receipts and subscriptions (billing@) ───────────────────────────

interface Sub {
	co: Company;
	what: string;
	cents: () => number;
	day: number;
	hhmm: string;
	pdf?: boolean;
}

export function receipts(ctx: Ctx): Msg[] {
	const { clock, r } = ctx;
	const out: Msg[] = [];
	const subs: Sub[] = [
		{ co: CO.tasklane, what: "Tasklane Team, 4 seats", cents: () => 4800, day: 3, hhmm: "04:12", pdf: true },
		{ co: CO.threadline, what: "Threadline Pro, 3 seats", cents: () => 2625, day: 9, hhmm: "07:30" },
		{ co: CO.sendwave, what: "Sendwave usage", cents: () => r.int(1480, 3160), day: 1, hhmm: "03:00", pdf: true },
		{ co: CO.huddle, what: "Huddle Business", cents: () => 1599, day: 14, hhmm: "05:45" },
		{ co: CO.ledgerly, what: "Ledgerly Plus", cents: () => 3900, day: 22, hhmm: "06:10", pdf: true },
		{ co: CO.keyring, what: "Keyring Teams, 4 seats", cents: () => 1400, day: 5, hhmm: "09:05" },
		{ co: CO.gitbranch, what: "Gitbranch Team, 4 seats", cents: () => 1600, day: 11, hhmm: "02:20" },
		{ co: CO.lumen, what: "Lumen Logs, 50 GB", cents: () => 4900, day: 17, hhmm: "04:40", pdf: true },
	];
	for (const s of subs) {
		for (const back of [0, 1, 2]) {
			const when = clock.monthStart(back, s.hhmm, s.day);
			if (when === null) continue;
			const amount = s.cents() / 100;
			const month = clock.monthName(when);
			const invoice = `${s.co.name.slice(0, 3).toUpperCase()}-${hex(r, 4).toUpperCase()}-${hex(r, 4).toUpperCase()}`;
			out.push(note(ctx, {
				key: `receipt-${s.co.domain.split(".")[0]}-${back}`, box: "billing", from: at(s.co, "billing"), at: when, labels: ["Receipts"],
				subject: `Your ${s.co.name} receipt for ${month} [${invoice}]`,
				html: card({
					brand: s.co.name, color: s.co.color, preheader: `${money(amount)} paid`,
					body: `<h2 style="margin:0 0 4px;font-size:20px">Payment received</h2><p style="margin:0 0 12px;color:#6b7280">Thanks for your payment. This is your receipt.</p>${rows([["Plan", s.what], ["Billing period", `${month} ${clock.parts(when).y}`], ["Invoice", invoice], ["Paid with", "Card ending 4417"], ["Amount paid", money(amount), "strong"]])}${button("View invoice", `https://${s.co.domain}/billing`, s.co.color)}`,
					footer: `${esc(s.co.name)}, 100 Example Street, Springfield. Questions? Reply to this email.`,
				}),
				attach: s.pdf ? [file.pdf(`${s.co.name.toLowerCase().replace(/[^a-z]+/g, "-")}-${invoice}.pdf`, [
					{ t: s.co.name, size: 18, bold: true }, { t: `Invoice ${invoice}`, size: 13, gap: 4 }, { t: "Bill to: Example Co", gap: 14 },
					{ t: `${s.what}, ${month}`, gap: 16 }, { t: `Total: ${money(amount)}`, bold: true, gap: 8 }, { t: "Status: Paid", gap: 4 },
					{ t: "Sample document for development only.", gap: 30 },
				])] : undefined,
			}));
		}
	}

	// Cobalt Cloud: the big one, with usage lines
	for (const back of [0, 1, 2]) {
		const when = clock.monthStart(back, "06:00", 1);
		if (when === null) continue;
		const compute = r.int(8400, 14100) / 100;
		const storage = r.int(1900, 3300) / 100;
		const egress = r.int(600, 2400) / 100;
		const total = Math.round((compute + storage + egress) * 100) / 100;
		const month = clock.monthName(clock.monthStart(back + 1, "00:00", 1) ?? when);
		out.push(note(ctx, {
			key: `cobalt-invoice-${back}`, box: "billing", from: at(CO.cobalt, "billing"), at: when, labels: ["Receipts", "Billing"],
			subject: `Your Cobalt Cloud invoice for ${month} is ready`,
			html: card({
				brand: "Cobalt Cloud", color: CO.cobalt.color, preheader: `${money(total)} due`,
				body: `<h2 style="margin:0 0 4px;font-size:20px">Your ${esc(month)} invoice</h2><p style="color:#6b7280;margin:0 0 12px">We'll charge your card on file in 3 days.</p>${rows([["Compute (3 instances)", money(compute)], ["Object storage, 420 GB", money(storage)], ["Bandwidth", money(egress)], ["Total", money(total), "strong"]])}${button("View usage", `https://${CO.cobalt.domain}/usage`, CO.cobalt.color)}`,
				footer: "You're receiving this because you own the account. Cobalt Cloud, Springfield.",
			}),
			attach: [file.pdf(`cobalt-cloud-invoice-${month.toLowerCase()}.pdf`, [
				{ t: "Cobalt Cloud", size: 20, bold: true }, { t: `Invoice for ${month}`, size: 13, gap: 4 }, { t: "Account: example-co", gap: 14 },
				{ t: `Compute (3 instances)    ${money(compute)}`, gap: 16 }, { t: `Object storage, 420 GB   ${money(storage)}`, gap: 4 }, { t: `Bandwidth                ${money(egress)}`, gap: 4 },
				{ t: `Total due: ${money(total)}`, bold: true, gap: 12 }, { t: "Sample document for development only.", gap: 30 },
			])],
		}));
	}

	// Annual renewals and a failed payment that fixed itself
	const annual = clock.at([41, "08:15"]);
	out.push(note(ctx, { key: "marginalia-annual", box: "billing", from: at(CO.marginalia, "hello", "Marginalia"), at: annual, labels: ["Receipts"], subject: "Thanks for renewing Marginalia for a year",
		html: card({ brand: "Marginalia", color: CO.marginalia.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Renewed for a year</h2><p>Your annual plan renewed today.</p>${rows([["Plan", "Marginalia Annual"], ["Amount paid", money(59), "strong"], ["Next renewal", clock.date(annual + 365 * DAY)]])}` }) }));

	const failed = clock.at([12, "10:02"]);
	const failKey = "tasklane-failed";
	out.push(
		note(ctx, { key: failKey, box: "billing", from: at(CO.tasklane, "billing"), at: failed, labels: ["Billing"], read: true, subject: "Payment failed: update your card",
			html: card({ brand: "Tasklane", color: CO.tasklane.color, body: `<h2 style="margin:0 0 8px;font-size:20px;color:#c8372d">We couldn't charge your card</h2><p>The card ending 4417 was declined for ${money(48)}. We'll try again in 3 days. Update your payment method to keep your workspace active.</p>${button("Update payment method", `https://${CO.tasklane.domain}/billing`, CO.tasklane.color)}` }) }),
		note(ctx, { key: `${failKey}-2`, box: "billing", from: at(CO.tasklane, "billing"), at: failed + 3 * DAY + 3_600_000, labels: ["Billing"], read: true, thread: failKey, replyTo: failKey, subject: "Re: Payment failed: update your card",
			html: card({ brand: "Tasklane", color: CO.tasklane.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Payment received</h2><p>We charged ${money(48)} to the card ending 8820. Thanks for updating your payment method.</p>` }) }),
	);
	return out;
}

// ── Money in (billing@) ─────────────────────────────────────────────

const PAYERS = ["Calloway Physio", "Teo Tutoring", "Tanaka Pilates", "Nwosu Family Dental", "Hollow Pines Golf Club", "Stratton Vet Clinic", "Ramos Martial Arts", "Fischer Music School", "Little Lotus Yoga", "Brightwater Dental", "Orbit Bikes", "Brooks Flower Studio", "Juniper Health", "Quill & Ink Bookshop"];

export function payments(ctx: Ctx): Msg[] {
	const { clock, r } = ctx;
	const out: Msg[] = [];
	const remit = at(CO.remit, "notifications", "Remit Payments");
	for (let i = 0; i < 16; i++) {
		const payer = PAYERS[i % PAYERS.length];
		const plan = r.pick([["Starter", 29], ["Studio", 79], ["Studio", 79], ["Business", 199]] as const);
		const fee = Math.round((plan[1] * 0.029 + 0.3) * 100) / 100;
		const when = i < 2 ? clock.at(70 + i * 190) : clock.at([Math.floor(i * 1.9) + 1, `${String(r.int(6, 19)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}`]);
		out.push(note(ctx, {
			key: `payment-${i + 1}`, box: "billing", from: remit, at: when, labels: ["Billing"],
			subject: `Payment received: ${money(plan[1])} from ${payer}`,
			html: card({ brand: "Remit", color: CO.remit.color, body: `<h2 style="margin:0 0 8px;font-size:20px">You got paid</h2>${rows([["From", payer], ["Plan", `${plan[0]} monthly`], ["Amount", money(plan[1])], ["Fee", `-${money(fee)}`], ["You receive", money(plan[1] - fee), "strong"]])}${button("View payment", `https://${CO.remit.domain}/payments`, CO.remit.color)}` }),
		}));
	}
	for (let w = 0; w < 6; w++) {
		const when = clock.at([w * 7 + 1, "05:30"]);
		const gross = r.int(310000, 560000) / 100;
		out.push(note(ctx, {
			key: `payout-${w + 1}`, box: "billing", from: remit, at: when, labels: ["Billing"],
			subject: `Your ${money(gross)} payout is on its way`,
			html: card({ brand: "Remit", color: CO.remit.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Payout sent</h2><p>${money(gross)} was sent to your Fernwood Credit Union account ending 0091. It should arrive within 1 to 2 business days.</p>${button("Download report", `https://${CO.remit.domain}/payouts`, CO.remit.color)}` }),
			attach: [file.csv(`payout-report-${w + 1}.csv`, [["date", "customer", "gross", "fee", "net"], ...[0, 1, 2, 3, 4].map((k) => { const g = [29, 79, 79, 199, 79][(k + w) % 5]; const f = Math.round((g * 0.029 + 0.3) * 100) / 100; return [clock.date(when - (k + 1) * DAY), PAYERS[(k + w * 3) % PAYERS.length], g.toFixed(2), f.toFixed(2), (g - f).toFixed(2)]; })])],
		}));
	}
	return out;
}

// ── Bank (billing@) ─────────────────────────────────────────────────

export function bank(ctx: Ctx): Msg[] {
	const { clock, r } = ctx;
	const out: Msg[] = [];
	const from = at(CO.fernwood, "alerts", "Fernwood Credit Union");
	for (const back of [0, 1, 2]) {
		const when = clock.monthStart(back, "07:00", 3);
		if (when === null) continue;
		const month = clock.monthName(clock.monthStart(back + 1, "00:00", 1) ?? when);
		const open = r.int(2100000, 2600000) / 100;
		const close = r.int(2300000, 2900000) / 100;
		out.push(note(ctx, {
			key: `bank-statement-${back}`, box: "billing", from, at: when, labels: ["Billing"], subject: `Your ${month} statement is ready`,
			html: card({ brand: "Fernwood Credit Union", color: CO.fernwood.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Statement ready</h2><p>Your business checking statement for ${esc(month)} (account ending 0091) is attached.</p>${rows([["Opening balance", money(open)], ["Closing balance", money(close), "strong"]])}`, footer: "Member FDIC-style insurance notice for development. Fernwood Credit Union." }),
			attach: [file.pdf(`fernwood-statement-${month.toLowerCase()}.pdf`, [
				{ t: "Fernwood Credit Union", size: 18, bold: true }, { t: `Business checking ending 0091 - ${month}`, size: 12, gap: 4 },
				{ t: `Opening balance   ${money(open)}`, gap: 18 }, { t: `Deposits          ${money(r.int(1900000, 2500000) / 100)}`, gap: 4 }, { t: `Withdrawals       ${money(r.int(1700000, 2300000) / 100)}`, gap: 4 },
				{ t: `Closing balance   ${money(close)}`, bold: true, gap: 8 }, { t: "Sample document for development only.", gap: 30 },
			])],
		}));
	}
	out.push(
		note(ctx, { key: "bank-low", box: "billing", from, at: clock.at([17, "13:21"]), subject: "Low balance alert on checking ending 0091", read: true,
			html: card({ brand: "Fernwood Credit Union", color: CO.fernwood.color, body: `<p>Your available balance dropped to <strong>${money(1204.77)}</strong>, below your alert level of ${money(1500)}.</p>` }) }),
		note(ctx, { key: "bank-deposit", box: "billing", from, at: clock.at([2, "11:40"]), subject: `A deposit of ${money(4812.5)} posted to your account`,
			html: card({ brand: "Fernwood Credit Union", color: CO.fernwood.color, body: `<p>A deposit of <strong>${money(4812.5)}</strong> from REMIT PAYOUT posted to checking ending 0091.</p>` }) }),
	);
	return out;
}

// ── Builds, pull requests, alerts, incidents (ops@) ─────────────────

export function engineering(ctx: Ctx): Msg[] {
	const { clock, r } = ctx;
	const out: Msg[] = [];
	const repos = ["example/api", "example/web", "example/worker"];
	const authors = ["jo-whitfield", "morgan", "jo-whitfield", "dependabot-ish[bot]"];
	let build = 1810;
	const BUILDS = 26;
	const FAILED = [5, 11, 17];
	let failure: { key: string; subject: string; at: number } | null = null;
	// Oldest first, so build numbers climb with time.
	for (let idx = 0; idx < BUILDS; idx++) {
		build += r.int(1, 3);
		const k = BUILDS - 1 - idx;
		const repo = r.pick(repos);
		const key = `ci-${build}`;
		const author = r.pick(authors);
		const commit = hex(r, 7);
		const secs = r.int(48, 214);
		const failed = FAILED.includes(idx);
		const fixes = !failed && failure && FAILED.includes(idx - 1) ? failure : null;
		const when = fixes
			? fixes.at + r.int(20, 90) * 60_000
			: k < 3 ? clock.at(40 + k * 130) : clock.at([Math.floor(k * 1.2 + r.next()), `${String(r.int(8, 22)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}`]);
		const from = at(CO.pipewright, "builds", "Pipewright CI");
		const detail = rows([["Repository", repo], ["Branch", "main"], ["Commit", `${commit} by ${author}`], ["Duration", `${Math.floor(secs / 60)}m ${secs % 60}s`]]);
		const view = button("View build", `https://${CO.pipewright.domain}/builds/${build}`, CO.pipewright.color);
		if (failed) {
			failure = { key, subject: `[${repo}] Build #${build} failed on main`, at: when };
			out.push(note(ctx, {
				key, box: "ops", from, at: when, labels: ["Dev"], subject: failure.subject,
				html: card({ brand: "Pipewright CI", color: CO.pipewright.color, body: `<h2 style="margin:0 0 8px;font-size:20px;color:#c8372d">Build #${build} failed</h2>${detail}<pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto">FAIL  src/booking/slots.test.ts\n  x holds a slot for five minutes (212 ms)\n\n    expected: "held"\n    received: "free"\n\n  Tests: 1 failed, 214 passed</pre>${view}` }),
			}));
		} else {
			out.push(note(ctx, {
				key, box: "ops", from, at: when, labels: ["Dev"], thread: fixes?.key, replyTo: fixes?.key,
				subject: fixes ? `Re: ${fixes.subject}` : `[${repo}] Build #${build} passed on main`,
				html: card({ brand: "Pipewright CI", color: CO.pipewright.color, body: `<h2 style="margin:0 0 8px;font-size:20px;color:#4f8a3c">Build #${build} ${fixes ? "is fixed" : "passed"}</h2>${detail}${view}` }),
			}));
		}
	}

	const prs: { n: number; title: string; repo: string; events: { who: string; text: string; ago: When }[] }[] = [
		{ n: 231, title: "Intake forms: file upload field", repo: "example/api", events: [
			{ who: "Jo Whitfield", text: "Opened this pull request. Adds a file upload field to intake forms with a 10 MB limit and a virus scan hook.", ago: [7, "16:10"] },
			{ who: "Morgan Reyes", text: "Looks good. Can the limit be set per form? Some clinics need 25 MB scans.", ago: [7, "18:40"] },
			{ who: "Jo Whitfield", text: "Done, the default is 10 MB and each form can raise it to 25. Updated tests.", ago: [6, "09:15"] },
			{ who: "Morgan Reyes", text: "Approved. Merging after the build passes.", ago: [6, "11:02"] },
		] },
		{ n: 236, title: "Fix cursor pagination for /bookings", repo: "example/api", events: [
			{ who: "Jo Whitfield", text: "Opened this pull request. Switches /bookings to cursor pagination so deep pages stop timing out.", ago: [1, "17:20"] },
			{ who: "Jo Whitfield", text: "Requested your review.", ago: [1, "17:21"] },
		] },
		{ n: 229, title: "Handle DST in iCal feed", repo: "example/web", events: [
			{ who: "Jo Whitfield", text: "Opened this pull request. The iCal feed used a fixed offset, so appointments moved by an hour after DST changes.", ago: [13, "10:30"] },
			{ who: "Morgan Reyes", text: "Nice catch. Can you add a test for the Southern Hemisphere?", ago: [13, "12:00"] },
			{ who: "Jo Whitfield", text: "Added Sydney and Santiago cases.", ago: [12, "09:40"] },
		] },
	];
	for (const pr of prs) {
		let first: string | null = null;
		for (const [k, e] of pr.events.entries()) {
			const key = `pr-${pr.n}-${k + 1}`;
			first ??= key;
			out.push(note(ctx, {
				key, box: "ops", from: at(CO.gitbranch, "notifications", `${e.who} (via Gitbranch)`), at: clock.at(e.ago), labels: ["Dev"],
				subject: `${k === 0 ? "" : "Re: "}[${pr.repo}] ${pr.title} (#${pr.n})`, thread: first, replyTo: k === 0 ? undefined : `pr-${pr.n}-${k}`,
				html: card({ brand: "Gitbranch", color: CO.gitbranch.color, body: `<p><strong>${esc(e.who)}</strong></p><p>${esc(e.text)}</p>${button("View pull request", `https://${CO.gitbranch.domain}/${pr.repo}/pull/${pr.n}`, CO.gitbranch.color)}`, footer: "You are receiving this because you are subscribed to this thread." }),
			}));
		}
	}
	out.push(note(ctx, { key: "gitbranch-dep", box: "ops", from: at(CO.gitbranch, "security", "Gitbranch Security"), at: clock.at([4, "06:50"]), labels: ["Dev"], subject: "[example/web] A dependency has a known vulnerability",
		html: card({ brand: "Gitbranch", color: CO.gitbranch.color, body: `<h2 style="margin:0 0 8px;font-size:20px">1 high severity alert</h2><p><code>tiny-slugify</code> before 2.1.4 is vulnerable to regular expression denial of service. A patched version is available.</p>${button("Review alert", `https://${CO.gitbranch.domain}/example/web/security`, CO.gitbranch.color)}` }) }));

	// Incidents on the cloud provider's status page, and one of ours
	const incidents = [
		{ ago: [5, "14:02"] as When, title: "Elevated API error rates in us-east", steps: [["Investigating", "We are investigating elevated error rates for API requests in us-east."], ["Identified", "The issue is caused by a failing network device. We are routing traffic away."], ["Resolved", "Traffic is flowing normally. Total impact was 38 minutes."]] },
		{ ago: [18, "21:10"] as When, title: "Delayed object storage writes", steps: [["Investigating", "Some customers see delays of up to 90 seconds on new writes."], ["Monitoring", "A fix was applied. We are watching write latency."], ["Resolved", "Write latency has returned to normal."]] },
		{ ago: [31, "03:45"] as When, title: "Scheduled maintenance: database upgrades", steps: [["Scheduled", "We will upgrade managed databases to a new minor version. Expect up to 30 seconds of connection resets."], ["Completed", "The upgrade finished with no customer-visible impact."]] },
	];
	for (const [n, inc] of incidents.entries()) {
		let prev: string | null = null;
		let t = clock.at(inc.ago);
		for (const [k, [state, text]] of inc.steps.entries()) {
			const key = `status-${n + 1}-${k + 1}`;
			out.push(note(ctx, {
				key, box: "ops", from: at(CO.cobalt, "status", "Cobalt Cloud Status"), at: t, labels: ["Dev"], thread: `status-${n + 1}-1`, replyTo: prev ?? undefined,
				subject: `${k === 0 ? "" : "Re: "}[${state === "Resolved" || state === "Completed" ? "Resolved" : state}] ${inc.title}`,
				list: { id: `status.${CO.cobalt.domain}`, unsubscribe: `https://${CO.cobalt.domain}/status/unsubscribe` },
				html: card({ brand: "Cobalt Cloud Status", color: CO.cobalt.color, body: `<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">${esc(state)}</p><h2 style="margin:0 0 8px;font-size:20px">${esc(inc.title)}</h2><p>${esc(text)}</p><p style="color:#6b7280;font-size:12px">${esc(clock.long(t))}</p>` }),
			}));
			prev = key;
			t += r.int(14, 55) * 60_000;
		}
	}
	for (const [i, [ago, route, pct]] of ([[[3, "02:14"], "api /bookings", 4.1], [[9, "15:33"], "web /book/*", 2.6], [[22, "11:08"], "api /reports", 7.8]] as [When, string, number][]).entries()) {
		out.push(note(ctx, { key: `lumen-${i + 1}`, box: "ops", from: at(CO.lumen, "alerts", "Lumen Logs"), at: clock.at(ago), labels: ["Dev"], subject: `[Alert] Error rate above 2% on ${route}`,
			html: card({ brand: "Lumen Logs", color: CO.lumen.color, body: `<h2 style="margin:0 0 8px;font-size:20px;color:#c8372d">Alert fired</h2>${rows([["Monitor", `Error rate on ${route}`], ["Threshold", "2% for 5 minutes"], ["Peak", `${pct}%`], ["Resolved after", `${r.int(6, 21)} minutes`]])}${button("Open in Lumen", `https://${CO.lumen.domain}/alerts`, CO.lumen.color)}` }) }));
	}
	return out;
}

// ── Security (ops@) ─────────────────────────────────────────────────

export function security(ctx: Ctx): Msg[] {
	const { clock, r } = ctx;
	const out: Msg[] = [];
	const signins: { ago: When | "now"; device: string; place: string }[] = [
		{ ago: "now", device: "Chrome on macOS", place: "Springfield, US" },
		{ ago: [1, "08:14"], device: "Safari on iPhone", place: "Springfield, US" },
		{ ago: [6, "19:02"], device: "Firefox on Windows", place: "Lisbon, Portugal" },
		{ ago: [15, "07:47"], device: "Chrome on macOS", place: "Springfield, US" },
	];
	for (const [i, s] of signins.entries()) {
		// The first just arrived: it is the newest message in the inbox.
		const t = s.ago === "now" ? clock.newest() : clock.at(s.ago);
		out.push(note(ctx, { key: `signin-${i + 1}`, box: "ops", from: at(CO.keyring, "security", "Keyring Security"), at: t, labels: ["Dev"], subject: `New sign-in to your Keyring account from ${s.device}`,
			html: card({ brand: "Keyring", color: CO.keyring.color, body: `<h2 style="margin:0 0 8px;font-size:20px">New sign-in</h2><p>Your account was signed in from a new device.</p>${rows([["Device", s.device], ["Location", s.place], ["Time", clock.long(t)]])}<p>If this wasn't you, reset your master password now.</p>${button("Secure my account", `https://${CO.keyring.domain}/secure`, CO.keyring.color)}` }) }));
	}
	out.push(note(ctx, { key: "ssh-key", box: "ops", from: at(CO.gitbranch, "security", "Gitbranch Security"), at: clock.at([11, "13:58"]), labels: ["Dev"], subject: "A new SSH key was added to your account",
		html: card({ brand: "Gitbranch", color: CO.gitbranch.color, body: `<p>A new SSH key (<code>work-laptop-2026</code>) was added to <strong>morgan</strong>. Fingerprint: <code>SHA256:${hex(r, 16)}</code></p>` }) }));
	for (const [i, ago] of ([300, [2, "16:20"], [8, "10:35"]] as When[]).entries()) {
		const code = `${r.int(100, 999)} ${r.int(100, 999)}`;
		out.push(note(ctx, { key: `code-${i + 1}`, box: "ops", from: at(CO.huddle, "no-reply", "Huddle"), at: clock.at(ago), read: i > 0, folder: "inbox", subject: `${code.replace(" ", "")} is your Huddle verification code`,
			html: card({ brand: "Huddle Video", color: CO.huddle.color, body: `<p>Your verification code is</p><p style="font-size:28px;letter-spacing:.2em;font-weight:700">${code}</p><p style="color:#6b7280">It expires in 10 minutes. If you didn't request it, ignore this email.</p>` }) }));
	}
	return out;
}

// ── Shopping and shipping (hello@) ──────────────────────────────────

export function shopping(ctx: Ctx): Msg[] {
	const { clock, r } = ctx;
	const out: Msg[] = [];
	const orders = [
		{ n: 48211, items: [["Standing desk mat", 64], ["Cable organiser, 6 pack", 18]] as [string, number][], ago: [20, "19:22"] as When },
		{ n: 49306, items: [["Ceramic mug set", 42], ["Notebook, dot grid, 3 pack", 27]] as [string, number][], ago: [3, "20:05"] as When },
	];
	for (const o of orders) {
		const base = clock.at(o.ago);
		const total = o.items.reduce((s, [, p]) => s + p, 0) + 6.5;
		const track = `PH${r.int(10000000, 99999999)}US`;
		const thread = `order-${o.n}-1`;
		const stages = [
			{ dt: 0, from: at(CO.tallowoak, "orders", "Tallow & Oak"), color: CO.tallowoak.color, subject: `Order #TO-${o.n} confirmed`, body: `<h2 style="margin:0 0 8px;font-size:20px">Thanks for your order</h2>${rows([...o.items.map(([n, p]) => [n, money(p)] as [string, string]), ["Shipping", money(6.5)], ["Total", money(total), "strong"]])}<p>We'll email you when it ships.</p>` },
			{ dt: 22 * 3_600_000, from: at(CO.tallowoak, "orders", "Tallow & Oak"), color: CO.tallowoak.color, subject: `Order #TO-${o.n} has shipped`, body: `<h2 style="margin:0 0 8px;font-size:20px">On its way</h2><p>Your order shipped with Parcelhop. Tracking number: <strong>${track}</strong></p>${button("Track package", `https://${CO.parcelhop.domain}/track/${track}`, CO.tallowoak.color)}` },
			{ dt: 3 * DAY, from: at(CO.parcelhop, "updates", "Parcelhop"), color: CO.parcelhop.color, subject: `Delivered: package ${track}`, body: `<h2 style="margin:0 0 8px;font-size:20px">Delivered</h2><p>Your package was left at the front door at ${esc(clock.time(base + 3 * DAY + 2 * 3_600_000))}.</p>` },
		];
		for (const [k, s] of stages.entries()) {
			const t = base + s.dt;
			if (t > clock.now - 5 * 60_000) continue;
			out.push(note(ctx, { key: `order-${o.n}-${k + 1}`, box: "hello", from: s.from, at: t, labels: ["Receipts", "Shopping"], thread, replyTo: k ? `order-${o.n}-${k}` : undefined, subject: `${k ? "Re: " : ""}${s.subject}`,
				html: card({ brand: s.from.name, color: s.color, body: s.body }) }));
		}
	}
	for (const back of [0, 1, 2]) {
		const when = clock.monthStart(back, "10:00", 6);
		if (when === null) continue;
		out.push(note(ctx, { key: `kettle-${back}`, box: "hello", from: at(CO.kettle, "hello", "Kettle & Co"), at: when, labels: ["Receipts", "Shopping"], subject: `Your ${r.pick(["Ethiopia Guji", "Colombia Huila", "Kenya Nyeri", "Guatemala Antigua"])} beans ship tomorrow`,
			html: card({ brand: "Kettle & Co", color: CO.kettle.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Fresh roast on the way</h2><p>Your monthly 2 bags ship tomorrow. Want to skip or swap? You have until midnight.</p>${rows([["Plan", "2 x 12 oz, whole bean"], ["Charged", money(38)]])}${button("Manage subscription", `https://${CO.kettle.domain}/account`, CO.kettle.color)}` }),
			list: { id: `orders.${CO.kettle.domain}`, unsubscribe: `https://${CO.kettle.domain}/unsubscribe` } }));
	}
	return out;
}

// ── Travel (hello@) ─────────────────────────────────────────────────

export function travel(ctx: Ctx): Msg[] {
	const { clock } = ctx;
	const out: Msg[] = [];
	const trips = [
		{ id: "trip-up", city: "Denver", code: "DEN", booked: [9, "12:30"] as When, depart: 19, ret: 22, conf: "K7M2QD", price: 482.4 },
		{ id: "trip-past", city: "Chicago", code: "ORD", booked: [58, "09:40"] as When, depart: -34, ret: -31, conf: "R3T9LB", price: 391.2 },
	];
	for (const trip of trips) {
		const booked = clock.at(trip.booked);
		const out1 = clock.nextDay(clock.now, trip.depart, "07:05");
		const back = clock.nextDay(clock.now, trip.ret, "18:20");
		out.push(note(ctx, { key: `${trip.id}-1`, box: "hello", from: at(CO.meridian, "reservations", "Meridian Air"), at: booked, labels: ["Travel"], read: true, thread: `${trip.id}-1`,
			subject: `Your trip to ${trip.city} is confirmed (${trip.conf})`,
			html: card({ brand: "Meridian Air", color: CO.meridian.color, body: `<h2 style="margin:0 0 8px;font-size:20px">You're going to ${esc(trip.city)}</h2><p>Confirmation code: <strong>${trip.conf}</strong></p>${rows([[`Outbound ${clock.short(out1)}`, `SPR 7:05 AM > ${trip.code} 9:12 AM`], [`Return ${clock.short(back)}`, `${trip.code} 6:20 PM > SPR 8:31 PM`], ["Passenger", "Morgan Reyes"], ["Total", money(trip.price), "strong"]])}${button("Manage trip", `https://${CO.meridian.domain}/trips/${trip.conf}`, CO.meridian.color)}` }),
			attach: [file.pdf(`itinerary-${trip.conf}.pdf`, [
				{ t: "Meridian Air", size: 20, bold: true }, { t: `Itinerary ${trip.conf}`, size: 13, gap: 4 }, { t: "Passenger: Morgan Reyes", gap: 14 },
				{ t: `Outbound: ${clock.short(out1)}  SPR 7:05 AM -> ${trip.code} 9:12 AM  MA 214`, gap: 16 }, { t: `Return: ${clock.short(back)}  ${trip.code} 6:20 PM -> SPR 8:31 PM  MA 217`, gap: 4 },
				{ t: `Fare total: ${money(trip.price)}`, bold: true, gap: 14 }, { t: "Sample document for development only.", gap: 30 },
			]), file.ics(`flight-${trip.conf}.ics`, { uid: trip.conf, start: out1, end: out1 + 135 * 60_000, summary: `Flight to ${trip.city} (MA 214)`, location: "Springfield Airport (SPR)", clock, method: "PUBLISH" })] }));
		out.push(note(ctx, { key: `${trip.id}-2`, box: "hello", from: at(CO.sojourn, "stay", "Sojourn Hotels"), at: booked + 2 * 3_600_000, labels: ["Travel"], read: true, subject: `Reservation confirmed: Sojourn ${trip.city} Central`,
			html: card({ brand: "Sojourn Hotels", color: CO.sojourn.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Your stay is booked</h2>${rows([["Hotel", `Sojourn ${trip.city} Central`], ["Check in", `${clock.short(out1)}, after 3:00 PM`], ["Check out", `${clock.short(back)}, 11:00 AM`], ["Rate", `${money(139)} per night`]])}` }) }));
		if (trip.depart > 0) {
			out.push(note(ctx, { key: `${trip.id}-3`, box: "hello", from: at(CO.meridian, "reservations", "Meridian Air"), at: clock.at(75), labels: ["Travel"], read: false, folder: "inbox", subject: `Check-in opens soon for your trip to ${trip.city}`,
				html: card({ brand: "Meridian Air", color: CO.meridian.color, body: `<p>Online check-in opens 24 hours before departure. Add your trip to your wallet to skip the counter.</p>${button("Check in", `https://${CO.meridian.domain}/checkin`, CO.meridian.color)}` }) }));
		} else {
			out.push(note(ctx, { key: `${trip.id}-3`, box: "hello", from: at(CO.meridian, "feedback", "Meridian Air"), at: back + 18 * 3_600_000, labels: ["Travel"], read: true, folder: "archive", subject: `How was your flight to ${trip.city}?`,
				html: card({ brand: "Meridian Air", color: CO.meridian.color, body: `<p>Thanks for flying with us. It takes 30 seconds to tell us how it went.</p>${button("Rate your flight", `https://${CO.meridian.domain}/rate`, CO.meridian.color)}` }) }));
		}
	}
	const rail = clock.at([27, "08:20"]);
	out.push(note(ctx, { key: "rail-ticket", box: "hello", from: at(CO.northline, "tickets", "Northline Rail"), at: rail, labels: ["Travel"], read: true, folder: "archive", subject: "Your e-ticket: Springfield to Capital City",
		html: card({ brand: "Northline Rail", color: CO.northline.color, body: `<p>Your e-ticket is attached. Show the QR code to the conductor.</p>${rows([["Date", clock.short(clock.nextDay(rail, 2, "09:15"))], ["Train", "Northline 41"], ["Seat", "Coach 3, 14A"], ["Fare", money(36)]])}` }),
		attach: [file.pdf("northline-e-ticket.pdf", [{ t: "Northline Rail e-ticket", size: 18, bold: true }, { t: "Springfield > Capital City, Northline 41, Coach 3 seat 14A", gap: 16 }, { t: "[ QR code placeholder ]", size: 24, gap: 30 }, { t: "Sample document for development only.", gap: 30 }])] }));
	return out;
}

// ── Calendar (hello@, ops@) ─────────────────────────────────────────

export function calendar(ctx: Ctx): Msg[] {
	const { clock } = ctx;
	const out: Msg[] = [];
	const guests: [string, Company, number, string, number][] = [
		["Naomi Fischer", { name: "Fischer Music School", domain: "fischermusic.example.net", color: "#5f6b74" }, 2, "14:00", 1],
		["Dana Whitcomb", { name: "Whitcomb Clinics", domain: "whitcomb.example.org", color: "#5f6b74" }, 4, "09:30", 2],
		["Peter Lindgren", { name: "Lindgren Tennis Academy", domain: "lindgrentennis.example.org", color: "#5f6b74" }, 5, "16:00", 3],
		["Grace Nwosu", { name: "Nwosu Family Dental", domain: "nwosudental.example.com", color: "#5f6b74" }, 8, "11:00", 5],
		["Raj Mehta", { name: "Mehta Driving School", domain: "mehtadriving.example.net", color: "#5f6b74" }, 11, "13:30", 6],
	];
	for (const [i, [name, company, daysOut, hhmm, bookedAgo]] of guests.entries()) {
		const start = clock.nextDay(clock.now, daysOut, hhmm);
		const guest: Person = { name, addr: `${name.split(" ")[0].toLowerCase()}@${company.domain}` };
		out.push(note(ctx, { key: `booking-${i + 1}`, box: "hello", from: at(CO.slotbook, "notify", "Slotbook"), at: clock.at([bookedAgo, "15:10"]), labels: ["Clients"],
			subject: `New booking: 30 min intro with ${name}, ${clock.short(start)} at ${clock.time(start)}`,
			html: card({ brand: "Slotbook", color: CO.slotbook.color, body: `<h2 style="margin:0 0 8px;font-size:20px">New booking</h2>${rows([["Who", `${name}, ${company.name}`], ["When", `${clock.short(start)}, ${clock.time(start)}`], ["Where", "Huddle video call"], ["Notes", i % 2 ? "Wants to see reminders and the API." : "Comparing options for the new year."]])}${button("Reschedule or cancel", `https://${CO.slotbook.domain}/b/${i + 1}`, CO.slotbook.color)}` }),
			attach: [file.ics(`intro-${name.split(" ")[0].toLowerCase()}.ics`, { uid: `slot-${i}`, start, end: start + 30 * 60_000, summary: `Intro call: ${name}`, location: "Huddle video call", organizer: ctx.me.hello, attendee: guest, clock })] }));
	}
	const weekly = clock.nextDay(clock.now, 1, "10:00");
	out.push(note(ctx, { key: "weekly-sync", box: "ops", from: at(CO.whitfield, "jo", "Jo Whitfield"), at: clock.at([3, "17:10"]), subject: `Invitation: Weekly sync @ Tue 10:00 AM (Jo Whitfield, Morgan Reyes)`, labels: ["Dev"], read: true,
		html: card({ brand: "Calendar", color: "#2f6db3", body: `<h2 style="margin:0 0 8px;font-size:20px">Weekly sync</h2>${rows([["When", `${clock.short(weekly)}, 10:00 to 10:30 AM, weekly`], ["Where", "Huddle video call"], ["Who", "Jo Whitfield, Morgan Reyes"]])}${button("Yes", "https://example.com/rsvp/yes", "#4f8a3c")}` }),
		attach: [file.ics("invite.ics", { uid: "weekly-sync", start: weekly, end: weekly + 30 * 60_000, summary: "Weekly sync", location: "Huddle video call", organizer: at(CO.whitfield, "jo", "Jo Whitfield"), attendee: ctx.me.ops, clock })] }));
	return out;
}
