// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Partwell's five mailboxes: hello, support, billing, partners and ops.

import { esc, file, money } from "../kit";
import { BRANDS, SIGNERS, button, grid, mail, meta, mono, para, rows, signature, status } from "./brands";
import { P, alex, box } from "./cast";
import type { StoryClock } from "./clock";
import { human, photo, photoPart } from "./html";
import type { Slot } from "./slots";

// ── Fixed facts ─────────────────────────────────────────────────────

export const NORTHLINE_INVOICE = { number: "PW-1042", amount: 149, tax: 0 };
export const CEDAR_INVOICE = { number: "PW-1068", amount: 1200, tax: 0, po: "CED-4417" };
export const PAYOUT = { gross: 1349, fees: 39.12, net: 1309.88 };
export const DB_ESTIMATE = 45;

const h3 = (text: string, font = "inherit") => `<h3 style="margin:26px 0 6px;font-family:${font};font-size:19px;line-height:26px;font-weight:400">${esc(text)}</h3>`;
const REPO = "alexrivera/partwell";
/** Atlas names a batch for the day it goes out: CAT-0930. */
const batchId = (c: StoryClock) => `CAT-${c.iso("2026-09-30").slice(5).replace("-", "")}`;

// ── hello@ ─────────────────────────────────────────────────────────

function hello(c: StoryClock): Slot[] {
	const pilotStart = c.date("2026-10-01");
	const pilotEnd = c.date("2026-10-28");
	return [
		{
			key: "H-01", box: "hello", folder: "inbox", at: "2026-09-24T10:07", from: P.lena, to: [box("hello")],
			subject: "Could Partwell power our store assistant?", read: true, starred: true, labels: ["Cedar"], thread: "H-01",
			html: human(`Hi Alex,

I lead engineering at Cedar Supply. We run 41 hardware and building-supply stores, and we're building an assistant for store employees. Someone at the contractor desk asks for a stainless lag bolt that fits a particular bracket, and the assistant finds the part, the substitutes and what's on the shelf.

Our catalog comes from about thirty manufacturers, each with its own spreadsheet habits. A colleague saw your talk on the MCP connector and sent me the docs, and the normalized schema looks like the piece we've been missing.

Three questions before I take this to our team:

- Which MCP clients do you support today? Store operations would use Claude, and our help desk is testing ChatGPT.
- Can every answer carry its source? If the assistant recommends a part, staff need to see which manufacturer file it came from.
- How fresh is the data? Some suppliers update prices weekly, and a few change part numbers without telling anyone.

If it fits, we'd like a four-week pilot in five stores starting ${c.part("2026-10-01")}. I'm happy to get on a call next week, any afternoon except Thursday.

Thanks,
Lena`, SIGNERS.lena),
		},
		{
			key: "H-02", box: "hello", folder: "inbox", at: "2026-09-28T09:10", from: P.omar, to: [box("hello")], cc: [P.lena],
			subject: `Pilot approved — PO ${CEDAR_INVOICE.po}`, read: true, labels: ["Cedar"], thread: "H-02",
			attachments: [file.pdf(`${CEDAR_INVOICE.po}-purchase-order.pdf`, [
				{ t: "Cedar Supply Co.", size: 20, bold: true },
				{ t: "Purchase Order", size: 14, gap: 4 },
				{ t: `PO number: ${CEDAR_INVOICE.po}`, bold: true, gap: 18 },
				{ t: `Date: ${c.date("2026-09-28")}`, gap: 2 },
				{ t: "Vendor: Partwell (hello@partwell.dev)", gap: 2 },
				{ t: "Bill to: Cedar Supply Co., Accounts Payable (omar@cedarsupply.co)", gap: 2 },
				{ t: "Requested by: Lena Park, Engineering Lead", gap: 2 },
				{ t: "Approved by: Omar Reed, Finance Manager", gap: 2 },
				{ t: "Line  Description                                   Qty   Unit price    Amount", bold: true, gap: 20 },
				{ t: `1     Partwell API pilot, 4 weeks                    1     ${money(CEDAR_INVOICE.amount)}     ${money(CEDAR_INVOICE.amount)}`, gap: 4 },
				{ t: `      ${pilotStart} to ${pilotEnd}` },
				{ t: `Subtotal: ${money(CEDAR_INVOICE.amount)}`, gap: 14 },
				{ t: `Tax: ${money(CEDAR_INVOICE.tax)}` },
				{ t: `Total: ${money(CEDAR_INVOICE.amount + CEDAR_INVOICE.tax)} USD`, bold: true },
				{ t: "Pilot terms", size: 13, bold: true, gap: 20 },
				{ t: "- Five stores; production API keys; MCP connector access for up to 25 staff.", gap: 4 },
				{ t: "- Fixed fee, invoiced at the start of production use; card payment accepted; net 30." },
				{ t: `- Every invoice for this pilot must show PO ${CEDAR_INVOICE.po}.` },
				{ t: "- Either party may end the pilot with 7 days' written notice." },
				{ t: "Authorized: Omar Reed, Finance Manager, Cedar Supply Co.", gap: 24 },
			], { band: "#244B3C", rule: "#D9DDD4" })],
			html: human(`Hello Partwell team,

Cedar Supply has approved the four-week Partwell pilot. Purchase order ${CEDAR_INVOICE.po} is attached.

The terms are as discussed with Lena: five stores, production API access and MCP connector access for up to 25 staff, from ${pilotStart} through ${pilotEnd}. The fixed fee is ${money(CEDAR_INVOICE.amount)}, invoiced when production use starts.

Please show ${CEDAR_INVOICE.po} on the invoice. Our accounts payable system matches invoices on it.

Regards,
Omar`, SIGNERS.omar),
		},
		{
			key: "H-03", box: "hello", folder: "archive", at: "2026-10-05T12:20", from: P.buildnotes, to: [box("hello")],
			subject: "This week's small APIs worth trying", read: true, labels: ["Newsletters"], thread: "H-03", auto: true,
			list: { id: "small-apis.buildnotes.news", unsubscribe: "https://buildnotes.news/unsubscribe?list=small-apis", oneClick: true },
			attachments: [photoPart("coffee", "buildnotes.news")],
			html: mail("buildnotes", {
				preheader: "Partwell, Hookline and Quietcron: three small APIs run by one or two people.",
				eyebrow: `Issue 112 · ${c.day("2026-10-05")}`,
				heading: "This week's small APIs worth trying",
				body: `${para("buildnotes", "Every few weeks I collect small APIs, run by one or two people, that solved a real problem for a reader. Three this week. None of them paid to be here, and two of them came from your replies.")}
${photo("coffee", "buildnotes.news", "A cup of coffee on a red table, seen from above", "Photo", 180, 0)}
${h3("1. Partwell: one schema for manufacturers' catalogs", "Georgia,serif")}
${para("buildnotes", "Partwell takes the product catalogs manufacturers send out, each with its own column names, units and spreadsheet habits, and returns one schema: part number, dimensions, materials, substitutes and the date the source file last changed. There is a REST API and an MCP connector that works from Claude, ChatGPT, Cursor and Codex, so an assistant can look up a part and cite the file it came from.")}
${para("buildnotes", "The detail that stands out is the freshness field. Every record carries the time its manufacturer's file last changed, next to the file's name, so an answer about a part can say how old its source is. It is run by one developer, Alex Rivera, who answers support mail himself.")}
${para("buildnotes", '<a href="https://docs.partwell.dev" style="color:#A74C2B;text-decoration:underline">Read the Partwell docs</a>')}
${h3("2. Hookline: replay yesterday's webhooks", "Georgia,serif")}
${para("buildnotes", "Hookline sits in front of your webhook endpoint and keeps every delivery for fourteen days. When a deploy breaks your handler, you fix it and replay the failed events against staging, then production, one at a time or in a batch. The free plan covers ten thousand events a month.")}
${para("buildnotes", '<a href="https://buildnotes.news/112/hookline" style="color:#A74C2B;text-decoration:underline">The full write-up</a>')}
${h3("3. Quietcron: notice the job that didn't run", "Georgia,serif")}
${para("buildnotes", "Most monitoring tells you when a scheduled job fails. Quietcron tells you when it never started: each job pings a URL when it finishes, and you hear about it when the ping is late. Setup is one line at the end of a script.")}
${para("buildnotes", '<a href="https://buildnotes.news/112/quietcron" style="color:#A74C2B;text-decoration:underline">The full write-up</a>')}
${para("buildnotes", "If you run a small API that deserves a mention, reply to this email with a link and one sentence about who uses it. I read every reply, usually over coffee.")}
${para("buildnotes", "Rosa Lind<br>Editor, Build Notes")}`,
				footer: `Build Notes is written by Rosa Lind for developers who run small things. <a href="https://buildnotes.news/preferences" style="color:#6E6A60">Email preferences</a> · <a href="https://buildnotes.news/unsubscribe?list=small-apis" style="color:#6E6A60">Unsubscribe</a> · <a href="https://buildnotes.news/archive" style="color:#6E6A60">Past issues</a>`,
			}),
		},
		{
			key: "H-04", box: "hello", folder: "spam", at: "2026-09-25T15:24", from: P.miles, to: [box("hello")],
			subject: "Last chance: your featured listing for $90", read: false, thread: "H-04",
			html: mail("launchboard", {
				preheader: "Featured placement for Partwell in the API section, $90 for the month.",
				body: `${para("launchboard", "Hi Alex,")}
${para("launchboard", "Partwell caught our eye on a developer tools list this week, and we'd love to feature it in the Launchboard Directory's API section, which reaches 48,000 founders and engineers every month.")}
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:6px 0 16px;background:#FFF1E9;border-radius:6px"><tr><td style="padding:14px 16px;font-size:14px;line-height:21px"><strong style="color:#26334D">Partwell</strong> <span style="color:#D94D35;font-size:12px;font-weight:700;letter-spacing:0.04em">FEATURED</span><br><span style="color:#6A7180">One API for manufacturers' product catalogs, with MCP connectors.</span></td></tr></table>
${para("launchboard", "Featured placement normally costs $250. Because this month's slots close tonight, we can hold one for Partwell at <strong>$90 for the full month</strong>: a top-of-category card like the one above, a backlink and a mention in our weekly roundup.")}
${button("launchboard", "Claim the featured spot", "https://launchboardlistings.com/claim/partwell")}
${para("launchboard", "Slots are first come, first served.", "margin-top:14px")}
${signature(SIGNERS.miles)}`,
				footer: `Launchboard Directory · <a href="https://launchboardlistings.com/optout" style="color:#6A7180">Don't email me about listings</a>`,
			}),
		},
		{
			key: "H-05", box: "hello", folder: "inbox", at: "2026-10-07T16:18", from: P.eli, to: [box("hello")],
			subject: "Question about the ChatGPT connector", read: false, labels: ["Follow up"], thread: "H-05",
			html: human(`Hi Alex,

I'm a developer at Procura Works. We build purchasing software for mid-size manufacturers, and I've been testing the Partwell connector in ChatGPT this week.

One thing I couldn't answer from the docs: responses include \`sourceUpdatedAt\`. Does that date apply to the whole catalog a record came from, or to that single record? We need to tell buyers whether a specific price is current, and a catalog-level date could overstate that.

I tried the same lookup in Claude and got the same field, so I assume it comes from the API rather than the client.

If it is catalog-level, is a per-record date on the roadmap?

Thanks,
Eli`, SIGNERS.eli),
		},
	];
}

// ── support@ ───────────────────────────────────────────────────────

function support(c: StoryClock): Slot[] {
	return [
		{
			key: "SUP-01", box: "support", folder: "archive", at: "2026-09-21T08:43", from: P.ben, to: [box("support")],
			subject: "Production key returning 401", read: true, labels: ["Support", "Resolved"], thread: "SUP-01",
			html: human(`Hi,

We moved our integration from the trial to the paid plan on Friday. Same code, same endpoint, new key from the dashboard. Every request now comes back with:

\`401 invalid_api_key\`

The trial key still works if I swap it back in, so I don't think it's our request format. Endpoint is https://api.partwell.dev/v1/parts/search. Is there something I need to switch on for the account?

Ben`, SIGNERS.ben),
		},
		{
			key: "SUP-02", box: "support", folder: "sent", at: "2026-09-21T10:02", from: alex("support"), to: [P.ben],
			subject: "Re: Production key returning 401", read: true, thread: "SUP-01", replyTo: "SUP-01",
			quote: "The trial key still works if I swap it back in, so I don't think it's our request format.",
			html: human(`Hi Ben,

Thanks, the timing helped me find it.

When an account moves to a paid plan, Partwell issues a new production key, and the trial key keeps working until the trial ends. The dashboard lists each key twice: a key ID that starts with \`key_\`, which is safe to log, and the secret itself, which starts with \`pw_live_\` and is shown once. Your requests since Friday are sending the key ID, which is why they come back as \`invalid_api_key\`.

Open Settings > API keys, choose Reveal on the production key (or roll a new one), and put that value in your Authorization header. Nothing else on the account needs to change.

If it still fails, reply here and I'll go through the request logs with you.

Alex`, SIGNERS.alexSupport),
		},
		{
			key: "SUP-03", box: "support", folder: "archive", at: "2026-09-21T11:14", from: P.ben, to: [box("support")],
			subject: "Re: Production key returning 401", read: true, thread: "SUP-01", replyTo: "SUP-02",
			quote: "Your requests since Friday are sending the key ID, which is why they come back as invalid_api_key.",
			html: human(`That was it. I had the key ID in our secrets file instead of the secret. Swapped in the live key and the integration is running. Go ahead and close this one.

Thanks, Alex.

Ben`),
		},
		{
			key: "SUP-04", box: "support", folder: "inbox", at: "2026-09-22T10:12", from: P.june, to: [box("support")],
			subject: "Pagination skips records after a filter change", read: true, labels: ["Support"], thread: "SUP-04",
			attachments: [file.text("pagination-repro.txt", `Harbor Assembly - pagination repro
Account: harbor-assembly (production)
Captured: ${c.iso("2026-09-22")} 09:48 ET

1) GET /v1/parts/search?q=fasteners&manufacturer=hollis&limit=50
   -> 200, 50 records, ids hp-10001 .. hp-10050
   -> next_cursor: "c_7f3a91e0b4"

2) GET /v1/parts/search?q=fasteners&manufacturer=hollis&in_stock=true&limit=50&cursor=c_7f3a91e0b4
   -> 200, 50 records, first id hp-10081
   -> expected first id: hp-10051 (the first in-stock record after page 1)

Trimmed response from step 2:
{
  "data": [
    { "id": "hp-10081", "partNumber": "HX-1420-SS", "name": "Hex cap screw, 1/4-20 x 1 in, stainless", "inStock": true },
    { "id": "hp-10082", "partNumber": "HX-1420-ZN", "name": "Hex cap screw, 1/4-20 x 1 in, zinc", "inStock": true }
  ],
  "next_cursor": "c_4c2b6d18aa",
  "total": 212
}

Records hp-10051 .. hp-10080 never appear in any page.
`)],
			html: human(`Hi Partwell team,

We're seeing records disappear when we page through search results and change a filter between pages.

- Search for fasteners from one manufacturer, page size 50. Page 1 is fine.
- Request page 2 with the cursor from page 1, but add \`in_stock=true\`.
- Page 2 starts at what looks like record 81, not 51. Thirty records never show up.

The full request sequence and a trimmed response are in the attached file. Is the cursor tied to the original filter? If so, what's the right way to change filters partway through a list?

Thanks,
June`, SIGNERS.june),
		},
		{
			key: "SUP-05", box: "support", folder: "sent", at: "2026-09-22T14:32", from: alex("support"), to: [P.june],
			subject: "Re: Pagination skips records after a filter change", read: true, labels: ["Support", "Waiting on customer"], thread: "SUP-04", replyTo: "SUP-04",
			quote: "Is the cursor tied to the original filter? If so, what's the right way to change filters partway through a list?",
			html: human(`Hi June,

Thanks for the repro. It made this quick to confirm.

Yes, a cursor belongs to the query that created it. It stores the offset and a fingerprint of the filters. In your step 2 the fingerprint didn't match, and the API should have refused the request with \`400 cursor_filter_mismatch\`. Instead it applied the old offset to the new filter, which is why page 2 started 30 records late. That was our bug, and the fix went out at 2:05 pm today (PR 184).

When a filter changes, start a new list without a cursor:

\`GET /v1/parts/search?q=fasteners&manufacturer=hollis&in_stock=true&limit=50\`

then follow that response's \`next_cursor\`. The pagination guide now has this example: https://docs.partwell.dev/guides/pagination#changing-filters

Could you run your sequence again and confirm the in-stock list comes through complete? I'll keep this open until I hear from you.

Alex`, SIGNERS.alexSupport),
		},
		{
			key: "SUP-06", box: "support", folder: "archive", at: "2026-10-09T00:41", from: P.ben, to: [box("support")],
			subject: "Slow responses tonight — is Partwell down?", read: true, labels: ["Incident", "Resolved"], thread: "SUP-06",
			html: human(`Hi Alex,

Our catalog sync started timing out around 11:40. A few requests a minute hit our 10-second timeout, mostly on \`/v1/parts/{id}\`. The rest succeed but take 3 to 6 seconds instead of the usual 200 ms.

The data we do get back looks fine. Is something going on? The sync can wait until morning if needed; I just want to know whether to pause it.

Ben`),
		},
		{
			key: "SUP-07", box: "support", folder: "sent", at: "2026-10-09T02:40", from: alex("support"), to: [P.ben],
			subject: "Re: Slow responses tonight — is Partwell down?", read: true, thread: "SUP-06", replyTo: "SUP-06",
			quote: "Is something going on? The sync can wait until morning if needed; I just want to know whether to pause it.",
			html: human(`Hi Ben,

Sorry for the slow night. Here is what happened.

From 11:37 pm a customer rollout sent about twenty times our normal evening traffic, and parallel lookups with immediate retries multiplied it. Database connections ran out, so single-part reads (\`/v1/parts/{id}\`) queued and some passed your 10-second timeout. Search was slower but mostly completed. No data was lost or changed; the failed requests never ran.

Recovery was recorded at 2:36 am. We added caching for repeated reads, and the customer has lowered their concurrency. For now, each API key is limited to 20 concurrent requests while we watch the next few days. Your sync normally uses 4, so it shouldn't notice.

Please go ahead and restart the sync. If you see timeouts or any 429 responses, reply here and I'll raise your limit straight away.

You heard about this from your own timeouts before you heard it from us. Next time an alert fires, I'll post on https://status.partwell.dev first.

Alex`, SIGNERS.alexSupport),
		},
		{
			key: "SUP-08", box: "support", folder: "archive", at: "2026-10-09T09:35", from: P.ben, to: [box("support")],
			subject: "Re: Slow responses tonight — is Partwell down?", read: true, thread: "SUP-06", replyTo: "SUP-07",
			quote: "Please go ahead and restart the sync.",
			html: human(`Restarted the sync at 7:50 and it finished cleanly: 18,412 records, no timeouts, responses back around 200 ms. All good on our side, so you can close this.

Thanks for the write-up at 2:40 in the morning. Get some sleep.

Ben`),
		},
	];
}

// ── billing@ ───────────────────────────────────────────────────────

function billing(c: StoryClock): Slot[] {
	const inv = NORTHLINE_INVOICE;
	const periodStart = c.day("2026-09-18");
	const periodEnd = c.date("2026-10-17");
	return [
		{
			key: "B-01", box: "billing", folder: "archive", at: "2026-09-21T09:06", from: P.nora, to: [box("billing")],
			subject: "Can you resend Northline's invoice?", read: true, labels: ["Billing"], thread: "B-01",
			html: human(`Hello,

I handle the books for Northline Parts. Ben forwarded me the setup email for our Partwell subscription, but it didn't include an invoice, and I need one for ${c.month("2026-09-21T09:06").name}.

Could you send an invoice made out to Northline Parts showing the amount, the period it covers and any tax? A PDF is best.

Thank you,
Nora`, SIGNERS.nora),
		},
		{
			key: "B-02", box: "billing", folder: "sent", at: "2026-09-21T10:18", from: alex("billing"), to: [P.nora],
			subject: "Re: Can you resend Northline's invoice?", read: true, thread: "B-01", replyTo: "B-01",
			quote: "Could you send an invoice made out to Northline Parts showing the amount, the period it covers and any tax?",
			attachments: [file.pdf(`${inv.number}.pdf`, [
				{ t: "Partwell", size: 20, bold: true },
				{ t: "billing@partwell.dev  ·  partwell.dev", gap: 2 },
				{ t: `Invoice ${inv.number}`, size: 16, bold: true, gap: 22 },
				{ t: `Invoice date: ${c.date("2026-09-18")}`, gap: 6 },
				{ t: `Billed to: Northline Parts, attn. Nora Bell (nora@northlineparts.com)` },
				{ t: `Service period: ${periodStart} to ${periodEnd}` },
				{ t: "Description                                        Qty    Amount", bold: true, gap: 20 },
				{ t: `Partwell Starter plan, monthly                       1      ${money(inv.amount)}`, gap: 4 },
				{ t: `Subtotal: ${money(inv.amount)}`, gap: 14 },
				{ t: `Tax: ${money(inv.tax)}` },
				{ t: `Total: ${money(inv.amount + inv.tax)} USD`, bold: true },
				{ t: `Paid by card on ${c.date("2026-09-18")}. Balance due: $0.00`, gap: 10 },
			], { band: "#0F766E", rule: "#D8E3DF" })],
			html: human(`Hi Nora,

Here is invoice ${inv.number} for Northline Parts: the Partwell Starter plan for ${periodStart} to ${periodEnd}, ${money(inv.amount)}. No tax applies, so the total is ${money(inv.amount + inv.tax)}. It was paid by card on ${c.day("2026-09-18")}, so nothing is due.

The PDF is attached. Future invoices will go to you directly; I've added your address to the account.

Alex`, SIGNERS.alexBilling),
		},
		{
			key: "B-03", box: "billing", folder: "archive", at: "2026-10-09T15:05", from: P.stripe, to: [box("billing")],
			subject: "Your Partwell payout is on its way", read: true, labels: ["Billing", "Receipts"], thread: "B-03", auto: true,
			html: mail("stripe", {
				preheader: `${money(PAYOUT.net)} is on its way to your bank account.`,
				eyebrow: "Partwell · Payout po_3PwKx81Hq2",
				body: `<p style="margin:0 0 4px;font-size:32px;line-height:38px;font-weight:600;color:#0A2540;font-variant-numeric:tabular-nums">${money(PAYOUT.net)}</p>
${para("stripe", `is on its way to your bank account ending in 6604. Expected by ${esc(c.date("2026-10-13"))}.`, "color:#596171")}
${para("stripe", `This payout covers charges from ${esc(c.day("2026-09-18"))} to ${esc(c.day("2026-10-06"))}.`)}
${rows("stripe", [
	[`${NORTHLINE_INVOICE.number} · Northline Parts · ${c.short("2026-09-18")}`, money(NORTHLINE_INVOICE.amount)],
	[`${CEDAR_INVOICE.number} · Cedar Supply · ${c.short("2026-10-06")}`, money(CEDAR_INVOICE.amount)],
	["Gross", money(PAYOUT.gross), "muted"],
	["Stripe fees", `−${money(PAYOUT.fees)}`, "muted"],
	["Net payout", money(PAYOUT.net), "total"],
], 18)}
${button("stripe", "View payout", "https://dashboard.stripe.com/payouts/po_3PwKx81Hq2")}`,
				footer: "You're receiving this because payout notifications are on for Partwell. Stripe.",
			}),
		},
		{
			key: "B-04", box: "billing", folder: "inbox", at: "2026-10-09T00:44", from: P.omar, to: [box("billing")],
			subject: `Please add PO ${CEDAR_INVOICE.po} to ${CEDAR_INVOICE.number}`, read: false, starred: true, labels: ["Billing", "Cedar"], thread: "B-04",
			html: human(`Hello,

I'm catching up on approvals tonight. The ${money(CEDAR_INVOICE.amount)} card charge on ${c.day("2026-10-06")} for invoice ${CEDAR_INVOICE.number} is correct and matches our card statement.

The invoice PDF doesn't show our purchase order number, though, and accounts payable can't close it without ${CEDAR_INVOICE.po} in the reference field. Could you reissue ${CEDAR_INVOICE.number} with PO ${CEDAR_INVOICE.po}? The amount stays the same.

Lena tells me your team is busy with the rollout tonight, so tomorrow is fine.

Regards,
Omar`, SIGNERS.omar),
		},
		{
			key: "B-05", box: "billing", folder: "inbox", at: "2026-10-09T10:15", from: P.tess, to: [box("billing")],
			subject: "Two food receipts and the database adjustment", read: true, labels: ["Receipts"], thread: "B-05",
			html: human(`Hi Alex,

Three things for the books:

- Uber Eats UE-73419. I have an order confirmation dated ${c.day("2026-10-09")} for $23.19. Please send the final receipt; I can't book a confirmation.
- Uber Eats UE-73102 from ${c.day("2026-10-01")}. The confirmation says $18.87 and there is a substitution email after it. Did the substitution change the amount?
- The database adjustment. Your note this morning said the provider may move you to a larger plan after last night. If you have their estimate, send it and I'll book it as provisional until the invoice arrives.

A CSV is fine if that's easier.

Tess`, SIGNERS.tess),
		},
		{
			key: "B-06", box: "billing", folder: "draft", at: "2026-10-09T17:40", from: alex("billing"), to: [P.tess],
			subject: "Re: Two food receipts and the database adjustment", read: true, labels: ["Receipts"], thread: "B-05", replyTo: "B-05",
			quote: "If you have their estimate, send it and I'll book it as provisional until the invoice arrives.",
			attachments: [file.csv(`${c.month("2026-10-09T17:40").name.toLowerCase()}-expenses.csv`, [
				["date", "vendor", "reference", "document", "amount_usd", "counted", "note"],
				[c.iso("2026-10-01"), "Uber Eats", "UE-73102", "Order confirmation", "18.87", "yes", "Drink substitution did not change the total"],
				[c.iso("2026-10-09"), "Uber Eats", "UE-73419", "Order confirmation", "23.19", "no", "Same purchase as the final receipt below"],
				[c.iso("2026-10-09"), "Uber Eats", "UE-73419", "Final receipt", "23.19", "yes", "Delivered 1:48 am; receipt PDF on the delivery email"],
				[c.iso("2026-10-09"), "Supabase", "DB-4821", "Compute upgrade estimate", DB_ESTIMATE.toFixed(2), "provisional", "Estimate only; replace with the provider's invoice"],
				["", "", "", "Total counted (food)", "42.06", "", "Provisional database amount not included"],
			])],
			html: human(`Hi Tess,

In order:

- UE-73419 is one charge. The confirmation at 1:16 am and the receipt at 1:48 am are the same $23.19 purchase. Both are in the CSV so you can see they match; only the receipt is counted. I'll forward the receipt PDF.
- UE-73102 stayed at $18.87. The substitution swapped the drink at the same price.
- The database provider estimates ${money(DB_ESTIMATE)} for the compute upgrade this month (their case DB-4821). It's marked provisional in the CSV until their invoice arrives.

The CSV is attached.

Alex`),
		},
	];
}

// ── partners@ ──────────────────────────────────────────────────────

function partners(c: StoryClock): Slot[] {
	const termStart = c.date("2026-11-01");
	const termEnd = c.date("2027-10-31");
	const respondBy = c.day("2026-10-23");
	return [
		{
			key: "P-01", box: "partners", folder: "archive", at: "2026-09-23T09:32", from: P.theo, to: [box("partners")],
			subject: `${batchId(c)} schema update`, read: true, labels: ["Vendors"], thread: "P-01",
			attachments: [file.csv(`${batchId(c)}-sample.csv`, [
				["sku", "manufacturer", "manufacturer_part_number", "description", "unit", "price_usd", "updated_at"],
				["ATL-55120", "Hollis Fastening", "HX-1420-SS", "Hex cap screw, 1/4-20 x 1 in, stainless", "each", "0.42", c.iso("2026-09-28")],
				["ATL-55121", "Hollis Fastening", "HX-1420-ZN", "Hex cap screw, 1/4-20 x 1 in, zinc", "each", "0.18", c.iso("2026-09-28")],
				["ATL-61007", "Brennan Valve", "BV-075-BR", "Ball valve, 3/4 in, brass, full port", "each", "14.65", c.iso("2026-09-27")],
			])],
			html: human(`Hi Alex,

A heads-up on batch ${batchId(c)}, which goes out on ${c.day("2026-09-30")}. We're renaming the column manufacturer_part_no to manufacturer_part_number across all our catalog exports, to match the naming in the rest of the file.

Nothing else changes: same values, same position in the file. Three rows from the batch are attached so you can check your importer against them.

Let me know if this causes any trouble on your side.

Theo`, SIGNERS.theo),
		},
		{
			key: "P-02", box: "partners", folder: "sent", at: "2026-09-23T11:08", from: alex("partners"), to: [P.theo],
			subject: `Re: ${batchId(c)} schema update`, read: true, thread: "P-01", replyTo: "P-01",
			quote: "We're renaming the column manufacturer_part_no to manufacturer_part_number across all our catalog exports, to match the naming in the rest of the file.",
			html: human(`Hi Theo,

Thanks for the notice. Two questions so I can plan the importer change:

- Is the rename permanent, or could manufacturer_part_no come back in later batches?
- Will ${batchId(c)} carry both columns for one batch, so customers still on the old mapping don't see a gap?

Alex`),
		},
		{
			key: "P-03", box: "partners", folder: "archive", at: "2026-09-24T08:48", from: P.theo, to: [alex("partners")],
			subject: `Re: ${batchId(c)} schema update`, read: true, thread: "P-01", replyTo: "P-02",
			quote: `Will ${batchId(c)} carry both columns for one batch, so customers still on the old mapping don't see a gap?`,
			html: human(`Morning Alex,

It's permanent. manufacturer_part_number is the canonical name from ${batchId(c)} onward.

For the transition, ${batchId(c)} carries both columns with identical values. From the batch after it, only manufacturer_part_number will be present.

Theo`),
		},
		{
			key: "P-04", box: "partners", folder: "inbox", at: "2026-10-06T10:30", from: P.evelyn, to: [box("partners")],
			subject: "Your data license renewal is ready", read: true, starred: true, labels: ["Vendors"], thread: "P-04",
			attachments: [file.pdf("catalog-license-renewal.pdf", [
				{ t: "Fieldstone Catalogs", size: 20, bold: true },
				{ t: "Data License Renewal", size: 14, gap: 4 },
				{ t: "Agreement: FC-DL-2291", bold: true, gap: 18 },
				{ t: "Licensee: Partwell (Alex Rivera, partners@partwell.dev)", gap: 4 },
				{ t: "Licensor: Fieldstone Catalogs, Licensing (evelyn@fieldstonecatalogs.com)" },
				{ t: `Renewal term: ${termStart} to ${termEnd}` },
				{ t: "Scope", size: 13, bold: true, gap: 18 },
				{ t: "- Redistribution of normalized Fieldstone catalog records through the Partwell API", gap: 4 },
				{ t: "  and MCP connectors, for up to 25 customer accounts." },
				{ t: "- Attribution to Fieldstone Catalogs in API responses that include its records." },
				{ t: "- New: records shown in AI assistant answers must keep their source date." },
				{ t: "Fees", size: 13, bold: true, gap: 18 },
				{ t: "Annual license fee: $2,400.00, invoiced at the start of the term, net 30. Unchanged.", gap: 4 },
				{ t: "Response", size: 13, bold: true, gap: 18 },
				{ t: `Sign and return by ${c.date("2026-10-23")} to renew without a gap in access.`, gap: 4 },
				{ t: "Licensee signature: ______________________   Date: ____________", gap: 30 },
				{ t: "Licensor signature: ______________________   Date: ____________", gap: 16 },
			], { band: "#353C35", rule: "#D9D6CD" })],
			html: human(`Hi Alex,

Your Fieldstone Catalogs data license comes up for renewal on ${c.day("2026-10-31")}, and the renewal document is attached.

The scope stays as it is this year: redistribution of normalized Fieldstone catalog records through the Partwell API and MCP connectors, for up to 25 customer accounts, with attribution in API responses. We've added one clause for AI assistants: records shown in assistant answers must keep their source date.

The next term runs ${termStart} to ${termEnd} at $2,400 for the year, unchanged from this term.

To renew without a gap, please sign and return the document by ${respondBy}. If you'd like a different account limit, tell me before then and I'll revise it.

Best regards,
Evelyn`, SIGNERS.evelyn),
		},
		{
			key: "P-05", box: "partners", folder: "inbox", at: "2026-09-30T16:52", from: P.priya, to: [alex("partners")],
			subject: "MCP freshness field tested in Cursor and Claude", read: true, labels: ["Dev"], thread: "P-05",
			html: human(`Hi Alex,

The freshness field is ready for review: https://github.com/alexrivera/partwell/pull/191

Every part record now carries sourceUpdatedAt, the time the manufacturer file it came from last changed, next to sourceFile. A lookup through the MCP connector returns:

\`\`\`
{
  "partNumber": "HX-1420-SS",
  "sourceFile": "atlas/${batchId(c)}.csv",
  "sourceUpdatedAt": "${c.utc("2026-09-28T10:05")}"
}
\`\`\`

I tested get_part and search_parts from Cursor and from Claude. Two observations:

- Claude quotes the date without being asked when it cites a part ("from Atlas Dataworks' catalog, updated ${c.day("2026-09-28")}"). Cursor shows the field in the tool output, but its agent only mentions it if you ask about freshness. Probably fine, but worth a line in the tool description.
- sourceUpdatedAt is per source file, not per record. For Atlas that's accurate because they send whole batches. For suppliers that patch single rows it can make a price look older than it is, never newer. I'd ship it now and add a per-record date when a supplier gives us one.

Tests cover both tools and the CSV and JSON importers. The ${batchId(c)} column rename is handled in the same PR, with the old name accepted for one batch.

Happy to pair on the tool description tomorrow if you want.

Priya`, SIGNERS.priya),
		},
		{
			key: "P-06", box: "partners", folder: "trash", at: "2026-10-06T10:35", from: P.fieldstone, to: [box("partners")],
			subject: "Reminder: renewal document available", read: true, thread: "P-06", auto: true,
			html: mail("fieldstone", {
				preheader: `Renewal document for agreement FC-DL-2291. Respond by ${respondBy}.`,
				heading: "A renewal document is waiting",
				body: `${para("fieldstone", "The renewal document for your Fieldstone data license is ready to review and sign.")}
${rows("fieldstone", [["Agreement", "FC-DL-2291"], ["Licensee", "Partwell"], ["New term", `${termStart} – ${termEnd}`], ["Respond by", c.date("2026-10-23"), "total"]], 14)}
${button("fieldstone", "View renewal document", "https://fieldstonecatalogs.com/licensing/FC-DL-2291")}`,
				footer: "Sent automatically by Fieldstone Catalogs licensing. Your licensing manager is Evelyn Brooks.",
			}),
		},
	];
}

// ── ops@ ───────────────────────────────────────────────────────────

/** The incident's numbers, shared by the alerts, the support case and the metrics file. */
export const INCIDENT = { normalPerMin: 1150, peakPerMin: 23000, normalP95: 180, peakP95: 4850, recoveredP95: 210, recoveredPerMin: 2900 };

function ops(c: StoryClock): Slot[] {
	const runUrl = `https://github.com/${REPO}/pull/184/checks`;
	const metrics = `partwell-prod connection metrics (America/New_York)
Exported ${c.iso("2026-10-09")} 00:08 by Partwell Ops

time    req/min  pool_used  waiting  p95_read_ms  db_cpu
23:30     1,140      11/60        0            4     18%
23:35     6,900      34/60        0           12     41%
23:37    23,000      60/60       84          910     88%
23:40    23,600      60/60      212        1,640     95%
23:45    24,100      60/60      260        1,880     97%
23:50    23,200      60/60      238        1,910     96%
23:55    22,800      60/60      221        1,870     96%
00:00    21,900      60/60      197        1,790     94%
00:05    20,400      60/60      164        1,610     92%
00:08    19,700      60/60      150        1,540     92%

Events
${c.iso("2026-10-08")} 23:37  Cloudflare alert: p95 latency above threshold
${c.iso("2026-10-08")} 23:38  Rate limiting rule api-burst throttling one customer key
${c.iso("2026-10-09")} 00:09  Case DB-4821 opened with the database provider
`;
	return [
		{
			key: "O-01", box: "ops", folder: "archive", at: "2026-09-22T13:02", from: P.github, to: [box("ops")],
			subject: "Pagination checks failed on PR 184", read: true, labels: ["Dev"], thread: "O-01", auto: true,
			html: mail("github", {
				preheader: "test (node 22) failed: pagination › rejects a cursor reused with different filters",
				heading: "Reject cursors when the filters change #184",
				body: `${meta("github", [["Repository", REPO], ["Workflow", "CI / test (node 22)"], ["Branch", "fix/cursor-filters"], ["Commit", "4e1c9a7"]])}
<p style="margin:0 0 12px">${status("Failed", "bad")} <span style="color:#59636E;font-size:13px">after 2m 58s · 211 passed, 1 failed</span></p>
${mono("github", `✕ pagination › rejects a cursor reused with different filters
  expected status 400 cursor_filter_mismatch
  received status 200 (30 records skipped)
  at test/pagination.test.ts:88`)}
${button("github", "View workflow run", runUrl)}`,
				footer: `You are receiving this because you opened this pull request. <a href="https://github.com/settings/notifications" style="color:#59636E">Manage notifications</a>`,
			}),
		},
		{
			key: "O-02", box: "ops", folder: "archive", at: "2026-09-22T14:03", from: P.github, to: [box("ops")],
			subject: "Checks passed on PR 184", read: true, thread: "O-01", replyTo: "O-01", auto: true,
			html: mail("github", {
				preheader: "All checks have passed on Reject cursors when the filters change.",
				heading: "Reject cursors when the filters change #184",
				body: `${meta("github", [["Repository", REPO], ["Workflow", "CI / test (node 22)"], ["Branch", "fix/cursor-filters"], ["Commit", "9b20d5e"]])}
<p style="margin:0 0 12px">${status("All checks have passed", "ok")} <span style="color:#59636E;font-size:13px">after 3m 41s · 212 passed, 0 failed</span></p>
${para("github", "Commit 9b20d5e, “Return cursor_filter_mismatch when filters change”, fixed the previously failing test <code style=\"font-size:12px\">pagination › rejects a cursor reused with different filters</code>.")}
${button("github", "View pull request", `https://github.com/${REPO}/pull/184`)}`,
				footer: `You are receiving this because you opened this pull request. <a href="https://github.com/settings/notifications" style="color:#59636E">Manage notifications</a>`,
			}),
		},
		{
			key: "O-03", box: "ops", folder: "archive", at: "2026-10-08T23:37", from: P.cloudflare, to: [box("ops")],
			subject: "Partwell latency above threshold", read: true, labels: ["Incident", "Resolved"], thread: "O-03", auto: true,
			html: mail("cloudflare", {
				preheader: `Warning: p95 latency ${INCIDENT.peakP95.toLocaleString("en-US")} ms on api.partwell.dev, above the 1,000 ms threshold. Requests up 20×.`,
				eyebrow: `Notification · ${c.long(c.at("2026-10-08T23:37"))} ${c.zone(c.at("2026-10-08T23:37"))}`,
				heading: "Latency above threshold on api.partwell.dev",
				body: `<p style="margin:0 0 14px">${status("Warning: firing", "warn")}</p>
${para("cloudflare", "Your notification policy <strong>Partwell API latency</strong> fired: p95 response time has been above 1,000 ms for 5 minutes.")}
${grid("cloudflare", ["Metric", "Normal evening", "Last 15 min", "Threshold"], [
	["Requests per minute", INCIDENT.normalPerMin.toLocaleString("en-US"), `${INCIDENT.peakPerMin.toLocaleString("en-US")} (${Math.round(INCIDENT.peakPerMin / INCIDENT.normalPerMin)}×)`, "—"],
	["p95 latency", `${INCIDENT.normalP95} ms`, `${INCIDENT.peakP95.toLocaleString("en-US")} ms`, "1,000 ms"],
	["5xx error rate", "0.02%", "6.8%", "—"],
])}
${para("cloudflare", "Most affected path: <code>/v1/parts/{id}</code> (71% of requests).")}
${button("cloudflare", "View analytics", "https://dash.cloudflare.com/analytics/api.partwell.dev")}`,
				footer: "You're receiving this because ops@partwell.dev is a recipient of the Partwell API latency policy.",
			}),
		},
		{
			key: "O-04", box: "ops", folder: "archive", at: "2026-10-08T23:38", from: P.cloudflare, to: [box("ops")],
			subject: "Request throttling detected", read: true, thread: "O-03", replyTo: "O-03", auto: true,
			html: mail("cloudflare", {
				preheader: "Your rate limiting rule api-burst is throttling 18% of requests to /v1/parts on api.partwell.dev.",
				eyebrow: `Notification · ${c.long(c.at("2026-10-08T23:38"))} ${c.zone(c.at("2026-10-08T23:38"))}`,
				heading: "Request throttling on api.partwell.dev",
				body: `<p style="margin:0 0 14px">${status("Warning: rule blocking requests", "warn")}</p>
${para("cloudflare", "Your rate limiting rule <strong>api-burst</strong> (600 requests per 10 seconds per API key) is blocking requests. The rule is working as configured; Cloudflare's network is operating normally.")}
${grid("cloudflare", ["Last 5 minutes", "Value"], [
	["Requests per minute", INCIDENT.peakPerMin.toLocaleString("en-US")],
	["Throttled (429) per minute", "4,140 (18%)"],
	["Share from one API key", "94%"],
	["p95 latency", `${INCIDENT.peakP95.toLocaleString("en-US")} ms`],
])}
${button("cloudflare", "Review rule", "https://dash.cloudflare.com/security/rate-limiting/api-burst")}`,
				footer: "You're receiving this because ops@partwell.dev is a recipient of the Partwell API latency policy.",
			}),
		},
		{
			key: "O-05", box: "ops", folder: "sent", at: "2026-10-09T00:09", from: alex("ops"), to: [P.supabase],
			subject: "DB-4821: connection pressure during customer rollout", read: true, labels: ["Incident"], thread: "O-05",
			attachments: [file.text("connection-metrics.txt", metrics)],
			html: human(`Hello,

I've opened case DB-4821 for project partwell-prod. Since 11:37 pm Eastern our API has been running out of database connections.

Symptoms:

- The connection pool has been saturated since 11:37 pm: 60 of 60 connections in use, with up to 260 requests waiting.
- p95 time for single-row reads went from 4 ms to about 1.9 s.
- Database CPU is at 92 to 97%. Memory is fine.

The cause on our side: a customer enabled their store assistant in more stores than planned, so traffic is about twenty times the usual evening level. Their client makes parallel lookups and retries immediately on timeout, which multiplies the load. They are lowering their concurrency now, and we're adding a cache for repeated reads.

Two questions:

- Is there a safe pooling or connection setting we should change tonight?
- Do we need a larger compute size for this traffic, and what would it cost?

Metrics for the last 40 minutes are attached.

Alex`, SIGNERS.alexPartwell),
		},
		{
			key: "O-06", box: "ops", folder: "inbox", at: "2026-10-09T01:23", from: P.sofia, to: [alex("ops")],
			subject: "Re: DB-4821: connection pressure during customer rollout", read: true, labels: ["Incident"], thread: "O-05", replyTo: "O-05",
			quote: "Is there a safe pooling or connection setting we should change tonight?",
			html: human(`Hi Alex,

Thanks for the detailed report and the metrics file. I've looked at partwell-prod for case DB-4821.

Your API connects to Postgres directly on port 5432, so every Worker request holds its own connection, and your compute size allows 60 direct connections. That matches the saturation at 23:37.

For tonight, all reversible:

- Point the API at the connection pooler in transaction mode (port 6543) instead of direct connections. Many clients then share a small set of database connections. No schema change is needed.
- Set a 5-second statement timeout for the API's database role, so a stuck query releases its connection instead of holding it.
- Keep your read cache and your customer's lower concurrency. The immediate retries are the biggest multiplier.

On capacity: at twenty times your evening traffic, CPU will stay high on your current size even with pooling. The next compute size doubles CPU and raises direct connections to 120. I estimate ${money(DB_ESTIMATE)} for the rest of this billing month, prorated, and the resize takes about two minutes with a brief reconnect. Let me know if you want it scheduled and I'll keep this case open.

Sofia`, SIGNERS.sofia),
		},
		{
			key: "O-07", box: "ops", folder: "archive", at: "2026-10-09T02:36", from: P.cloudflare, to: [box("ops")],
			subject: "Partwell latency recovered", read: true, thread: "O-03", replyTo: "O-04", auto: true,
			html: mail("cloudflare", {
				preheader: `Resolved: p95 latency ${INCIDENT.recoveredP95} ms on api.partwell.dev, below threshold for 10 minutes.`,
				eyebrow: `Notification · ${c.long(c.at("2026-10-09T02:36"))} ${c.zone(c.at("2026-10-09T02:36"))}`,
				heading: "Resolved: latency back below threshold",
				body: `<p style="margin:0 0 14px">${status("Resolved", "ok")}</p>
${para("cloudflare", "Your notification policy <strong>Partwell API latency</strong> has resolved. p95 response time on api.partwell.dev has been below 1,000 ms for 10 minutes.")}
${grid("cloudflare", ["Metric", "Peak", "Now"], [
	["Requests per minute", INCIDENT.peakPerMin.toLocaleString("en-US"), INCIDENT.recoveredPerMin.toLocaleString("en-US")],
	["p95 latency", `${INCIDENT.peakP95.toLocaleString("en-US")} ms`, `${INCIDENT.recoveredP95} ms`],
	["5xx error rate", "6.8%", "0.03%"],
	["Throttled (429) per minute", "4,140", "0"],
])}
${grid("cloudflare", ["Timeline", "Time"], [
	["Latency alert fired", `${c.time(c.at("2026-10-08T23:37"))} ${c.zone(c.at("2026-10-08T23:37"))}`],
	["Throttling started", `${c.time(c.at("2026-10-08T23:38"))} ${c.zone(c.at("2026-10-08T23:38"))}`],
	["Recovered", `${c.time(c.at("2026-10-09T02:36"))} ${c.zone(c.at("2026-10-09T02:36"))}`],
	["Duration", "2h 59m"],
], { strong: 3 })}
${para("cloudflare", "The policy stays active and will notify you again if p95 latency is above 1,000 ms for 5 minutes.")}
${button("cloudflare", "View analytics", "https://dash.cloudflare.com/analytics/api.partwell.dev")}`,
				footer: "You're receiving this because ops@partwell.dev is a recipient of the Partwell API latency policy.",
			}),
		},
		{
			key: "O-08", box: "ops", folder: "inbox", at: "2026-10-11T19:56", from: P.priya, to: [alex("ops")],
			subject: "Next Cedar rollout: concurrency cap stays at 8?", read: false, starred: true, labels: ["Cedar", "Follow up"], thread: "O-08",
			html: human(`Hi Alex,

Monitoring has been quiet since the recovery early Friday: p95 between 160 and 230 ms all weekend, no 429s, and the read cache is answering about 70% of single-part lookups.

Lena wants to take Cedar's assistant from 5 stores to 15 on Tuesday. Their client is capped at 8 concurrent requests with backoff on retries, and I'd keep that cap for this stage rather than raise it to 16 as they asked. At 15 stores and a cap of 8, the load test peaked at 41% of database CPU.

Can you confirm the cap stays at 8 for Tuesday? I'll reply to Lena once you've decided. A one-word answer is fine.

Priya`),
		},
	];
}

export function businessSlots(c: StoryClock): Slot[] {
	return [...hello(c), ...support(c), ...billing(c), ...partners(c), ...ops(c)];
}
