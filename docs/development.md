# Development

Back to the [README](../README.md).

## Local development

```sh
npm install
npx wrangler login
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply DB --local
npm run dev
```

Set `account_id` in `wrangler.jsonc` first. Local development still connects to your Cloudflare account: Workers AI always runs remotely and may incur charges, and the `send_email` binding is remote. Access checks are skipped in development.

To keep your account ID and test addresses out of `wrangler.jsonc`, copy it to `wrangler.local.jsonc` (gitignored), edit that copy, and run `npm run dev:local`. Apply the migrations with `-c wrangler.local.jsonc`.

Mail is stored in a local D1 database under `.wrangler/state`. Run the migrations command again after pulling a new migration.

### Sample inbox

The first API request to the dev server writes about 470 sample messages across every address in `EMAIL_ADDRESSES`. It makes the mailboxes if they don't exist. The mail is spread over every folder and about ten weeks:

- Threads with replies in Sent, drafts, and replies that quote what they answer. People write too: family planning Thanksgiving, a group deciding on a camping trip, a landlord, an old roommate.
- Mail nobody needed: a chain forward from Dad, a reply-all storm on a conference list, the building's recycling-room argument, a pre-read for a pre-read, a vendor's follow-up ladder.
- Orders as threads, from confirmation to delivery, with a wrong color, a back-order, a return, an exchange and abandoned-cart nudges.
- Receipts, payouts, builds, incidents, sign-in alerts, travel mail, newsletters with unsubscribe headers, cold pitches, Spam and Trash.
- 60 or so PDF, calendar, CSV, JSON, text and SVG attachments that open from the reader.
- Twelve labels and three saved searches.

The companies and people are made up and sit under `example.com`, `example.org` and `example.net`. Each of six parts (`hello`, `billing`, `support`, `legal`, `ops`, `press`) goes to the configured address with that name. If you configure other addresses, the parts share them. Times follow this machine's time zone.

When the server starts again and the sample mail is there, it moves the dates forward so the newest message is a few minutes old, and keeps what you read, starred or labelled. After two weeks away it writes the inbox again. Mail you made yourself is never touched. Set `DEV_SEED=off` in `.dev.vars` to start with an empty inbox.

`SEED_PROFILE=alex` in `.dev.vars` writes the Alex profile instead: 100 messages for Alex Rivera across nine named mailboxes on four domains, with each sender's brand, inline photos and real attachments. `POST /api/v1/dev/seed` takes `{"profile": "alex"}` for the same. See [Alex profile](demo-alex.md).

To wipe the sample mail and write it again, or to add plain messages for testing long lists:

```sh
curl -X POST http://localhost:5173/api/v1/dev/seed \
  -H 'content-type: application/json' -H 'sec-fetch-site: same-origin' \
  -d '{"extra": 2000}'
```

Apply the D1 migrations first. Without them the seed logs a warning and skips. The code is in `workers/lib/dev-seed/`. It is left out of production builds, except a demo build (`PLARAMAIL_DEMO=1`, see [Demo build](setup.md#demo-build)). `npm run test:build` builds both ways and checks.

`vite.config.ts` pre-bundles the UI libraries so the first page load after a fresh start works. If a new dependency brings back "Invalid hook call" on a first load, the dev log names it under "new dependencies optimized": add it to `PREBUNDLE`.

To test inbound mail locally, post a raw message to the dev server's email handler:

```sh
curl -X POST 'http://localhost:5173/cdn-cgi/handler/email?from=sender@example.net&to=hello@example.com' \
  --data-binary @message.eml
```

## Checks

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

`npm run test:browser` opens the mail view in Chromium at desktop width and at 375px (`tests/browser/`). It starts a dev server on port 5199 with `tests/browser/wrangler.ci.jsonc`, which has local bindings only, so it needs no Cloudflare account; the sample inbox fills it. Install the browser once with `npx playwright install --only-shell chromium`. CI runs it as the `browser` job.

Design rules live in [`DESIGN.md`](../DESIGN.md). `tests/design-rules.test.mjs` enforces the ones that can be checked.
