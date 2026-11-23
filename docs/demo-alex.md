# Alex profile

A second sample inbox for demos: three weeks in the life of Alex Rivera. Alex runs Partwell, an API that normalizes manufacturers' product catalogs and serves them through MCP connectors, plays bass in a band and keeps the books for a kids' code club. 100 messages across nine mailboxes on four domains. The code is `workers/lib/dev-seed/alex/`; the tests are `tests/dev-seed-alex.test.mjs` and `tests/dev-seed-alex-store.test.mjs`.

Partwell, its customers and vendors, Alex's family and friends, The Late Commits and Riverbend Code Club are invented. GitHub, Cloudflare, Stripe, Supabase, Uber Eats, Vercel, xAI, Resend, OpenAI, Anthropic, Cursor, Linear, Figma and AFFiNE appear as senders of simulated notices with their published logos. None of that mail came from them, and writing the profile contacts nobody. Amounts, usage figures, scores, case numbers and accounts are made up. Fees and plan allowances in vendor notices are illustrative and may not match any vendor's current pricing.

## Loading it

- Dev server: `SEED_PROFILE=alex` in `.dev.vars`. The first API request writes it into an empty database.
- On demand: `curl -X POST localhost:5173/api/v1/dev/seed -H 'content-type: application/json' -d '{"profile":"alex"}'`.
- Demo build: set `SEED_PROFILE` to `alex` in the demo's Wrangler `vars`, with `EMAIL_ADDRESSES` set to the nine addresses below and `DOMAINS` to `partwell.dev,alexrivera.me,latecommits.band,riverbendcode.org`.

The profile creates its nine mailboxes whatever `EMAIL_ADDRESSES` holds; the addresses are fixed, not mapped by position. Writing it again replaces only its own messages (ids start `seed-alex-v2-`) and their files. The default sample inbox and mail you made yourself stay. A demo's hourly reset wipes everything first, then writes the profile `SEED_PROFILE` names.

## Clock

Every message has a fixed time in New York, written against the story's own "now": Sunday, October 11, 2026 at 8:02 pm. On a later date the whole story moves forward in whole weeks, so weekdays and times of day stay as written: the incident runs 11:37 pm to 2:40 am, the league plays on Sundays. Dates inside bodies, quotes and attachments move with it, and month names follow the moved calendar: a monthly bill names the month before it arrives, rent the month it is paid in, the bank statement the month before, and the accountant the month being closed. Atlas's batch ID (CAT-0930) and the expense CSV's name (october-expenses.csv) follow their dates too. From February to August it moves in 52-week steps instead, to the last autumn, so the league stays in football season. The newest message is therefore between 4 minutes and a week old. The dev server writes the profile again when the week turns.

## Mailboxes

| Address | Messages | Inbox | Archive | Sent | Drafts | Spam | Trash | Unread |
|---|---|---|---|---|---|---|---|---|
| hello@partwell.dev | 9 | 3 | 5 | | | 1 | | H-04 (spam), H-05 |
| support@partwell.dev | 10 | 2 | 4 | 4 | | | | |
| billing@partwell.dev | 10 | 2 | 6 | 1 | 1 | | | B-04 |
| partners@partwell.dev | 11 | 5 | 3 | 2 | | | 1 | P-10, P-11 |
| ops@partwell.dev | 22 | 4 | 15 | 3 | | | | O-08 |
| alex@alexrivera.me | 14 | 2 | 9 | 2 | 1 | | | A-06 |
| league@alexrivera.me | 8 | 4 | 3 | 1 | | | | L-06 |
| booking@latecommits.band | 8 | 4 | 2 | 1 | | 1 | | BAND-06, BAND-07, BAND-08 (spam) |
| alex@riverbendcode.org | 8 | 3 | 3 | 1 | 1 | | | RCC-07 |
| Total | 100 | 29 | 50 | 15 | 3 | 2 | 1 | 12 |

Drafts: B-06 (expenses for Tess), A-08 (rescheduling Mara), RCC-08 (the treasurer report). Each opens under its parent as Edit draft. A-08 is an auto-draft the agent wrote for Alex to review, so it opens with Redraft.

Starred: H-01, B-04, P-04, O-08, A-07, L-01, BAND-01, RCC-02, RCC-07.

Left open on purpose: Eli's connector question (H-05), June's pagination confirmation (SUP-05), Northline's plan change (SUP-10), the PO on PW-1068 (B-04), the expense reply (B-06), the license renewal (P-04), Rae's comment and invoice (P-10, P-11), the next Cedar stage (O-08, O-21), the migration reschedule (A-08), the shirt proof (BAND-06), the treasurer report (RCC-08).

## The story

- **Partwell's customers.** Northline's key mix-up (SUP-01–03) and plan change (SUP-09–10); Harbor Assembly's pagination bug, its Linear issue and GitHub checks (SUP-04–05, O-17–18, O-01–02); Cedar's pilot, purchase order, PO question and rollout (H-01–02, B-04, O-21–22, O-08); Procura's question (H-05).
- **The incident, Thursday night.** Cloudflare alerts at 11:37 and 11:38 pm (O-03–04), the database case (O-05–06), Ben's report and Alex's 2:40 am answer (SUP-06–08), a 1:16 am burrito (A-04–05), recovery at 2:36 am (O-07), the compute upgrade (O-19) and Priya's review note (O-20).
- **Tools and vendors.** Vercel docs deploys and usage (O-09–11), xAI key, limit and invoice (O-12–13, B-07), OpenAI and Claude connector listings and usage (H-06, H-09, B-08–09), Cursor's directory (H-07), Resend domain setup with a support reply (O-14–16), Atlas Dataworks and Fieldstone (P-01–06), Stripe's payout (B-03).
- **Design.** Rae's docs illustrations: her first pass, Alex's answers, Figma's share and mention, and her invoice (P-07–11).
- **Money.** Invoices PW-1042 and PW-1068, the payout, Tess's two rounds of questions (B-01–06, B-10).
- **Life.** Mom, rent, the bank, Westhaven's migration plan and the incident-day reschedule (A-07–14), Uber Eats and a keyboard (A-01–05), Maya's coffee (A-06).
- **The league.** Invitation, three rounds, a trade offer, Jordan's emoji roundup, Nia and Sam (L-01–08).
- **The Late Commits.** A support slot at The Foundry Room on the 17th, the setlist, a rehearsal room, a shirt proof, a moved rehearsal and a playlist pitch (BAND-01–08).
- **Riverbend Code Club.** 24 kids and 9 laptops, a $2,500 grant, a volunteer, a Chromebook quote, a donation and the board's treasurer report (RCC-01–08).

## Facts the tests check

- Invoices: PW-1042 $149.00, PW-1068 $1,200.00 with PO CED-4417. Payout: $1,349.00 gross, $39.12 fees, $1,309.88 net.
- Food: UE-73102 $18.87 and UE-73419 $23.19, each the sum of its lines; UE-73419 is one charge.
- Vendors: xAI $36.48 + $21.64 + $4.28 = $62.40; OpenAI $14.90 + $3.32 = $18.22; Rae 14 h × $110 = $1,540.
- Band: studio 3 h × $45 = $135, less the $40 deposit, $95 at the door; shirts 36 × $11.50 + $35 setup = $449.
- Code club: $2,500 grant + $350 donations − $85.40 snacks = $2,764.60; less 12 Chromebooks × $95 = $1,140 leaves $1,624.60. The CSV's running balance adds up row by row.
- League: three rounds of results and the standings computed from them; round 3, Alex 131.7 to Jordan 130.9.
- Word counts for the slots the spec sets; at least 20 emoji in Jordan's L-04 and none in the accountant's, the provider's or the alerts.

## Brands

Each sender has its own look, from `workers/lib/dev-seed/alex/brands/index.ts`: colours, type sizes, padding, rules, button shape, and header. Designed mail is a table at most 600px wide with inline styles, so it works in the reader at desktop width and on a 375px phone. Human mail stays plain: paragraphs, a quoted line, and a 13/20 signature with a 48px mark. A reply carries its writer's signature, never the recipient's.

Logos are files in `brands/vendor/` (published logo files, 23, one of them a mark-only crop) and `brands/original/` (marks drawn for the invented companies and people, 20), with sources, usage notes and SHA-256 in `brands/manifest.json`. `scripts/seed-assets.mjs` writes them into `brands/logos.ts` as data URLs, so the mail shows them without fetching anything. The vendor files are unchanged from their sources: official kits for Uber Eats, Vercel, Stripe, GitHub, Cloudflare (a PNG; its kit has no SVG), Supabase, Resend, Cursor and Linear; Wikimedia Commons for OpenAI, ChatGPT, Claude, Anthropic, xAI and Figma; the AFFiNE repository for Notes. They are other companies' trademarks.

The reader's frame loads no web fonts, so brand typefaces fall back to system stacks:

| Brand | Typeface | Shown with |
|---|---|---|
| Uber Eats | UberMove, UberMoveText | Helvetica Neue, Arial |
| Vercel | Geist Sans, Geist Mono | system sans, ui-monospace |
| Stripe | Söhne | Helvetica Neue, Arial |
| Supabase | Manrope (boards only) | system sans |
| xAI | grotesk sans | Helvetica Neue, Arial |
| OpenAI | OpenAI Sans | system sans |
| Claude | Anthropic Serif and Sans | Georgia, system sans |
| Partwell | Inter, IBM Plex Mono | system sans, ui-monospace |
| Build Notes, Fieldstone | Libre Baskerville, Source Sans 3 | Georgia, system sans |
| Keyforge Keys | Space Grotesk, Inter | system sans |
| Launchboard | DM Sans | system sans |
| Sunday Deploy League | Barlow Condensed, Inter | Arial Narrow, system sans |

Not built in this pass: brand boards, avatars in the inbox list, and a preview gallery. The app shows no sender avatars today.

## Files

| Message | File | Type |
|---|---|---|
| H-02 | CED-4417-purchase-order.pdf | application/pdf |
| SUP-04 | pagination-repro.txt | text/plain |
| B-02 | PW-1042.pdf | application/pdf |
| B-06 | october-expenses.csv | text/csv |
| B-07 | xAI-invoice-INV-90417.pdf | application/pdf |
| P-01 | CAT-0930-sample.csv | text/csv |
| P-04 | catalog-license-renewal.pdf | application/pdf |
| P-11 | RC-0312.pdf | application/pdf |
| O-05 | connection-metrics.txt | text/plain |
| O-21 | cedar-rollout-summary.pdf | application/pdf |
| A-03 | keyboard.jpg | image/jpeg |
| A-05 | UE-73419-receipt.pdf | application/pdf |
| A-06 | coffee.jpg | image/jpeg |
| A-13 | westhaven-migration-plan.pdf | application/pdf |
| BAND-04 | setlist-v2.txt | text/plain |
| BAND-06 | late-commits-tee-proof.pdf | application/pdf |
| RCC-02 | hvcf-award-letter.pdf | application/pdf |
| RCC-05 | SB-2207-quote.pdf | application/pdf |
| RCC-08 | treasurer-report.csv | text/csv |

The PDFs are generated text PDFs with a band of the sender's colour across the top.

## Photos

Four CC0 photos, stored once in `workers/lib/dev-seed/alex/assets/` with `manifest.json` (source page, download URL, creator, license, size, dimensions, SHA-256, changes). A test checks the bytes against the manifest.

| Photo | Creator, license | Shown inline | As a file |
|---|---|---|---|
| football-stadium.jpg | carlinmack, CC0 1.0 | L-01, L-06 (180px crop) | |
| food-burrito.jpg | Ser Amantio di Nicolao, CC0 1.0 | A-04, A-05 (220px crop) | |
| coffee.jpg | www.Pixel.la Free Stock Photos, CC0 1.0 | H-03 (180px crop) | A-06 |
| keyboard.jpg | Anas Alshanti, CC0 1.0 | A-03 (220px crop) | A-03 |

Inline photos are real inline parts: `content_id` set, `disposition` inline, and `<img src="cid:…">` in the HTML, which the reader rewrites to the attachment URL. All four photos are CC0, so the mail shows them without a caption; their credits are in the manifest. The burrito is a beef birria burrito cropped to its cut half; the stadium is a 2019 college game.

## Links

Every link in the mail except a photo credit opens `/api/v1/sample-link`, a page in the app that shows where the link would go. That route exists only in dev and demo builds. List-Unsubscribe headers name the sender's own URL; the app reads them as metadata and never fetches them.
