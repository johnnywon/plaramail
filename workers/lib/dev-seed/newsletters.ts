// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: newsletters sent to hello@, each with List-Id and List-Unsubscribe.

import { note } from "./automated";
import { CO, type Company, type Ctx, at } from "./cast";
import { type Msg, esc } from "./kit";
import { button, card } from "./kit";

interface Series {
	co: Company;
	/** Days between issues, and the age in days of the newest. */
	every: number;
	newest: number;
	hhmm: string;
	/** The number of the oldest issue listed. */
	first: number;
	issues: [headline: string, items: [title: string, blurb: string][]][];
}

const SERIES: Series[] = [
	{ co: CO.devdrift, every: 7, newest: 1, hhmm: "06:30", first: 208, issues: [
		["Why your cron job runs twice", [["Idempotency keys, explained with a pizza order", "Retries are a feature until they charge someone twice."], ["Postgres 17 for people who skipped 16", "The changes that matter, minus the release-note noise."], ["A 90-line feature flag library", "Read it in one sitting; steal what you need."]]],
		["SQLite is quietly everywhere", [["Using SQLite as your only database", "What changes when the database is a file."], ["Write-ahead logging, a visual guide", "Why readers stop blocking writers."], ["Benchmarks that don't lie (much)", "How to measure query time without fooling yourself."]]],
		["Your logs are too clever", [["Structured logging that humans can read", "Fields first, prose second."], ["Sampling traces without losing the bad ones", "Keep every error, keep a fraction of the rest."], ["Tailing logs over SSH, in 2026", "Yes, people still do."]]],
		["The queue that wasn't", [["When a cron job is a queue in disguise", "Signs you need a real one."], ["Back-pressure for the rest of us", "What to do when producers outrun consumers."], ["A reading list on distributed locks", "Short, and mostly cautionary."]]],
		["Small teams, big deploys", [["Deploying on Fridays, responsibly", "Feature flags, canaries and a rollback you've actually tried."], ["What a staging environment is for", "It's not for testing; it's for rehearsing."], ["Zero-downtime migrations in five steps", "Expand, backfill, switch, contract, relax."]]],
		["Reading code you didn't write", [["How to read a 50k-line codebase in a day", "Start from the tests, not the main."], ["The case for boring dependencies", "Every library is a hire."], ["Reviewing pull requests like a kind skeptic", "A checklist for the first five minutes."]]],
	] },
	{ co: CO.weeklyledger, every: 7, newest: 0.2, hhmm: "07:00", first: 341, issues: [
		["What the rate pause means for small lenders", [["Credit unions are lending again", "A look at which products are getting cheaper."], ["The invoice you forgot to send", "Late invoicing is the quietest cash problem."], ["Quarterly taxes without the dread", "Set aside a percent each week and forget it."]]],
		["Is your runway shorter than you think?", [["Burn multiples for tiny companies", "A way to see whether growth is paying for itself."], ["Annual plans: take the cash or take the churn?", "The case for both."], ["How to read your own bank statement", "Five lines worth checking every month."]]],
		["The subscription audit you keep postponing", [["Find the 7 tools nobody uses", "A 20-minute exercise with a spreadsheet."], ["Negotiating with a SaaS vendor", "What to say when the renewal arrives."], ["Year-end tax moves, early", "Two decisions that depend on when you buy."]]],
		["Pricing is a product decision", [["When to raise prices (and tell nobody)", "Old customers stay on old prices."], ["The three-tier trap", "Why the middle plan wins and what it costs you."], ["Refund policies that build trust", "Generous beats clever."]]],
		["Hiring your first contractor", [["Contractor or employee? The short test", "Control, schedule, tools, and who takes the risk."], ["Writing a one-page scope", "Saves a month of argument."], ["Paying people on time, every time", "Reputation is a cash flow tool."]]],
	] },
	{ co: CO.fairway, every: 7, newest: 3, hhmm: "08:00", first: 129, issues: [
		["Fall course conditions: where the greens are fastest", [["Ten public courses to play before the frost", "Ranked by value, not by name."], ["Slow-play rules that actually work", "What the best clubs do differently."], ["A short game drill for tight lies", "Fifteen minutes, one wedge."]]],
		["The case for the 9-hole round", [["Why clubs are selling more twilight rounds", "Time is the new green fee."], ["Gear: the best rangefinders under $200", "Tested on wet days."], ["Interview: a head pro on tee sheet software", "Why paper finally lost."]]],
		["Winter golf, planned right", [["Indoor simulators worth the drive", "A guide to the good ones."], ["Wedge fitting for people who hate fittings", "What to ask before you pay."], ["Member events that fill up fast", "What clubs do with a waitlist."]]],
		["How to read a course rating", [["Slope and rating, in plain words", "Your handicap isn't what you think it is."], ["Playing in the wind", "Club up, swing easy, stay low."], ["The best tee times nobody books", "Early Monday, mostly."]]],
	] },
	{ co: CO.indiefounders, every: 7, newest: 4, hhmm: "09:15", first: 77, issues: [
		["She replaced her sales team with a checklist", [["How a two-person company reached $1M ARR", "Mostly by saying no."], ["The onboarding email that doubled activation", "It was three sentences."], ["Pricing page teardown: seven pages, one pattern", "What the winners have in common."]]],
		["Building in public without burning out", [["Quarterly letters instead of daily posts", "Slower, better, and nobody expects them daily."], ["When to say no to a feature request", "A template for the polite version."], ["Maker spotlight: a bookshop software founder", "From clipboard to calendar."]]],
		["Churn is a story, not a number", [["Reading cancellation reasons honestly", "People tell you more than you'd like."], ["The 30-day save email", "Short, specific, and sent by a person."], ["Support as a growth channel", "Every thread is a customer interview."]]],
		["Boring businesses that print money", [["Self-storage software, quietly huge", "The market nobody launches into."], ["Local service SaaS, by the numbers", "Plumbers, dentists, and tennis coaches."], ["Why your first ten customers should be friends", "Not for the money, for the honesty."]]],
		["The tools we actually use", [["Ten tools small teams swear by", "A reader poll, with comments."], ["Spreadsheets as a product spec", "They go further than you'd think."], ["A founder's guide to taking a week off", "Plan the hand-offs first."]]],
	] },
	{ co: CO.fieldnotes, every: 30, newest: 6, hhmm: "10:00", first: 18, issues: [
		["Spacing is the interface", [["The 4-point grid and when to break it", "Rules, and the reasons behind them."], ["Dense, not cramped", "How the best tools use space."], ["A type scale you can reuse", "Three sizes, two weights."]]],
		["Colour with restraint", [["One accent, used on purpose", "Why constraint reads as taste."], ["Dark mode isn't inverted light mode", "The work that goes into it."], ["Contrast ratios you can feel", "A short guide for non-designers."]]],
		["Small details, big trust", [["Empty states that don't apologise", "Say the thing and stop."], ["Error messages people read", "Plain verbs, concrete nouns."], ["The case for keyboard shortcuts", "Power users are your best marketing."]]],
	] },
];

export function newsletters(ctx: Ctx): Msg[] {
	const { clock } = ctx;
	const out: Msg[] = [];
	for (const s of SERIES) {
		const slug = s.co.domain.split(".")[0];
		const total = s.issues.length;
		for (const [i, [headline, items]] of s.issues.entries()) {
			const idx = total - 1 - i;
			const days = s.newest + idx * s.every;
			const when = days < 1 ? clock.at(Math.max(days, 0.1) * 24 * 60) : clock.at([Math.floor(days), s.hhmm]);
			const n = s.first + i;
			out.push(note(ctx, {
				key: `news-${slug}-${n}`, box: "hello", from: at(s.co, "newsletter", s.co.name), at: when, labels: ["Newsletters"],
				subject: `${s.co.name} #${n}: ${headline}`,
				list: { id: `${slug}.${s.co.domain}`, unsubscribe: `https://${s.co.domain}/unsubscribe`, oneClick: true },
				html: card({
					brand: s.co.name, color: s.co.color, preheader: items[0][0],
					body: `<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Issue ${n}</p><h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${esc(headline)}</h1>${items.map(([title, blurb]) => `<h3 style="margin:18px 0 2px;font-size:16px">${esc(title)}</h3><p style="margin:0;color:#4b5563">${esc(blurb)} <a href="https://${s.co.domain}/issues/${n}">Read more</a></p>`).join("")}${button(`Read issue ${n} on the web`, `https://${s.co.domain}/issues/${n}`, s.co.color)}`,
					footer: `You're receiving this because you subscribed at ${esc(s.co.domain)}. <a href="https://${s.co.domain}/unsubscribe">Unsubscribe</a> or <a href="https://${s.co.domain}/preferences">change how often we write</a>.`,
				}),
			}));
		}
	}
	return out;
}
