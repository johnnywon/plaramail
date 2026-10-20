# Setup

Everything needed to run PlaraMail on your own Cloudflare account. Back to the [README](../README.md).

## Deploy with the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/johnnywon/pluramail)

The button copies this repo to your GitHub account, creates the R2 bucket, the D1 database, the KV namespace and the Durable Objects, then builds, applies the D1 migrations and deploys. Its form asks for `DOMAINS` and `EMAIL_ADDRESSES`. Enter the addresses comma-separated; every address must belong to a domain in `DOMAINS`. Leave the `POLICY_AUD` and `TEAM_DOMAIN` placeholders: every request returns the "Access must be configured" error until step 5 below replaces them. Then do steps 5 to 8 below: Access, Email Routing, Email Sending, and the check.

To change the addresses later, edit `EMAIL_ADDRESSES` in `wrangler.jsonc` in the new repo and push. The push builds and deploys again.

The Worker answers on its workers.dev URL until you add a custom domain (step 4 under Deploy by hand).

## Deploy by hand

Requirements: a domain on Cloudflare, R2, and Workers Paid for outbound email. The `email` commands below need Wrangler 4.149 or later, so they run through `npx wrangler@latest`.

1. **Install and sign in.** `npm install`, then `npx wrangler login`.
2. **Configure `wrangler.jsonc`.** Set `name`, `account_id`, `vars.APP_NAME`, `vars.DOMAINS`, and `vars.EMAIL_ADDRESSES`. Every address must belong to a domain in `DOMAINS`.
3. **Create the R2 bucket, the D1 database and the KV namespace** named in `r2_buckets`, `d1_databases` and `kv_namespaces`:
   ```sh
   npx wrangler r2 bucket create plaramail
   npx wrangler d1 create plaramail
   npx wrangler kv namespace create OAUTH_KV
   ```
   Copy the `database_id` that `d1 create` prints into the `DB` entry under `d1_databases`, and the `id` that `kv namespace create` prints into the `OAUTH_KV` entry under `kv_namespaces`. The KV namespace holds the MCP server's OAuth clients and tokens.
4. **Deploy.** `npm run build && npm run deploy`. `npm run deploy` applies any new D1 migrations, then deploys. It refuses to run before a build. Until step 5 is done, every request returns an error asking for Access. To serve the app on your own hostname, uncomment `routes` in `wrangler.jsonc` and set the `pattern`, or add a custom domain under the Worker's Settings > Domains & Routes.
5. **Turn on Cloudflare Access** for the Worker under Settings > Domains & Routes ([one-click Access](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/)). Copy the values the modal shows into Worker secrets:
   ```sh
   npx wrangler secret put POLICY_AUD
   npx wrangler secret put TEAM_DOMAIN
   ```
   `TEAM_DOMAIN` must include `https://`; use the team URL or the full `/cdn-cgi/access/certs` URL.

   Then let MCP clients and health checks past Access: clients sign in with the app's own OAuth instead. In Zero Trust › Access › Applications, add a self-hosted application on the same hostname with these three paths and one **Bypass** policy for Everyone:
   - `/mcp`
   - `/.well-known`
   - `/health`

   Or add it with the API, using a token with Access: Apps and Policies Edit. The policy id is an existing reusable Bypass policy for Everyone (list them with `GET .../access/policies`):
   ```sh
   curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
     -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
     -d '{"name":"Mail MCP bypass","type":"self_hosted","domain":"mail.example.com/mcp",
          "destinations":[{"type":"public","uri":"mail.example.com/mcp"},{"type":"public","uri":"mail.example.com/.well-known"},{"type":"public","uri":"mail.example.com/health"}],
          "app_launcher_visible":false,"policies":[{"id":"<bypass policy id>","precedence":1}]}'
   ```

   Console > MCP checks this and shows the two paths with your hostname while Access still blocks clients. `/mcp` covers the OAuth endpoints under it (`/mcp/oauth/token`, `/mcp/oauth/register`). Leave `/authorize` behind Access: it is the consent page, and who passes Access there is who the client acts for. `/health` answers `{"ok":true,"d1":"ok","r2":"ok"}`, or 503 with the store that failed, and nothing else; point an uptime monitor at it if you use one.
6. **Route mail to the Worker.** Enable Email Routing for the domain, then add one rule per address in `EMAIL_ADDRESSES`:
   ```sh
   npx wrangler@latest email routing enable example.com
   npx wrangler@latest email routing rules create example.com \
     --match-type literal --match-field to --match-value hello@example.com \
     --action-type worker --action-value plaramail
   ```
   `email routing enable` adds and locks Cloudflare MX records at the root of the domain. If that domain already receives mail elsewhere, such as Google Workspace, use a subdomain instead: add it under Email Routing > Settings > Subdomains in the dashboard, since Wrangler only enables whole domains. Rules for subdomain addresses are created on the parent domain.
7. **Enable Email Sending** so the Worker can send replies. Cloudflare adds the SPF, DKIM and DMARC records:
   ```sh
   npx wrangler@latest email sending enable example.com
   ```
   This works for a subdomain too, for example `mail.example.com`.
8. **Check it.** `npm run smoke` expects the app and its API to redirect to the Access login, `/health` to report D1 and R2 working, `/mcp` to answer 401 with an OAuth challenge, the OAuth metadata under `/.well-known` to load with the same scopes in both documents and client ID metadata documents on, and `/authorize` to stay behind Access. It reads the hostname from `routes`; without one, run `SMOKE_URL=https://<your worker URL> npm run smoke`. Then send a message to one of your addresses. A configured address gets its mailbox on first delivery, so mail is kept even if nobody has opened the app yet.
9. **Check sending and receiving (optional).** `npm run smoke:mail` sends real mail between two of your addresses and reads it back: a message to `SMOKE_TO` with a Cc to `SMOKE_FROM`, an HTML body, a 256-byte binary attachment and a short text attachment. It checks the subject, the formatting, the Cc and that both attachments download byte for byte, then replies and checks the reply threads on both sides, forwards the message back and checks the attachments came with it unchanged, and moves everything it sent and received to Trash. It prints one line per check and exits 1 if any fails. It sends three messages, which count against your Email Sending quota, so it does not run on its own.

   It reaches the API through Access with a service token. Create one under Zero Trust > Access > Service credentials, add a **Service Auth** policy for it to the Worker's Access application, then run:
   ```sh
   SMOKE_FROM=hello@example.com SMOKE_TO=billing@example.com \
   SMOKE_ACCESS_CLIENT_ID=<client id> SMOKE_ACCESS_CLIENT_SECRET=<client secret> \
   npm run smoke:mail
   ```
   `SMOKE_URL` sets the host as for `npm run smoke`, and `SMOKE_TIMEOUT` the seconds to wait for each delivery (60 by default).

### Troubleshooting Access

- `Invalid or expired Access token`: `POLICY_AUD` or `TEAM_DOMAIN` is wrong. Turn Access off and on for the Worker to see the values again, then reset both secrets.
- `POLICY_AUD is missing`, `TEAM_DOMAIN is missing`, or `TEAM_DOMAIN must be an https:// URL`: correct the missing or malformed secret. The Worker fails closed on purpose.

## DMARC

DMARC tells receiving servers what to do with mail that claims your From domain but fails authentication. It is one TXT record at `_dmarc.<your domain>`. Its policy, `p=`, is one of:

- `p=none`: deliver the mail as usual and only report on it.
- `p=quarantine`: put failing mail in spam.
- `p=reject`: refuse failing mail.

A message passes DMARC when SPF or DKIM passes and that check is in alignment with the From domain: the DKIM signature's `d=` domain, or for SPF the envelope sender (Return-Path) domain, must match the From domain or share its organizational domain. Email Sending signs each message with DKIM for your domain, so DKIM is the check that aligns. The Return-Path is set by Email Sending for its bounce handling, so do not count on SPF alignment. To confirm, open a message you sent in another provider's mailbox and read its `Authentication-Results` header: it should show `dkim=pass` with `header.d=example.com` and `dmarc=pass`.

Step 7 adds a DMARC record. Look at it before adding one: a domain can have only one, and a second makes receivers ignore both. Start at `p=none` with `rua` reports, which receivers send as daily XML summaries of the mail they saw from your domain, including mail you did not send:

```
_dmarc.example.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com"
```

The `rua` address can be one of your addresses in `EMAIL_ADDRESSES`. Once the reports show only your own sending passing, move to `p=quarantine`, then `p=reject`. The same applies to a subdomain you send from, under `_dmarc.mail.example.com`; without its own record a subdomain follows the parent's `sp=` or `p=`.

Bounces: because Email Sending sets the Return-Path, most bounces for mail sent from PlaraMail go to Cloudflare, not to your mailbox. When a bounce notice (a delivery status report) does reach a mailbox, PlaraMail files it in the conversation of the Sent message it is about.

## Configuration

| Setting | Where | Purpose |
| --- | --- | --- |
| `APP_NAME` | `vars` | Name in the header, status bar and page titles |
| `DOMAINS` | `vars` | Comma-separated domains that receive mail |
| `EMAIL_ADDRESSES` | `vars` | Addresses that get a mailbox, as a list or a comma-separated string. Mail to other addresses bounces. |
| `ATTACHMENT_SEARCH` | `vars` | `true` makes attachment text searchable. Uses one Workers AI `toMarkdown` call per PDF, Word or Excel file. |
| `MCP_SEND_ENABLED` | `vars` | `false` takes the send tools away from every MCP client, whatever it was granted |
| `ALERT_TO` | `vars` | An address for error alerts, best one this deployment doesn't receive. Once an hour, if a request threw, inbound mail failed, a cron step failed or `/health` fails, the Worker mails it the errors since the last alert, from the first address in `EMAIL_ADDRESSES`. Unset sends none. |
| `POLICY_AUD`, `TEAM_DOMAIN` | secrets | Cloudflare Access verification |
| `global_fetch_strictly_public` | `compatibility_flags` | Lets MCP clients sign in with a Client ID Metadata Document URL as their `client_id`. Without it the OAuth metadata reports `client_id_metadata_document_supported: false` and such clients get "Can't connect this app". `wrangler.jsonc` sets it; a deployment with its own config adds it next to `nodejs_compat`. |

To rebrand a deployment, set `APP_NAME` and replace the files listed in [`public/brand/README.md`](../public/brand/README.md).

## MCP clients

The MCP server is at `https://<your host>/mcp`. Clients sign in with OAuth 2.1: add the URL to Claude Code, Claude Desktop, Codex, Cursor, Grok or any client that supports MCP authorization, and it registers itself and opens the consent page in your browser. The consent page is behind Access, so you sign in there as yourself.

Every app gets **Read and organize mail**: search, read, label, move, draft and delete on every address. **Send mail** is a separate box on the consent page, off by default. It adds `send_draft`, `reply_to_email` and `send_email`; without it the client doesn't see them. Sends from MCP count against the agent limits in Console > Limits, and each takes an idempotency key so a retry never sends twice. `reply_to_email` only goes out if the email is still the newest one received in its conversation and the client names the reply address it read from `get_email`.

Console > MCP lists the apps you connected, with what each may do, and revokes them. Access tokens last an hour; refresh tokens last 30 days.

## Auto-draft queue

A queue retries an agent's draft that failed, for example on a model timeout. It is optional: without it each draft is tried once.

```bash
npx wrangler queues create plaramail-drafts
npx wrangler queues create plaramail-drafts-dlq
```

Then uncomment `queues` in `wrangler.jsonc` and deploy. Keep `max_retries` at 3. Messages that fail every retry wait in `plaramail-drafts-dlq`, and their runs show as Failed in Console > Activity.

## D1 migrations

`npm run deploy` applies new D1 migrations before it deploys. If you deploy another way, run `npx wrangler d1 migrations apply DB --remote` first: new code writes columns that later migrations add (`0002_has_link.sql` adds `has_link`; `0003_attachment_text.sql` queues older attachments for `ATTACHMENT_SEARCH`; `0004_attachment_trigram.sql` adds substring search over their text; `0005_drop_copy_job.sql` drops the tables of the copy from Durable Objects; `0006_agent_reliability.sql` adds send attempts, send limits, auto-draft runs, the activity log and draft notes). A search that finds no substring table fails, so apply `0004` before deploying a version that has it. Adding a column doesn't break the version already running.

## Upgrading from Durable Object storage

Before 0.5, mail was stored in one Durable Object per address, with a combined index in another. 0.6 deletes that storage and the mail in it. A deployment still on it (`"STORAGE": "do"`) must upgrade to 0.5.x first, copy its mail to D1 ([Moving to D1 in the v0.5.1 docs](https://github.com/johnnywon/pluramail/blob/v0.5.1/docs/setup.md#moving-to-d1)) and switch to `"STORAGE": "d1"`, then install 0.6.

## Demo build

A demo build comes up filled with the [sample inbox](development.md#sample-inbox) on an empty, migrated database, so you can show the app without real mail. Anyone who opens it can read, search, file, label, star, delete and save drafts.

```sh
PLARAMAIL_DEMO=1 npm run build
npm run deploy
```

`PLARAMAIL_DEMO=1` is read at build time. A build without it carries none of the sample inbox or the demo code. A demo build:

- Sends nothing. Send, reply, forward and scheduled send return 403 `Sending is off in the demo`. The cron sends no scheduled mail. Incoming mail is rejected.
- Allows two AI actions, on a daily cap: turning plain words into a search, and Redraft on an agent's draft. Both use one Workers AI model that runs on the Workers Free plan (`DEMO_AI_MODEL` in `workers/lib/demo.ts`) whatever the model settings say. Together they stop after `DEMO_AI_DAILY` calls per UTC day across all visitors (default 200; `0` turns them off), then return 429 `The demo's AI calls for today are used up`. The count is in D1 (`ai_budget`), and the hourly reset keeps it. The agent, its panel, Draft and Draft reply, auto-draft and the model test stay off. `/agents/*`, `/mcp`, `/authorize` and the OAuth metadata return 403.
- Keeps settings read-only. Console > Save, addresses, model, limits and prefs return 403 `Settings are read-only in the demo`. Any other write not on the demo's list is refused the same way (`workers/lib/demo.ts`).
- Needs no sign-in. It skips Cloudflare Access, so `POLICY_AUD` and `TEAM_DOMAIN` are not needed and Log out is hidden. `npm run smoke` expects an Access redirect and fails against a demo.
- Writes the sample inbox again every hour on the hour. The reset deletes all mail, files, labels, saved searches and undo history, then writes the sample inbox with fresh dates. Between resets, a new isolate moves the dates forward when the newest message is over 30 minutes old.

Sample times follow the time zone of the machine that ran the build.

Give a demo its own Worker, D1 database and R2 bucket. Its Wrangler config keeps the cron trigger (the hourly reset runs on it) and leaves out `send_email`, so no real send can happen even if the demo gate were bypassed. Keep the `ai` binding for the two AI actions; without it they fail and nothing else changes. Set `EMAIL_ADDRESSES` to six addresses named `hello`, `billing`, `support`, `legal`, `ops` and `press` so every part of the sample inbox has its own mailbox. Run it locally with `PLARAMAIL_DEMO=1 npm run build && npx vite preview` against a migrated local database.

For the [Alex profile](demo-alex.md), set `SEED_PROFILE` to `alex` in the demo's `vars`, `EMAIL_ADDRESSES` to its nine addresses (`hello`, `support`, `billing`, `partners` and `ops` at `partwell.dev`, `alex` and `league` at `alexrivera.me`, `booking@latecommits.band` and `alex@riverbendcode.org`) and `DOMAINS` to `partwell.dev,alexrivera.me,latecommits.band,riverbendcode.org`. Its times are New York times on any machine, and links in its mail open a page in the app instead of leaving it.

## Keeping a deployment in its own repo

A deployment can keep its config and brand files outside this checkout, for example in a private repo that includes this one as a submodule. Build with:

```sh
PLARAMAIL_WRANGLER_CONFIG=../wrangler.jsonc PLARAMAIL_PUBLIC_DIR=../public npm run build
npm run deploy
```

`PLARAMAIL_WRANGLER_CONFIG` replaces `wrangler.jsonc`. Paths inside it, such as `main` and the D1 `migrations_dir`, are relative to that file; with this repo as `engine/`, that is `"migrations_dir": "engine/migrations"`. `PLARAMAIL_PUBLIC_DIR` replaces `public/`, so it must hold the full set of brand files. `npm run deploy` then applies D1 migrations and deploys with the config the build wrote to `build/server/`.

## Renaming a deployment

A release that changes the names in the example `wrangler.jsonc` does not rename anything already deployed. Keep `name`, `bucket_name`, `database_name`, `database_id`, the KV `id` and any queue names from your current config, and nothing moves.

To rename a deployment, do it in two steps. The first moves the Worker and copies no data. The second moves R2 and the draft queues. Each step is one deploy. The D1 database keeps its name. `<old>` and `<new>` below are the Worker names.

### 1. The Worker

The Worker's Durable Objects hold the chat agent's conversations and MCP sessions. A transfer migration moves them to the new Worker with their storage. Mail, labels and settings are in D1 and stay where they are.

1. In your config, set `name` to `<new>`. Leave the D1, R2 and KV entries as they are: bindings use the ids, so the new Worker reads the same data.
2. Replace the whole `migrations` list with one transfer. The new Worker has no migration history, so it must not run the create migrations again:
   ```jsonc
   "migrations": [
   	{
   		"tag": "v1",
   		"transferred_classes": [
   			{ "from": "EmailAgent", "from_script": "<old>", "to": "EmailAgent" },
   			{ "from": "EmailMCP", "from_script": "<old>", "to": "EmailMCP" }
   		]
   	}
   ]
   ```
   Keep this list in your config from now on. When a later release adds a Durable Object migration, append it here with a new tag.
3. With a custom domain, remove it from `<old>` (Settings > Domains & Routes) so the deploy can attach it to `<new>`.
4. `npm run build && npm run deploy`. Until the next step the new Worker answers with an Access error.
5. Set the secrets again on the new Worker. Worker secrets do not move. `npx wrangler secret list --name <old>` lists them; `POLICY_AUD` and `TEAM_DOMAIN` at least:
   ```sh
   npx wrangler secret put POLICY_AUD
   npx wrangler secret put TEAM_DOMAIN
   ```
   On a custom domain the Access applications are tied to the hostname and stay. On workers.dev the hostname changes with the Worker name: turn on Access for `<new>` (step 5 of Deploy by hand), add the bypass paths for the new hostname, put the new `POLICY_AUD`, and reconnect MCP clients.
6. Point every Email Routing rule at `<new>`: Email Routing > Routing rules, edit each rule's action. Mail goes to `<old>` until you do.
7. Check: `npm run smoke -- https://<your host>`, open a chat with the agent and see the earlier conversation, send yourself a message and see it arrive.
8. In the dashboard, check that the `EmailAgent` and `EmailMCP` namespaces (Durable Objects) now list `<new>` as their Worker. Then delete `<old>`: `npx wrangler delete --name <old>`.

### 2. R2, queues and D1

R2 buckets and D1 databases cannot be renamed. Bindings use ids, so the names are labels in your config and the dashboard.

R2: create the new bucket, copy, switch, copy again.

1. `npx wrangler r2 bucket create <new bucket>`
2. Copy with any S3 client and an R2 API token with Object Read & Write on both buckets, for example `rclone copy r2:<old bucket> r2:<new bucket>`. The copy only adds objects, so you can run it again.
3. Set `bucket_name` to the new bucket and `npm run deploy`.
4. Run the copy once more for attachments that arrived in between, then delete the old bucket.

Queues (only with the draft queue): create `<new>-drafts` and `<new>-drafts-dlq`, rename them in `queues`, let the old queue empty (`npx wrangler queues info <old queue>`), deploy, then delete the old queues.

D1: keep the database. `wrangler d1 export` does not support databases with virtual tables, and this one has its full-text search tables, so there is no supported copy. A new database starts empty.
