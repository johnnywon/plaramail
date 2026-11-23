// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only (POST /api/v1/dev/seed-agents): a crew of agents with a week of
// runs, some still queued or running, drafts waiting in Review and a Logs trail.
// Queued and running rows are never claimed, since only a queue job claims a run.

import { Folders } from "../../shared/folders";
import { mailStore, mailboxIds, recordsSql } from "../store";
import type { Env } from "../types";

type State = "queued" | "running" | "drafted" | "watched" | "sent" | "skipped" | "failed";

interface Crew {
	id: string;
	name: string;
	job: string;
	mode: "watch" | "draft" | "send";
	/** Index into the configured addresses; null for all. */
	address: number | null;
	instructions: string;
	example: string;
	mail: { from: string; subject: string; body: string; reply?: string }[];
}

const CREW: Crew[] = [
	{
		id: "seed-penny", name: "Penny", mode: "draft", address: null,
		job: "Politely decline guest-post, link-exchange and sales pitches.",
		instructions: "Thank them in one line and say no. Don't explain.",
		example: "Thanks for thinking of us. We don't take guest posts.",
		mail: [
			{ from: "sara@outreach.example.org", subject: "Guest post opportunity", body: "Hi! I'd love to contribute a guest post to your blog about SEO trends.", reply: "Hi Sara,\n\nThanks for thinking of us. We don't take guest posts.\n\nBest" },
			{ from: "growth@leads.example.net", subject: "Quick question about your SEO", body: "We can triple your traffic in 30 days. Can I send a proposal?", reply: "Thanks for reaching out. We're not looking for SEO help." },
			{ from: "lee@links.example.com", subject: "Link exchange?", body: "Want to swap links? I run a site in your niche.", reply: "Thanks, but we don't do link exchanges." },
			{ from: "deals@saas.example.net", subject: "15 min to cut your cloud bill?", body: "We help teams like yours save 40% on hosting." },
		],
	},
	{
		id: "seed-otis", name: "Otis", mode: "draft", address: 0,
		job: "When a request is missing the order number or account email, ask for it once.",
		instructions: "Ask only for what's missing. One short paragraph.",
		example: "Could you send your order number? It starts with ORD-.",
		mail: [
			{ from: "kim@customer.example.com", subject: "Refund please", body: "I was charged twice, please refund one.", reply: "Hi Kim,\n\nSorry about that. Could you send the order number? It starts with ORD-.\n\nThanks" },
			{ from: "raj@customer.example.org", subject: "Where's my package", body: "It's been two weeks.", reply: "Could you send your order number so I can look it up?" },
			{ from: "ana@customer.example.net", subject: "Change shipping address", body: "Please ship to my new address instead." },
		],
	},
	{
		id: "seed-mabel", name: "Mabel", mode: "draft", address: 1,
		job: "Tell first-time senders I'll reply within two business days.",
		instructions: "Two sentences. Thank them and say when I'll reply.",
		example: "Thanks for writing. I'll reply within two business days.",
		mail: [
			{ from: "lena@studio.example.org", subject: "Partnership idea", body: "Hi, I run a small design studio and had an idea for working together.", reply: "Hi Lena,\n\nThanks for writing. I'll reply within two business days.\n\nBest" },
			{ from: "tom@press.example.com", subject: "Interview request", body: "Would you be open to a short interview for our newsletter?", reply: "Hi Tom,\n\nThanks for reaching out. I'll get back to you within two business days." },
			{ from: "mia@school.example.net", subject: "Speaking at our meetup", body: "We'd love to have you speak at our October meetup." },
		],
	},
	{
		id: "seed-ira", name: "Ira", mode: "draft", address: 0,
		job: "Answer common product questions the instructions cover.",
		instructions: "Answer only from these instructions. Export is under Settings > Storage. If unsure, say a person will follow up.",
		example: "",
		mail: [
			{ from: "priya@customer.example.com", subject: "How do I export to CSV?", body: "Is there a way to get my data out as CSV?", reply: "Hi Priya,\n\nGo to Settings > Storage > Export and pick CSV.\n\nBest" },
			{ from: "jon@customer.example.org", subject: "Do you support SSO?", body: "Our IT team asks whether you support SAML SSO." },
			{ from: "eve@customer.example.net", subject: "Dark mode?", body: "Is there a dark mode?", reply: "Yes. Settings > General > Theme." },
		],
	},
	{
		id: "seed-dex", name: "Dex", mode: "watch", address: 0,
		job: "Forward billing questions that land on the wrong address to billing.",
		instructions: "Forward, then tell the sender in one line.",
		example: "",
		mail: [
			{ from: "carl@customer.example.com", subject: "Invoice question", body: "Line 3 on my invoice looks wrong." },
			{ from: "dana@customer.example.org", subject: "Charged twice", body: "My card shows two charges this month." },
		],
	},
	{
		id: "seed-juno", name: "Juno", mode: "draft", address: 1,
		job: "Reply to meeting requests with my booking link.",
		instructions: "Offer the booking link example.com/book. Don't propose times.",
		example: "Happy to talk. Grab a time here: example.com/book",
		mail: [
			{ from: "sam@vc.example.com", subject: "Coffee next week?", body: "Would love to grab coffee next week if you're around.", reply: "Hi Sam,\n\nHappy to. Grab a time here: example.com/book\n\nBest" },
			{ from: "ola@partner.example.net", subject: "Quick call about the integration", body: "Can we do a 20 minute call this week?" },
		],
	},
];

/** The life of each message, newest first: the newest are still in flight. */
function plan(i: number, crew: Crew): { state: State; minutesAgo: number; reason: string | null } {
	// One agent is mid-run, so the sample shows a Working badge without every agent looking busy.
	const live = i === 0 && crew.id === "seed-penny" ? "running" : null;
	if (live) return { state: live, minutesAgo: live === "running" ? 0.3 : 1, reason: null };
	if (i === crew.mail.length - 1 && crew.id === "seed-ira") return { state: "failed", minutesAgo: 95, reason: "The model timed out after 3 attempts" };
	if (i === crew.mail.length - 1 && crew.id === "seed-penny") return { state: "skipped", minutesAgo: 60 * 26, reason: "Not this agent's job: a sales pitch, but about hosting" };
	const done: State = crew.mode === "watch" ? "watched" : crew.mode === "send" ? "sent" : "drafted";
	return { state: done, minutesAgo: 20 + i * 140, reason: crew.mode === "watch" ? "Would forward to billing: asks about a charge" : "Matches the job" };
}

const html = (text: string) => text.split("\n\n").map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

export async function seedAgents(env: Env): Promise<{ agents: number; runs: number; drafts: number }> {
	const sql = recordsSql(env);
	const ids = await mailboxIds(env);
	if (ids.length === 0) return { agents: 0, runs: 0, drafts: 0 };
	const addressOf = (i: number | null) => (i === null ? null : ids[i % ids.length]);
	const now = Date.now();
	const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
	const base = Number((await sql.first(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM agents WHERE id NOT LIKE 'seed-%'`))?.p ?? 0);
	let runs = 0;
	let drafts = 0;

	// Seeding again replaces the crew's earlier mail, runs and log rows.
	const old = await sql.all(`SELECT email_id, mailbox_id, draft_id, state, created_at FROM auto_draft_runs WHERE agent_id LIKE 'seed-%'`);
	for (const r of old) {
		const stub = mailStore(env).mailbox(String(r.mailbox_id));
		await stub.deleteEmail(String(r.email_id)).catch(() => {});
		if (r.draft_id) await stub.deleteEmail(String(r.draft_id)).catch(() => {});
		// A seeded send took a slot at its run's time; give it back.
		if (r.state === "sent") await sql.run(`DELETE FROM send_budget WHERE mailbox_id = ? AND actor = 'agent' AND at = ?`, r.mailbox_id, r.created_at);
	}
	await sql.run(`DELETE FROM auto_draft_runs WHERE agent_id LIKE 'seed-%'`);
	await sql.run(`DELETE FROM agent_activity WHERE target IN (SELECT value FROM json_each(?)) OR summary LIKE '%@cloud.example.org%' OR client LIKE 'Claude %'`,
		JSON.stringify(old.map((r) => String(r.email_id))));

	for (const [n, crew] of CREW.entries()) {
		const own = addressOf(crew.address);
		await sql.run(
			`INSERT OR REPLACE INTO agents (id, name, job, addresses, rules, instructions, example_reply, mode, enabled, position, daily_limit, per_sender_limit, created_at, updated_at)
			VALUES (?, ?, ?, ?, '[]', ?, ?, ?, 1, ?, 25, 2, ?, ?)`,
			crew.id, crew.name, crew.job, JSON.stringify(own ? [own] : []), crew.instructions, crew.example, crew.mode, base + n, iso(60 * 24 * 9), iso(60 * 24 * 2),
		);
		for (const [i, mail] of crew.mail.entries()) {
			const mailboxId = own ?? ids[i % ids.length];
			const stub = mailStore(env).mailbox(mailboxId);
			const { state, minutesAgo, reason } = plan(i, crew);
			const at = iso(minutesAgo);
			const emailId = crypto.randomUUID();
			await stub.createEmail(Folders.INBOX, {
				id: emailId, subject: mail.subject, sender: mail.from, recipient: mailboxId, date: at, body: html(mail.body),
				read: state !== "queued" && state !== "running", starred: false, thread_id: emailId, message_id: `${emailId}@seed.local`,
				raw_headers: JSON.stringify([{ key: "from", value: `"${mail.from.split("@")[0]}" <${mail.from}>` }]),
			}, []);

			let draftId: string | null = null;
			const reply = mail.reply ?? (crew.example || "Thanks for writing. A person will follow up shortly.");
			if (state === "drafted" || state === "sent") {
				draftId = crypto.randomUUID();
				await stub.createEmail(state === "sent" ? Folders.SENT : Folders.DRAFT, {
					id: draftId, subject: `Re: ${mail.subject}`, sender: mailboxId, recipient: mail.from, date: iso(minutesAgo - 0.5),
					body: html(reply), read: true, in_reply_to: emailId, email_references: null, thread_id: emailId,
				}, []);
				if (state === "drafted") {
					await stub.setDraftNotes(draftId, { origin: "auto-draft", agent: crew.name, instructions: [] });
					drafts++;
				}
			}
			await sql.run(
				`INSERT OR REPLACE INTO auto_draft_runs (email_id, mailbox_id, thread_id, sender, state, attempts, reason, draft_id, agent_id, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				emailId, mailboxId, emailId, mail.from, state, state === "failed" ? 3 : state === "queued" ? 0 : 1, reason, draftId, crew.id, at,
				state === "running" ? iso(0) : at,
			);
			runs++;
			// Count the send against the address's limits, as a real send does, so Overview agrees with Your agents.
			if (state === "sent") await sql.run(`INSERT INTO send_budget (mailbox_id, actor, recipients, at) VALUES (?, 'agent', 1, ?)`, mailboxId, at);

			const log = (tool: string, summary: string, ok = true, mins = minutesAgo - 0.5) => sql.run(
				`INSERT INTO agent_activity (at, mailbox_id, actor, client, action, tool, target, summary, ok) VALUES (?, ?, 'auto-draft', NULL, ?, ?, ?, ?, ?)`,
				iso(mins), mailboxId, tool === "send_draft" ? "send" : tool === "draft_reply" ? "draft" : "read", tool, emailId, summary, ok ? 1 : 0,
			);
			if (state === "running") await log("get_thread", `${crew.name} · reading "${mail.subject}"`, true, 0.2);
			if (state === "drafted") await log("draft_reply", `${crew.name} · to ${mail.from} · Re: ${mail.subject}`);
			if (state === "sent") await log("send_draft", `${crew.name} · to ${mail.from} · Re: ${mail.subject}`);
			if (state === "failed") await log("draft_reply", `${crew.name} · ${reason}`, false);
		}
	}

	// Tools reaching in over MCP, so Logs shows more than agents.
	const mcp = [
		{ client: "Claude Desktop 1.4", tool: "search_emails", summary: `"invoice october" · 4 matched`, mins: 3 },
		{ client: "Claude Desktop 1.4", tool: "get_thread", summary: "Invoice for October", mins: 2.5 },
		{ client: "Claude Code 2.3", tool: "draft_email", summary: "to ops@cloud.example.org · Deploy notes", mins: 40 },
	];
	for (const m of mcp) {
		await sql.run(
			`INSERT INTO agent_activity (at, mailbox_id, actor, client, action, tool, target, summary, ok) VALUES (?, ?, 'mcp', ?, ?, ?, NULL, ?, 1)`,
			iso(m.mins), ids[0], m.client, m.tool.startsWith("draft") ? "draft" : "read", m.tool, m.summary,
		);
	}
	return { agents: CREW.length, runs, drafts };
}
