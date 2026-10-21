// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// The tools Partwell runs on and the people around them: Vercel, xAI, Resend,
// OpenAI, Claude, Cursor, Linear, Figma, Notes and Supabase notices; Rae's
// illustrations for the docs; Northline's plan change; Cedar's next stage.
// Every figure is invented for the story; nothing quotes a vendor's price.

import { esc, file, money } from "../kit";
import { SIGNERS, button, grid, logo, mail, meta, mono, para, rows, status } from "./brands";
import { P, alex, box } from "./cast";
import type { StoryClock } from "./clock";
import { human } from "./html";
import type { Slot } from "./slots";

export const XAI_INVOICE = { lines: [["Input tokens, 182,400,000", 36.48], ["Output tokens, 21,640,000", 21.64], ["Cached input tokens, 85,600,000", 4.28]] as [string, number][], total: 62.4 };
export const OPENAI_USAGE = { lines: [["Responses API", 14.9], ["Embeddings", 3.32]] as [string, number][], total: 18.22 };
export const RAE_INVOICE = { number: "RC-0312", hours: 14, rate: 110, total: 1540 };
const sum = (lines: [string, number][]) => Math.round(lines.reduce((s, [, v]) => s + v * 100, 0)) / 100;

function hello(c: StoryClock): Slot[] {
	return [
		{
			key: "H-06", box: "hello", folder: "archive", at: "2026-09-29T15:40", from: P.openai, to: [box("hello")],
			subject: "Partwell is now available in ChatGPT", read: true, labels: ["Dev"], thread: "H-06", auto: true,
			html: mail("openai", {
				preheader: "Your connector passed review. Workspaces that allow it can connect Partwell in ChatGPT.",
				heading: "Partwell is now available in ChatGPT",
				body: `${para("openai", "Your connector passed review. People in ChatGPT workspaces that allow connectors can now add Partwell and look up parts in a conversation.")}
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:16px 0;border-top:1px solid #E5E5E5;border-bottom:1px solid #E5E5E5"><tr><td width="40" style="padding:14px 12px 14px 0">${logo("chatgpt-mark", 28, 28, "ChatGPT")}</td><td style="padding:14px 0;font-size:14px;line-height:21px"><strong>Partwell</strong><br><span style="color:#6B6B6B">MCP server · mcp.partwell.dev · 3 tools: search_parts, get_part, list_sources</span></td></tr></table>
${para("openai", "You can update the connector's description and tools from your developer settings. Changes to its tools go through review again.")}
${button("openai", "Open connector settings", "https://platform.openai.com/connectors/partwell")}`,
				footer: "OpenAI · You're receiving this because you're an owner of Partwell's organization.",
			}),
		},
		{
			key: "H-07", box: "hello", folder: "archive", at: "2026-10-03T11:05", from: P.cursor, to: [box("hello")],
			subject: "Partwell was added to the Cursor MCP directory", read: true, labels: ["Dev"], thread: "H-07", auto: true,
			html: mail("cursor", {
				preheader: "Developers can install Partwell from the MCP directory in Cursor with one click.",
				heading: "Partwell is in the MCP directory",
				body: `${para("cursor", "Developers can now install Partwell from the MCP directory in Cursor. The install adds this entry to their project:")}
${mono("cursor", `// .cursor/mcp.json
{
  "mcpServers": {
    "partwell": { "url": "https://mcp.partwell.dev/mcp" }
  }
}`)}
${meta("cursor", [["Listing", "partwell"], ["Tools", "search_parts, get_part, list_sources"], ["Auth", "OAuth"]])}
${button("cursor", "View listing", "https://cursor.com/mcp/partwell")}`,
				footer: "Cursor · You're receiving this because you submitted a listing.",
			}),
		},
		{
			key: "H-08", box: "hello", folder: "archive", at: "2026-09-28T12:15", from: P.buildnotes, to: [box("hello")],
			subject: "Rate limits people can actually understand", read: true, labels: ["Newsletters"], thread: "H-08", auto: true,
			list: { id: "small-apis.buildnotes.news", unsubscribe: "https://buildnotes.news/unsubscribe?list=small-apis", oneClick: true },
			html: mail("buildnotes", {
				preheader: "Three rate-limit error messages that tell a developer what to do next, and two that don't.",
				eyebrow: `Issue 111 · ${c.day("2026-09-28")}`,
				heading: "Rate limits people can actually understand",
				body: `${para("buildnotes", "A rate limit is a conversation with a developer who is having a bad day. Most APIs answer with a bare 429 and leave them to guess when to try again.")}
${para("buildnotes", "This week I read the error responses of twenty small APIs. The good ones did three things: they said which limit was hit, how much of it was left, and when it resets, in the body and in headers a client can read without parsing prose.")}
${para("buildnotes", "The best one I found sends <code>Retry-After</code>, a limit name like <code>per_key_concurrency</code>, and a link to the page that explains it. A client library can back off on its own, and a person reading logs at midnight knows which knob to turn.")}
${para("buildnotes", "Two patterns to avoid: limits that count failed retries, so a client that retries quickly locks itself out for longer, and limits that differ between documentation and production.")}
${para("buildnotes", "Next week: small APIs worth trying. Send me yours.")}
${para("buildnotes", "Rosa Lind<br>Editor, Build Notes")}`,
				footer: `<a href="https://buildnotes.news/preferences" style="color:#6E6A60">Email preferences</a> · <a href="https://buildnotes.news/unsubscribe?list=small-apis" style="color:#6E6A60">Unsubscribe</a> · <a href="https://buildnotes.news/archive" style="color:#6E6A60">Past issues</a>`,
			}),
		},
		{
			key: "H-09", box: "hello", folder: "archive", at: "2026-09-29T10:20", from: P.claude, to: [box("hello")],
			subject: "Your connector is live in Claude", read: true, labels: ["Dev"], thread: "H-09", auto: true,
			html: mail("claude", {
				preheader: "Partwell is listed in the connectors directory. People can add it from Claude's settings.",
				heading: "Partwell is live in the connectors directory",
				body: `${para("claude", "People can now add Partwell from the connectors directory in Claude. When they ask about a part, Claude can call your server's tools and cite what they return.")}
${grid("claude", ["Connector", "Detail"], [["Name", "Partwell"], ["Server", "mcp.partwell.dev"], ["Tools", "3"], ["Status", "Listed"]])}
${para("claude", "Your listing uses the description and examples you submitted. You can change them from the Anthropic Console at any time.")}
${button("claude", "View your listing", "https://claude.ai/directory/partwell")}`,
				footer: `${logo("anthropic-wordmark", 98, 11, "Anthropic")}<br>You're receiving this because you submitted this connector.`,
			}),
		},
	];
}

function support(c: StoryClock): Slot[] {
	return [
		{
			key: "SUP-09", box: "support", folder: "inbox", at: "2026-10-06T11:30", from: P.ben, to: [box("support")],
			subject: "Moving Northline to the Growth plan?", read: true, labels: ["Support"], thread: "SUP-09",
			html: human(`Hi Alex,

We want to give the warehouse scanners their own key, and keep staging separate from production. That's five keys, and Starter gives us two.

We're also on track for about 600,000 requests this month now that the catalog sync runs nightly.

What would Growth cost us, and does it start from today or the next billing date?

Ben`, SIGNERS.ben),
		},
		{
			key: "SUP-10", box: "support", folder: "sent", at: "2026-10-06T13:05", from: alex("support"), to: [P.ben],
			subject: "Re: Moving Northline to the Growth plan?", read: true, labels: ["Support", "Waiting on customer"], thread: "SUP-09", replyTo: "SUP-09",
			quote: "What would Growth cost us, and does it start from today or the next billing date?",
			html: human(`Hi Ben,

Growth is $399 a month: ten API keys, two million requests and a separate staging environment. It starts the day you switch, and the unused part of ${c.month("2026-09-18").name}'s Starter payment comes off the first Growth invoice, so you don't pay twice for ${esc(c.day("2026-10-06"))} onwards.

Nora will get the invoice as usual. Say the word and I'll switch the account.

Alex`, SIGNERS.alexSupport),
		},
	];
}

function billing(c: StoryClock): Slot[] {
	// Monthly bills cover the calendar month before the one they arrive in.
	const billed = c.month("2026-10-01T06:10", 1);
	const closing = c.closing("2026-09-30T16:20");
	const xaiRows: [string, string][] = XAI_INVOICE.lines.map(([k, v]) => [k, money(v)]);
	return [
		{
			key: "B-07", box: "billing", folder: "archive", at: "2026-10-01T06:10", from: P.xaiBilling, to: [box("billing")],
			subject: `Your xAI API invoice for ${billed.name}`, read: true, labels: ["Billing", "Receipts"], thread: "B-07", auto: true,
			attachments: [file.pdf("xAI-invoice-INV-90417.pdf", [
				{ t: "xAI", size: 20, bold: true },
				{ t: "Invoice INV-90417", size: 14, gap: 4 },
				{ t: "Billed to: Partwell (billing@partwell.dev)", gap: 16 },
				{ t: "Team: partwell-normalizer", gap: 2 },
				{ t: `Period: ${c.date(billed.first)} to ${c.date(billed.last)}`, gap: 2 },
				{ t: "", rule: true, gap: 10 },
				...XAI_INVOICE.lines.map(([k, v], i) => ({ t: `${k}: ${money(v)}`, gap: i ? 0 : 6 })),
				{ t: "", rule: true, gap: 6 },
				{ t: `Total: ${money(XAI_INVOICE.total)} USD`, bold: true, gap: 4 },
				{ t: "Charged to the card on file.", gap: 8 },
			], { band: "#0A0A0A", rule: "#292929" })],
			html: mail("xai", {
				preheader: `Invoice INV-90417: ${money(XAI_INVOICE.total)} for API usage in ${billed.name}.`,
				eyebrow: "INVOICE INV-90417 · PARTWELL-NORMALIZER",
				heading: `${money(XAI_INVOICE.total)} for ${billed.name}`,
				body: `${para("xai", `Your API usage for ${billed.name} has been charged to the card on file. The invoice is attached.`)}
${rows("xai", [...xaiRows, ["Total", money(XAI_INVOICE.total), "total"]])}
${button("xai", "View invoice", "https://console.x.ai/team/partwell-normalizer/billing")}`,
				footer: "xAI · API billing. Questions about this invoice: reply to this email.",
			}),
		},
		{
			key: "B-08", box: "billing", folder: "archive", at: "2026-10-01T09:00", from: P.openai, to: [box("billing")],
			subject: `Your OpenAI API usage for ${billed.name}`, read: true, labels: ["Billing", "Receipts"], thread: "B-08", auto: true,
			html: mail("openai", {
				preheader: `Project partwell-connector-tests used ${money(OPENAI_USAGE.total)} in ${billed.name}.`,
				heading: `${billed.name} usage`,
				body: `${meta("openai", [["Organization", "Partwell"], ["Project", "partwell-connector-tests"]])}
${rows("openai", [...OPENAI_USAGE.lines.map(([k, v]) => [k, money(v)] as [string, string]), ["Total", money(OPENAI_USAGE.total), "total"]])}
${para("openai", "Your monthly budget for this project is $50.00. You can change it in your project's limits.", "color:#6B6B6B")}
${button("openai", "View usage", "https://platform.openai.com/usage")}`,
				footer: "OpenAI · You're receiving this because you're an owner of Partwell's organization.",
			}),
		},
		{
			key: "B-09", box: "billing", folder: "archive", at: "2026-10-07T08:30", from: P.anthropic, to: [box("billing")],
			subject: "You've used half of your monthly spend limit", read: true, labels: ["Billing"], thread: "B-09", auto: true,
			html: mail("claude", {
				preheader: "Partwell has used $51.30 of its $100.00 monthly spend limit on the Claude API.",
				heading: "Half of this month's limit is used",
				body: `${para("claude", "Your organization <strong>Partwell</strong> has used <strong>$51.30</strong> of its <strong>$100.00</strong> monthly spend limit on the Claude API. Nothing changes until you reach the limit; then requests are refused until the month resets or you raise it.")}
${grid("claude", ["Workspace", "Spend this month"], [["connector-evals", "$44.10"], ["docs-assistant", "$7.20"], ["Total", "$51.30"]], { strong: 2 })}
${button("claude", "Review limits", "https://console.anthropic.com/settings/limits")}`,
				footer: `${logo("anthropic-wordmark", 98, 11, "Anthropic")}<br>You're receiving this because you're an admin of Partwell.`,
			}),
		},
		{
			key: "B-10", box: "billing", folder: "archive", at: "2026-09-30T16:20", from: P.tess, to: [box("billing")],
			subject: `${closing} close: payout report and the Fieldstone invoice`, read: true, labels: ["Billing"], thread: "B-10",
			html: human(`Hi Alex,

Closing ${closing} this week. Two things I don't have:

- The Stripe payout report for ${closing}, as a CSV from the Stripe dashboard.
- Fieldstone's invoice for the catalog license. Their last one came at the start of the term last ${c.month("2026-11-01").name}, so the next may not be due until then. If so, tell me and I'll accrue it.

Tess`, SIGNERS.tess),
		},
	];
}

function partners(c: StoryClock): Slot[] {
	const figmaFile = "https://www.figma.com/file/Pw9Docs/partwell-docs-illustrations";
	return [
		{
			key: "P-07", box: "partners", folder: "inbox", at: "2026-10-02T10:45", from: P.rae, to: [alex("partners")],
			subject: "Docs illustrations, first pass 🎨", read: true, labels: ["Design"], thread: "P-07",
			html: human(`Hi Alex,

First pass of the docs illustrations is in Figma: ${figmaFile}

Three frames: the hero for the getting-started page, a small "how a lookup works" diagram, and the freshness badge on a part card. I kept your teal and the bracket mark, and added one warm accent so the diagrams don't feel like a dashboard.

Two questions:

- Should the freshness badge show a date ("${c.short("2026-09-28")}") or a status ("Fresh")? I lean towards the date; it's what Priya's field actually says.
- Do you want Claude, ChatGPT and Cursor named in the diagram, or a generic "your assistant"?

No rush, but I'd like to finish by the ${c.nth("2026-10-09")} 🙂

Rae`, SIGNERS.rae),
		},
		{
			key: "P-08", box: "partners", folder: "sent", at: "2026-10-02T13:20", from: alex("partners"), to: [P.rae],
			subject: "Re: Docs illustrations, first pass 🎨", read: true, labels: ["Design"], thread: "P-07", replyTo: "P-07",
			quote: `Should the freshness badge show a date ("${c.short("2026-09-28")}") or a status ("Fresh")?`,
			html: human(`Hi Rae,

These are good. The lookup diagram explains the product better than my README does.

The date, please. A status would claim more than we know.

Name the clients in the diagram: Claude, ChatGPT, Cursor and Codex. People look for their own tool first.

The ${c.nth("2026-10-09")} works.

Alex`),
		},
		{
			key: "P-09", box: "partners", folder: "archive", at: "2026-10-02T10:41", from: P.figma, to: [alex("partners")],
			subject: "Rae Collins shared “Partwell docs illustrations” with you", read: true, labels: ["Design"], thread: "P-09", auto: true,
			html: mail("figma", {
				preheader: "Rae Collins invited you to edit Partwell docs illustrations.",
				heading: "Rae Collins shared a design file with you",
				body: `${para("figma", "Rae Collins (rae@raecollins.design) invited you to <strong>edit</strong> this file.")}
<a href="${figmaFile}" style="display:block;text-decoration:none;color:#1E1E1E;border:1px solid #E6E6E6;border-radius:6px;overflow:hidden">${logo("rae-docs-illustration", 536, 300, "Preview of the Partwell docs illustrations file")}<span style="display:block;padding:12px 14px;font-size:14px;font-weight:600">Partwell docs illustrations</span></a>
${button("figma", "Open in Figma", figmaFile)}`,
				footer: "Figma · You can change which emails you receive in your account settings.",
			}).replace('style="display:block;border:0;width:536px;height:300px"', 'style="display:block;border:0;width:100%;height:auto"'),
		},
		{
			key: "P-10", box: "partners", folder: "inbox", at: "2026-10-07T15:12", from: P.figma, to: [alex("partners")],
			subject: "Rae Collins mentioned you in “Partwell docs illustrations”", read: false, labels: ["Design"], thread: "P-10", auto: true,
			html: mail("figma", {
				preheader: `@Alex Should the badge say “Updated ${c.short("2026-09-28")}” or just “${c.short("2026-09-28")}”?`,
				heading: "Rae Collins mentioned you",
				body: `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:4px 0 16px"><tr><td style="vertical-align:top;padding-right:10px">${logo("rae-collins", 32, 32)}</td><td style="font-size:14px;line-height:22px"><strong>Rae Collins</strong> <span style="color:#757575">on Freshness badge</span><br>@Alex Should the badge say “Updated ${c.short("2026-09-28")}” or just “${c.short("2026-09-28")}”? The shorter one fits on the mobile part card.</td></tr></table>
${button("figma", "Reply in Figma", `${figmaFile}?comment=freshness-badge`)}`,
				footer: "Figma · You're receiving this because you were mentioned.",
			}),
		},
		{
			key: "P-11", box: "partners", folder: "inbox", at: "2026-10-10T09:30", from: P.rae, to: [alex("partners")],
			subject: `Invoice ${RAE_INVOICE.number}: Partwell docs illustrations`, read: false, labels: ["Design", "Billing"], thread: "P-11",
			attachments: [file.pdf(`${RAE_INVOICE.number}.pdf`, [
				{ t: "Rae Collins Design", size: 20, bold: true, color: "#6C4B85" },
				{ t: "rae@raecollins.design  ·  raecollins.design", gap: 2 },
				{ t: `Invoice ${RAE_INVOICE.number}`, size: 15, bold: true, gap: 20 },
				{ t: `Date: ${c.date("2026-10-10")}`, gap: 6 },
				{ t: "Bill to: Partwell, attn. Alex Rivera (partners@partwell.dev)" },
				{ t: "", rule: true, gap: 12 },
				{ t: `Docs illustrations: hero, lookup diagram, freshness badge`, gap: 6 },
				{ t: `${RAE_INVOICE.hours} hours x ${money(RAE_INVOICE.rate)}: ${money(RAE_INVOICE.total)}` },
				{ t: "", rule: true, gap: 6 },
				{ t: `Total due: ${money(RAE_INVOICE.total)} USD`, bold: true, gap: 4 },
				{ t: `Due: ${c.date("2026-10-24")} (14 days)`, gap: 8 },
			], { band: "#6C4B85", rule: "#E2967D" })],
			html: human(`Hi Alex,

Final files are in the Figma project and exported to the shared folder (SVG and PNG at 1x and 2x).

My invoice for the illustrations is attached: ${RAE_INVOICE.hours} hours, ${money(RAE_INVOICE.total)}, due in 14 days.

Thanks for the quick answers. The dated badge was the right call.

Rae`, SIGNERS.rae),
		},
	];
}

function ops(c: StoryClock): Slot[] {
	const vercelProject = "https://vercel.com/partwell/partwell-docs";
	const used = c.month("2026-10-01T08:00", 1);
	return [
		{
			key: "O-09", box: "ops", folder: "archive", at: "2026-10-01T08:00", from: P.vercel, to: [box("ops")],
			subject: `Your Vercel usage for ${used.name}`, read: true, labels: ["Dev"], thread: "O-09", auto: true,
			html: mail("vercel", {
				preheader: `partwell-docs: 1.42M edge requests and 18.6 GB of data transfer in ${used.name}.`,
				heading: `${used.name} usage`,
				body: `${meta("vercel", [["Team", "partwell"], ["Project", "partwell-docs"], ["Period", `${c.short(used.first)} – ${c.short(used.last)}`]])}
${grid("vercel", ["Resource", "Used", "Included"], [["Edge requests", "1.42M", "10M"], ["Fast data transfer", "18.6 GB", "1 TB"], ["Function invocations", "212K", "1M"], ["Build minutes", "96", "6,000"]], { mono: [1, 2] })}
${para("vercel", "Nothing is over the included amount this month.")}
${button("vercel", "View usage", `${vercelProject}/usage`)}`,
				footer: "Vercel · You're receiving this because you're a member of the partwell team.",
			}),
		},
		{
			key: "O-10", box: "ops", folder: "archive", at: "2026-10-06T14:22", from: P.vercel, to: [box("ops")],
			subject: "Failed production deployment on partwell-docs", read: true, labels: ["Dev"], thread: "O-10", auto: true,
			html: mail("vercel", {
				preheader: "Build failed on main (3f9a1c2): broken link /guides/freshness#per-record.",
				heading: "Deployment failed",
				body: `<p style="margin:0 0 14px">${status("Error", "bad")}</p>
${meta("vercel", [["Project", "partwell-docs"], ["Environment", "Production"], ["Branch", "main"], ["Commit", "3f9a1c2 Add freshness field guide"], ["Duration", "48s"]])}
${mono("vercel", `Error: Broken link in docs/mcp.md:41
  /guides/freshness#per-record does not exist
  Build failed because of 1 broken link.`)}
${button("vercel", "View build logs", `${vercelProject}/deployments/dpl_3f9a1c2`)}`,
				footer: "Vercel Inc. · You're receiving this because you're a member of the partwell team.",
			}),
		},
		{
			key: "O-11", box: "ops", folder: "archive", at: "2026-10-06T14:41", from: P.vercel, to: [box("ops")],
			subject: "Deployment ready: partwell-docs", read: true, thread: "O-10", replyTo: "O-10", auto: true,
			html: mail("vercel", {
				preheader: "docs.partwell.dev is live with commit 7d04e8b.",
				heading: "Deployment ready",
				body: `<p style="margin:0 0 14px">${status("Ready", "ok")}</p>
${meta("vercel", [["Project", "partwell-docs"], ["Environment", "Production"], ["Domain", "docs.partwell.dev"], ["Branch", "main"], ["Commit", "7d04e8b Fix freshness guide link"], ["Duration", "1m 12s"]])}
${button("vercel", "Visit", "https://docs.partwell.dev")}`,
				footer: "Vercel Inc. · You're receiving this because you're a member of the partwell team.",
			}),
		},
		{
			key: "O-12", box: "ops", folder: "archive", at: "2026-09-29T09:14", from: P.xai, to: [box("ops")],
			subject: "A new API key was created", read: true, labels: ["Dev"], thread: "O-12", auto: true,
			html: mail("xai", {
				preheader: "A new API key, catalog-batch-prod, was created for team partwell-normalizer.",
				eyebrow: "SECURITY NOTICE · PARTWELL-NORMALIZER",
				heading: "A new API key was created",
				body: `${rows("xai", [["Key name", "catalog-batch-prod"], ["Key", "xai-••••••••••••3f2c"], ["Created by", "ops@partwell.dev"], ["Created", `${c.long(c.at("2026-09-29T09:14"))}`]])}
${para("xai", "If you didn't create this key, delete it from the console and rotate your other keys.")}
${button("xai", "Manage API keys", "https://console.x.ai/team/partwell-normalizer/api-keys")}`,
				footer: "xAI · You're receiving this because you're a member of partwell-normalizer.",
			}),
		},
		{
			key: "O-13", box: "ops", folder: "archive", at: "2026-10-07T18:30", from: P.xai, to: [box("ops")],
			subject: "You've used 80% of your monthly spending limit", read: true, labels: ["Dev"], thread: "O-13", auto: true,
			html: mail("xai", {
				preheader: "partwell-normalizer has used $80.12 of its $100.00 monthly limit.",
				eyebrow: "USAGE · PARTWELL-NORMALIZER",
				heading: "80% of this month's limit is used",
				body: `${rows("xai", [["Spent this month", "$80.12"], ["Monthly limit", "$100.00"], ["Largest key", "catalog-batch-prod, $71.40"], ["Largest day", `${c.short(c.month("2026-10-07T18:30").first)}, $58.20`]])}
${para("xai", "When the limit is reached, requests return an error until the next month or until you raise it.")}
${button("xai", "Change limit", "https://console.x.ai/team/partwell-normalizer/billing")}`,
				footer: "xAI · API usage notices go to team admins.",
			}),
		},
		{
			key: "O-14", box: "ops", folder: "sent", at: "2026-09-25T11:20", from: alex("ops"), to: [P.resendSupport],
			subject: "partwell.dev DKIM record not verifying", read: true, labels: ["Dev"], thread: "O-14",
			html: human(`Hi,

I added the three DNS records for partwell.dev yesterday afternoon. SPF and the MX record verified within the hour; DKIM still shows Pending.

The record I added is a TXT record named \`resend._domainkey.partwell.dev\`. A lookup from my machine returns nothing for that name.

Is there a usual cause?

Alex`, SIGNERS.alexPartwell),
		},
		{
			key: "O-15", box: "ops", folder: "archive", at: "2026-09-25T14:02", from: P.resendSupport, to: [alex("ops")],
			subject: "Re: partwell.dev DKIM record not verifying", read: true, thread: "O-14", replyTo: "O-14",
			quote: "The record I added is a TXT record named resend._domainkey.partwell.dev.",
			html: human(`Hi Alex,

Your DNS provider appends the domain to every name you enter, so the record exists as \`resend._domainkey.partwell.dev.partwell.dev\`. I can see it there.

Change the name to \`resend._domainkey\` and it should verify within a few minutes. You don't need to remove anything else.

Zeno
Resend Support`) + logo("resend-icon", 18, 18),
		},
		{
			key: "O-16", box: "ops", folder: "archive", at: "2026-09-25T15:10", from: P.resend, to: [box("ops")],
			subject: "partwell.dev is verified", read: true, labels: ["Dev"], thread: "O-16", auto: true,
			html: mail("resend", {
				preheader: "All DNS records for partwell.dev are verified. You can send from any address at partwell.dev.",
				heading: "partwell.dev is verified",
				body: `<p style="margin:0 0 14px">${status("Verified", "ok")}</p>
${para("resend", "You can now send email from any address at partwell.dev.")}
${grid("resend", ["Type", "Name", "Status"], [["MX", "send", "Verified"], ["TXT", "send", "Verified"], ["TXT", "resend._domainkey", "Verified"]], { mono: [1] })}
${button("resend", "View domain", "https://resend.com/domains/partwell.dev")}`,
				footer: "Resend · Domain notifications for partwell.dev.",
			}),
		},
		{
			key: "O-17", box: "ops", folder: "archive", at: "2026-09-22T10:30", from: P.linear, to: [box("ops")],
			subject: "PW-212 Pagination skips records after a filter change", read: true, labels: ["Dev"], thread: "O-17", auto: true,
			html: mail("linear", {
				preheader: "Alex Rivera created PW-212 in API: Pagination skips records after a filter change.",
				eyebrow: "PW-212 · API",
				heading: "Pagination skips records after a filter change",
				body: `${meta("linear", [["Created by", "Alex Rivera"], ["Assignee", "Alex Rivera"], ["Priority", "High"], ["State", "Todo"]])}
<div style="margin:6px 0 14px;padding:12px 14px;border:1px solid #E5E7EB;border-radius:12px;font-size:14px;line-height:22px">Harbor Assembly reports that changing a filter between pages skips 30 records. Cursor carries the old offset into the new filter. Should return 400 cursor_filter_mismatch. Repro in support thread from June Park.</div>
${button("linear", "Open issue", "https://linear.app/partwell/issue/PW-212")}`,
				footer: "Linear · You're receiving this because you're subscribed to PW-212.",
			}),
		},
		{
			key: "O-18", box: "ops", folder: "archive", at: "2026-09-22T14:06", from: P.linear, to: [box("ops")],
			subject: "PW-212 moved to Done", read: true, thread: "O-17", replyTo: "O-17", auto: true,
			html: mail("linear", {
				preheader: "PW-212 Pagination skips records after a filter change: In Progress → Done.",
				eyebrow: "PW-212 · API",
				heading: "Pagination skips records after a filter change",
				body: `<p style="margin:0 0 14px">${status("Done", "ok")} <span style="color:#6B6F76;font-size:13px">In Progress → Done, by Alex Rivera</span></p>
${para("linear", "Linked pull request #184 merged. Customer confirmation is tracked in the support thread.", "color:#6B6F76")}
${button("linear", "Open issue", "https://linear.app/partwell/issue/PW-212")}`,
				footer: "Linear · You're receiving this because you're subscribed to PW-212.",
			}),
		},
		{
			key: "O-19", box: "ops", folder: "inbox", at: "2026-10-09T09:12", from: P.supabaseNotice, to: [box("ops")],
			subject: "Compute upgrade scheduled for partwell-prod", read: true, labels: ["Incident"], thread: "O-19", auto: true,
			html: mail("supabase", {
				preheader: `partwell-prod moves from Small to Medium compute today at 11:00 AM. Expect a reconnect of about two minutes.`,
				heading: "Compute upgrade scheduled",
				body: `${rows("supabase", [["Project", "partwell-prod"], ["Change", "Small → Medium compute"], ["Scheduled", `${c.day("2026-10-09")}, 11:00 AM ${c.zone(c.at("2026-10-09T11:00"))}`], ["Expected reconnect", "about 2 minutes"], ["Estimated charge this month", money(45)]])}
${para("supabase", "Connections drop once while the database restarts on the new size. Clients using the connection pooler reconnect on their own.")}
${button("supabase", "View project", "https://supabase.com/dashboard/project/partwell-prod/settings/compute")}`,
				footer: "Supabase · Project notifications for partwell-prod.",
			}),
		},
		{
			key: "O-20", box: "ops", folder: "inbox", at: "2026-10-10T16:45", from: P.notes, to: [box("ops")],
			subject: `Priya Shah shared “${c.short("2026-10-08")} incident review” with you`, read: true, labels: ["Incident"], thread: "O-20", auto: true,
			html: mail("notes", {
				preheader: "Timeline, what we change, and the next Cedar stage.",
				heading: `${c.short("2026-10-08")} incident review`,
				body: `${para("notes", "<strong>Priya Shah</strong> shared a note with you.", "color:#6B7280")}
<div style="margin:0 0 16px;padding:14px 16px;border:1px solid #E3E5E8;border-radius:8px;font-size:14px;line-height:22px">
<strong>Timeline</strong><br>23:37 latency alert · 23:38 throttling · 00:09 case DB-4821 opened · 00:41 first customer report · 02:36 recovered<br><br>
<strong>What we change</strong><br>Read cache stays on. Per-key concurrency limit of 20 until the next Cedar stage runs cleanly. Status page update within 10 minutes of an alert.<br><br>
<strong>Next rollout</strong><br>Cedar: 5 → 15 stores on Tuesday. Client cap 8 or 16: decision needed by Monday.</div>
${button("notes", "Open note", "https://notes.partwell.dev/workspace/partwell/oct-8-incident-review")}`,
				footer: "Notes · notes.partwell.dev",
			}),
		},
		{
			key: "O-21", box: "ops", folder: "inbox", at: "2026-10-10T11:40", from: P.lena, to: [box("ops")], cc: [P.priya],
			subject: "Rollout summary and next stage", read: true, labels: ["Cedar"], thread: "O-21",
			attachments: [file.pdf("cedar-rollout-summary.pdf", [
				{ t: "Cedar Supply", size: 20, bold: true, color: "#244B3C" },
				{ t: "Store assistant rollout: summary", size: 14, gap: 4 },
				{ t: `Prepared by Lena Park, ${c.date("2026-10-10")}`, gap: 6 },
				{ t: "", rule: true, gap: 10 },
				{ t: "What happened", size: 13, bold: true, gap: 8 },
				{ t: `${c.day("2026-10-08")}, about 23:30: a configuration flag enabled the assistant in 26 stores`, gap: 4 },
				{ t: "instead of 5. The client sent up to 32 parallel lookups and retried at once on timeout." },
				{ t: "Since then", size: 13, bold: true, gap: 12 },
				{ t: "- Back to 5 stores. Client capped at 8 concurrent requests, with exponential backoff.", gap: 4 },
				{ t: "- 3,900 lookups a day with no errors since the fix." },
				{ t: "Proposal", size: 13, bold: true, gap: 12 },
				{ t: `- Tuesday ${c.day("2026-10-13")}: 15 stores.`, gap: 4 },
				{ t: "- Raise the client cap from 8 to 16 at the same time." },
				{ t: `- All 41 stores in ${c.part("2026-11-05")} if the 15-store stage holds for a week.` },
			], { band: "#244B3C", rule: "#D9DDD4" })],
			html: human(`Hi Alex,

Summary of Thursday and where we are now is attached. The short version: a flag turned the assistant on in 26 stores instead of 5, and our client retried far too eagerly. That's fixed on our side.

We'd like to go to 15 stores on Tuesday, and raise our concurrency cap from 8 to 16 at the same time so lookups stay fast at the counter.

Can you and Priya confirm by Monday?

Lena`, SIGNERS.lena),
		},
		{
			key: "O-22", box: "ops", folder: "sent", at: "2026-10-10T13:15", from: alex("ops"), to: [P.lena], cc: [P.priya],
			subject: "Re: Rollout summary and next stage", read: true, labels: ["Cedar"], thread: "O-21", replyTo: "O-21",
			quote: "Can you and Priya confirm by Monday?",
			html: human(`Hi Lena,

Thanks for the write-up. It matches what we saw.

Fifteen stores on Tuesday is fine from our side. Priya is rerunning the load test with your new client settings, and we'll confirm the concurrency cap by Monday.

Alex`, SIGNERS.alexPartwell),
		},
	];
}

export function toolSlots(c: StoryClock): Slot[] {
	return [...hello(c), ...support(c), ...billing(c), ...partners(c), ...ops(c)];
}

export const TOOL_SUMS = { xai: () => sum(XAI_INVOICE.lines), openai: () => sum(OPENAI_USAGE.lines), rae: () => RAE_INVOICE.hours * RAE_INVOICE.rate };
