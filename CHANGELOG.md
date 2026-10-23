# Changelog

Versions follow [semantic versioning](https://semver.org). Before 1.0, a minor version can break things. Each entry names any new D1 migration. `npm run deploy` applies it; if you deploy another way, run `wrangler d1 migrations apply DB --remote` before you deploy that version.

## Unreleased

### Added

- Action agents. An agent's Does field is Reply, Star, Label (one label, picked at setup), Archive or Mark read. Reply is the 0.9 behaviour. An action agent's ladder is Watch, then On: Watch logs "Would star", On does it.
- An action agent whose rules pass acts with no model call. New agent offers a From rule from the job ("from example.org"). An action agent with no rules gets one tool in the drafting run (`star_email`, `label_email`, `archive_email` or `mark_read`) and no reply tool, and the model says whether its job fits.
- Every fitting action agent acts on a message, once. At most one reply agent replies, by list order, and an action never stops a reply.
- Each action is in Console > Activity with Undo for 30 days: unstar, remove the label, move back to the inbox, mark unread. `POST /api/v1/agent-actions/:id/undo`, `GET /api/v1/agents/:id/actions`.
- An action agent has a daily limit, 100 by default.

### Changed

- Console > MCP checks `/health` as well as `/mcp`, and lists all three bypass paths (`/mcp`, `/.well-known`, `/health`) while Access blocks either. When only `/health` is blocked, it says so: health checks and `npm run smoke` fail until it is added.

### Fixed

- Every chat and drafting request has a size limit, checked on each step of a run: about 40K tokens for chat and 20K for drafting, the system prompt and tool definitions included. Before, one long request or the tool output of a long run went to the model whole. Earlier requests go first, then older tool output in the current request becomes a stub (the latest two results stay), then a result still too long is cut to its start, then a very long message keeps its start and end. Each cut says so in the text the model reads. `workers/agent/request-budget.ts` has the numbers.
- Drafting quotes the new email up to 12,000 characters and the earlier messages up to 6,000, newest first. `get_email` returns up to 16,000 characters of a body and `get_thread` the newest messages up to 24,000 in all. Asking for the same email or thread twice in one run returns a note instead of the text again.

D1 migration: `0013_action_agents.sql`. `npm run deploy` applies it.

## 0.9.5

### Added

- `GET /health` checks D1 and R2 and answers `{"ok":true,"d1":"ok","r2":"ok"}`, or 503 naming the store that failed. The Worker answers it before the Access check. Add `/health` to the Access bypass next to `/mcp` and `/.well-known` (docs/setup.md, step 5); `npm run smoke` checks it and fails until it's there.
- Error alerts. Requests that throw, inbound mail the Worker can't store and failed cron steps are recorded. With `ALERT_TO` set in `vars`, the hourly cron mails that address the errors since the last alert, and a failed health check, from the first address in `EMAIL_ADDRESSES`. Unset sends nothing. Recorded errors are kept 30 days.
- `npm run test:browser` opens the mail view in Chromium at desktop width and at 375px against a dev server with local bindings and the sample inbox. CI runs it as the `browser` job.

### Changed

- The app is PlaraMail. `APP_NAME` defaults to PlaraMail, the lockups and the link preview card carry the new wordmark, and the MCP server reports its name as `plaramail`. The Fold mark and the app icons are unchanged.
- Build env vars are `PLARAMAIL_WRANGLER_CONFIG`, `PLARAMAIL_PUBLIC_DIR`, `PLARAMAIL_DEMO` and `PLARAMAIL_PERSIST`. The earlier names are not read.
- The example `wrangler.jsonc` names the Worker, the D1 database and the R2 bucket `plaramail`, and the draft queues `plaramail-drafts` and `plaramail-drafts-dlq`.
- `public/brand/lockup-dark.png` and `lockup-light.png` are 332 × 74. A deployment with its own lockups makes them that size (public/brand/README.md).
- docs/setup.md has a section on renaming a deployment: the Worker moves with its Durable Objects through a transfer migration; R2 and the queues are copied; the D1 database keeps its name.
- Every source file carries the license header, and `tests/public-scrub.test.mjs` keeps it so. Tests use example hosts for Cloudflare Access, and the search prompt names no real company.

- README screenshots are retaken on 0.9.5 in both themes. The Alex sample inbox keeps the Supabase compute notice (O-19) in the Inbox instead of Archive, and it is the open message in the hero shot.

### Fixed

- Enter in search opens the first result only once the results for what you typed have arrived. Before, a quick Enter opened the first conversation of the list you were on, which at phone width covered the results.

### Upgrading

- Add `/health` to the deployment's Access bypass application, or `npm run smoke` fails on it.
- A deploy repo renames its build env vars before it builds 0.9.5. A build or `npm run deploy` that sets only an earlier name stops and names the new one (`scripts/check-env.mjs`), instead of using this repo's example config and deploying a new Worker named `plaramail`.
- Keep your own Worker, D1, R2, KV and queue names in your config. Nothing has to be renamed. To rename anyway, follow Renaming a deployment in docs/setup.md.
- If your config sets `APP_NAME` to the previous default, set it to `PlaraMail`.

D1 migration: `0012_error_log.sql`. `npm run deploy` applies it.

## 0.9.4

### Added

- Unsubscribe in the reader, for mail with a `List-Unsubscribe` header. With RFC 8058 one-click, the Worker posts the request itself, only to a public https host. A list that offers only a link opens it in a new tab; one that offers only a mail address opens the composer filled in, for you to send. `POST /api/v1/mailboxes/:mailboxId/emails/:id/unsubscribe`.
- Block sender in the reader. New mail from a blocked address goes to Trash, marked read, and no agent sees it. Mail already received stays where it is. Console > Addresses lists blocked senders with Remove. `POST .../emails/:id/block`, `GET /api/v1/blocked-senders`, `DELETE /api/v1/mailboxes/:mailboxId/blocked-senders/:address`.
- `star_conversation` for the chat agent and MCP clients. It stars or unstars a conversation the way `s` does, and is logged in Activity. MCP has 25 tools.
- HTML mail gets a plain-text part when the sender wrote none, on every send path.
- A delivery report (`multipart/report`) that reaches a mailbox joins the conversation of the Sent message it is about. Cloudflare Email Sending sets its own Return-Path, so most bounces go to Cloudflare, not the mailbox.
- docs/setup.md has a DMARC section: policies, alignment, an example record.
- `npm run smoke:mail` also checks a text attachment byte for byte.

### Fixed

- Text attachments no longer gain a newline each time they are received. The parser kept the line break that belongs to the MIME boundary. Attachments sent as 7bit or quoted-printable with CRLF line endings still arrive with LF.
- A chat run that reaches its 20-step limit ends with "Stopped after 20 steps. Ask me to continue." On Workers AI the last step could still call a tool and end with no answer.
- Chat replies no longer include the model's reasoning. Earlier reasoning is not sent back to the model, `<think>` blocks are split out, and chat on GLM 5.3 Flash runs at low reasoning effort.
- The chat agent no longer resends its whole history on every step. The last two requests go whole; older tool output over 300 characters becomes a short stub, and the oldest requests are dropped past about 30K tokens.
- Draft reply on the reader's reply bar waits for the agent connection, shows Drafting… at once, retries once, and says "The agent didn't start. Try again." if it can't. A reply opened for drafting is not saved while it has no text of its own.
- Move up and Move down on an agent keep focus on the agent's arrow and announce the new position.
- Turn into a search no longer explains a date filter the query doesn't have. The explanation is built from the query instead.

D1 migration: `0011_blocked_senders.sql`. `npm run deploy` applies it.

## 0.9.3

### Added

- Undo send. Send holds the message for 5 seconds with Undo in the toast; Undo reopens it. The browser asks before a tab closes during the hold, and the message stays in Drafts if it does. The pop-out compose window sends at once.
- To, Cc and Bcc suggest people you wrote to and people who wrote to you as you type. `GET /api/v1/contacts?q=` returns them.
- Files can be pasted or dropped on the compose window.
- The tab title and icon show the number of unread conversations.
- Keep Trash and Spam: Forever (the default), 30, 60 or 90 days, in Console > Preferences. With a number set, the hourly cron deletes mail that has been in Trash or Spam that long, with its files in R2, 500 messages a run. The days count from when the message moved there; mail that arrived in Spam counts from its date. Prefs carry it as `trashDays`.
- Console > Addresses shows, for an address that has received nothing yet, how to route mail to the Worker with a catch-all rule in Email Routing and the command that enables sending. It goes once mail arrives.
- SECURITY.md (private reporting through GitHub, supported versions) and CONTRIBUTING.md, which takes over the README's Contributing section.

### Fixed

- The 5 MiB message limit is enforced. The compose window refuses files that would take a message over it, counted with the files base64 encoded, and `sendMail` refuses a larger message before it spends any send budget. docs/mcp.md says how many files fit.

D1 migration: `0010_folder_changed_at.sql` (when a message last changed folder, for the Trash and Spam retention). Mail already in Trash or Spam counts from the migration. `npm run deploy` applies it.

## 0.9.2

### Added

- `npm run smoke:mail` sends real mail between two of your addresses and checks it arrives: subject, HTML formatting, Cc, the attachment byte for byte, a reply threading on both sides and a forward keeping the attachment. Then it moves everything to Trash. It is opt-in and reaches the API with an Access service token (docs/setup.md, step 9).

### Upgrading

- D1 migration `0009_search_fold.sql` rebuilds the substring search tables (`messages_trigram`, `attachment_trigram`) from stored mail. It runs once, in one pass over every message.
- Add `"global_fetch_strictly_public"` to `compatibility_flags` in a deployment's own Wrangler config. `wrangler.jsonc` has it. It lets MCP clients sign in with a Client ID Metadata Document URL, and `npm run smoke` fails without it.

### Fixed

- Forward carries the original's attachments. They show as files in the composer, where you can remove any of them, and the Worker copies the rest from R2 when it sends. The send and schedule APIs take `forward_attachments`, a list of the original's attachment ids.
- Quotes the Worker writes into drafts ("On …, … wrote:") show the time in your time zone instead of unlabelled UTC. The browser saves its time zone in prefs as `timeZone`. Until one is saved, the quote says UTC.
- Schedule send no longer lists Monday 8:00 AM twice on a Sunday.
- Sent rows show who the mail went to: "To" and the first recipient, with a count of the others, instead of your own address. `/api/v1/mail` rows carry `recipient`.
- Search folds accents in substring matches too, so `sume` finds Résumé, and folds letters Unicode doesn't split into a letter and an accent (ø, æ, œ, ß, ł, đ, ð, þ, ı), so `unicode` finds ünïcødé. Word search already matched `cafe` with café. Mail stored before this version gets the letter folding in subjects, addresses, attachment names and attachment text, not in body words.
- `label:` matches a label's current name. After a rename, the old name no longer matches. Spaces in a name can be written as hyphens (`label:tax-2026`). The API's `label=` parameter still takes ids.
- The Cancel button on a scheduled draft's row is named "Cancel scheduled send" for screen readers and browser agents.
- An agent reply no longer offers Open draft for a draft it sent later in the same turn.
- `/authorize` with a Client ID Metadata Document URL as `client_id` returned 500, because the OAuth library needs the `global_fetch_strictly_public` flag for those documents. The flag is now set. Any error `/authorize` doesn't recognise shows the "Can't connect this app" page and is logged.
- The protected resource metadata (`/.well-known/oauth-protected-resource/mcp`) lists both scopes, `mail` and `mail.send`, as the authorization server metadata does. A client that builds its request from it can now ask for `mail.send`. `mail` stays the only required scope. docs/mcp.md says which document to read.
- `npm run smoke` checks that both OAuth documents list the same scopes and that client ID metadata documents are supported.
- Your agents: each agent row has Move up and Move down buttons, so the order can be changed from the keyboard, a screen reader or a browser agent. They use the same `PUT /api/v1/agents/order` as dragging.
- The Send rung and the "To move to Send" gates show 0.10, the release Send arrives in, instead of 0.9. The Console and the API read it from one constant, `SEND_VERSION` in `shared/agent.ts`.
- A watched run's reason is plain text of the reply the agent would have sent, without HTML entities or the quoted original. Reasons stored before this version are unchanged.
- Console > Activity logs a `discard_draft` entry with the reason when a run throws its draft away: no agent's job fits, Watch mode, an earlier draft from the same run, or newer mail in the thread. A run that ended skipped no longer leaves a successful draft as the last word.
- Delete agent's confirm button reads "Yes, delete <name>", focus moves to Keep, and clicks in the first 400 ms are ignored, so a double-click no longer deletes the agent.
- `?console=preferences`, `settings` and `prefs` open Preferences. Any other page name the console doesn't know opens Overview instead of closing the console.
- Writing a signature no longer turns on Add by default. A new signature starts off, as the guide says.
- Sends per address on Overview, and Mail storage, show whole addresses (`hello@example.com`, not `hello@example`). A long one is cut with an ellipsis and shown in full on hover.
- The agent chat gets 20 steps instead of 5, and the last one has no tools: a run that reaches the limit ends by saying it stopped after 19 steps, what it finished and what is left, instead of stopping mid-task. Auto-draft keeps its 5 steps.
- Redraft keeps the quoted original of a draft the composer has saved. The composer leaves an empty paragraph after the quote, and the quote was only found when it was the last thing in the body. The "On …, … wrote:" line the composer writes outside the quote stays with it.
- List rows, the signature and two console texts are 13px instead of 14px, and every icon is 10, 12, 14, 16 or 20px, the sizes DESIGN.md lists. `tests/design-rules.test.mjs` checks both.
- On macOS, the agent input's and send button's bottom-right corners follow the window's round corner (`--window-corner`, 26px, less each one's inset). Other systems, phone widths, full screen and a page with vertical tabs, a side panel or docked DevTools beside it keep 6px. `<html>` carries `data-os="mac"` on a Mac.

D1 migration: `0009_search_fold.sql` (folded substring search). `npm run deploy` applies it.

## 0.9.1

### Added

- The console rail ends with a colophon: messages, storage, addresses and uptime, then the mark, the version and a link to the source. `/api/v1/config` returns `version` and `deployedAt`, and `/api/v1/storage/status` returns `bytes`.
- The rail heads name the view beside the fold mark: All Inboxes in mail, Console in the console, in white beside a white search icon. The logo appears only in the colophon, as the lockup from `public/brand`.
- Opening the console and going back to mail each have their own move, in the side columns' motion: the console's rail slides out from the left and its page comes in from the right; back to mail, the rails settle in from their edges and the list comes in from the left.
- By address, Labels and an address's folders open and close in the rail with the side columns' motion: the group eases open, its rows settle in one after another, and the caret turns.
- AI models moves in the same language. Change model slides the picker in from the right and Back brings the summary in from the left, with focus back on Change model. The key row under Providers eases open and focuses its field. Test keeps its width while it runs and shows a steady dot; its result settles in with a check or a warning.
- The colophon logo comes up as the console opens: a faint recessed watermark, then its colour rises through it and settles into focus.
- Console > Keyboard shortcuts opens with the keyboard map from the ? dialog. Click a key on the map to change it; the list below follows.
- Figures (`shared/figures.ts`): one way to show counts, sizes and lengths of time in six characters or fewer. Uptime steps from minutes to hours, days, weeks, months and years. Sizes step up a unit instead of rounding to 1000 (999.6 MB is 1.00 GB).

### Upgrading

- Add `"version_metadata": { "binding": "CF_VERSION_METADATA" }` to a deployment's Wrangler config for the colophon's uptime. Without it, uptime shows "—".

### Fixed

- Show key hints off now hides every key hint: the keys in tooltips and the Esc on Back to mail, which also follows its binding now. The switch is also on Console > Keyboard shortcuts.
- `npm run smoke` checks MCP sign-in: `/mcp` answers 401 with an OAuth challenge, the OAuth metadata under `/.well-known` loads, and `/authorize` stays behind Access. When Access still blocks `/mcp`, it says to add the bypass.
- Activity log: "Keep for" is a dropdown, the Actions toolbar no longer sits on the line above it, and a filter keeps the rows (dimmed) until its own load instead of flashing "Loading". The picked filter in console toggles is marked in purple, like a picked choice.
- An agent shows Working only while a run moved in the last 10 minutes. A run that died no longer keeps the badge until the hourly cleanup, and the sample data gives one agent a live run instead of all of them.
- The Overview's Auto-drafts card names two states, failed first after drafted, instead of a cut-off list.
- Keyboard shortcuts loses the empty row above the list; it shows only to hold Reset all. Mail storage puts 32px between the total and the table.
- Addresses, Signatures and Labels lose their explaining lines.
- The sidebar footer buttons (Console, Keyboard shortcuts, Log out) are flat recessed wells set into the rail, deeper while held.
- New agent: the name is a one-line field instead of a tall box, and the Watch badge no longer stretches across its row.
- Setup and the README name both bypass paths, `/mcp` and `/.well-known`, and setup shows how to add the bypass application with the Cloudflare API.

No D1 migration.

## 0.9.0

The Console is a page of its own, with hired agents, and MCP clients sign in with OAuth.

### Upgrading

- `/mcp` takes OAuth bearer tokens only. Anything that reached it with an Access service token must reconnect through OAuth.
- Bind a KV namespace as `OAUTH_KV` (`npx wrangler kv namespace create OAUTH_KV`, id into `kv_namespaces`).
- Add an Access application with a **Bypass** policy for `/mcp` and `/.well-known` on the same hostname. `/authorize` stays behind Access. Console > MCP warns with these paths until clients can get through.
- `AUTO_DRAFT_ENABLED` is removed. A deployment that relied on it drafting every email now drafts only through agents, or through the PluraMail Agent if you turn on drafting for mail no agent takes.

### Console

- The Console replaces the mail with its own rail and search: Overview; Agents (Your agents, Draft review, Activity log); Connections (AI models, MCP); Mail (Addresses, Signatures, Labels); App (Preferences, Keyboard shortcuts, Mail storage). The agent panel stays on the right. `?console=<page>` opens a page, and older tab names still resolve.
- Edits save on their own. There is no Save button.
- Pages open on their content: no subtitles under the page titles.
- `ConsoleUI.tsx` and `.pg-ui-*` are the Console's design system. `tests/console-design-system.test.mjs` fails on any other class.

### Agents

- Each agent has one job on the addresses you choose and runs in Watch or Draft. Send arrives in 0.10. New agents start in Watch. Agents take mail in list order: when two agents' jobs fit, the higher one takes it. Drag to reorder.
- New agent is three steps: Job (with starting points: decline pitches, ask for missing details, acknowledge, answer FAQs), Addresses, Name.
- Each agent has a daily limit (25 by default) and two replies a day to one sender, and replies only to the sender of the message it took.
- Nothing drafts every email. New mail goes to the agent only when an enabled agent's addresses and rules take it, or you choose that the PluraMail Agent drafts mail no agent takes. "When no agent matches" defaults to leaving it. Rules are checked before any model call.
- Draft review shows drafts waiting for you as mail rows.
- Agent drafts and Redraft run Kimi K2.6 with `reasoning_effort: "none"`: a draft takes 8 to 9 s instead of 45 to 50. Chat keeps full reasoning.

### MCP

- Clients find the server from the 401, register themselves, and you approve them on `/authorize`.
- Every grant can read and organize mail. **Send mail** is a separate box on the consent page, off by default; without it the client doesn't see `send_draft`, `reply_to_email` or `send_email`. `MCP_SEND_ENABLED=false` turns sending off for every client. An MCP session answers only the token that opened it, and a token narrowed at the token endpoint loses Send.
- `reply_to_email` sends in the conversation only if the email is still the newest one received there and the client names the reply address from `get_email` (`replyTarget`). `send_email` starts a new conversation. Both take an idempotency key, attachments up to 5 MB, and the agent send limits. A retry with a key that already sent answers `already_sent`, even after newer mail arrived.
- Console > MCP is the server URL, Connect (one command per client: Claude Code, Claude Desktop, Codex, Cursor, Grok, Other) and Connected apps with Revoke.
- `docs/mcp.md` covers connecting each client, sign-in, scopes, sending safely, idempotency keys, error codes and every tool's arguments.

### AI models

- The page opens on the agent model: its name, then Provider, Maker, Model ID, Retention, Context and Price, then Change model and Test.
- Providers is one table with the same columns for Cloudflare and OpenRouter: Training, Retention, Models and Key, with links to each provider's model list and policy.
- Zero retention is a guide, not a filter. OpenRouter lists every paid model. Models with a zero retention endpoint carry a shield, are priced at that endpoint, and their requests send `zdr: true`, so they never fall back. When OpenRouter's zero retention list can't be read, every request asks for zero retention and the list is read again after a minute. Other models send `data_collection: "deny"` only. Providers that train on prompts are still refused, and free models are still never offered or accepted.
- Cloudflare lists only the models its catalog API returns, which are the models it hosts. Claude runs through OpenRouter.

### Fixed

- The draft checker could replace a draft with its own verdict ("No system artifacts found. Return email exactly as is.") or put "No changes needed." in front of it. Its output is now kept only when it is the draft with lines removed.
- A Watch agent's draft, or a draft no agent took, could stay in Drafts when the run failed after saving it. Both paths now settle the same way.

D1 migration: `0008_agents.sql` (agents, and `draft_notes.agent`).

## 0.8.2

Motion. Everything that opens and closes moves on one curve.

- The sidebar and the agent panel open and close with motion. At 1300px and up the column's width eases between rail and column while the column slides under the rail; below 1300px it slides in over a scrim, and on phones the agent rises as a sheet. A toggle mid-move reverses from where it is.
- Closed columns stay mounted and inert. The agent mounts on its first open and stays connected after you close it. A column that closes with focus inside hands it to its rail.
- While a column moves, an email holds its height until the motion ends, so the reader lays out once a frame.
- The search window unrolls down from the bar and rolls back up; a close that turns back reverses.
- Popovers, menus, row tools, the composer, toasts and tooltips enter on the same curve without scaling text. Toasts no longer slide in off-center.
- Reduced motion turns all of it off.
- Key hints next to controls are off by default; turn them on in Settings > General. A deployment that already saved its settings keeps its choice. Tooltips and Settings > Shortcuts show keys either way; before, turning hints off emptied the keys in both.
- The agent panel names the open email while you search, even when the search leaves that email out of the list; it said "(no subject)".
- The MCP server reports its name as `pluramail` and the app's version; it said `agentic-inbox` 1.0.0.
- README: When it fits and For agents sections, and an `llms.txt` summary. The roadmap adds sign-in and roles for teams. `AGENTS.md` sets the writing voice.

No D1 migration.

## 0.8.1

Fixes after 0.8.0.

- Inline images apply only to HTML mail.
- The demo's hourly reset puts back a copy of the sample inbox in one D1 batch instead of writing it again, so it fits the Workers Free plan. It also clears the activity log, uses the cron's scheduled time, and no longer overlaps a visitor's first request. A new story week or a missing sample message writes the inbox in full and takes a new copy.
- A demo counts an AI action against `DEMO_AI_DAILY` only after the request passes CSRF and validation.
- A demo keeps the agent panel and its buttons; the panel and Draft say the agent is off in the demo. Its Console shows only Settings, read-only apart from Labels.
- Search suggestions and the Filter menu name their parts with commas for screen readers and browser agents.
- Less copy: no Console subtitles or tab intros, empty folders show a title only, tooltips name the action and its key, and search says Search mail. The log-out dialog no longer says nothing is sent while you're away.
- One word per action: Move to Trash, New message, Cancel. US spelling throughout. Keys shown in the editor and search come from your own shortcuts.
- The demo's agent panel opens on a notice card that says the agent is off in the demo; anything asked gets the short form as the reply.
- Brand: the Fold mark is the favicon, the app icons, the link card and the README logo, and sits in the sidebar's top-left corner in place of the four dots.
- The sample photos are all CC0 and show without a caption; their credits are in the asset manifest.
- README rewritten in a plain voice, with requirements, status and limits up front.
- README screenshots retaken from the sample inbox.

No D1 migration.

## 0.8.0

The app is readable to browser agents, and a demo build fills itself with sample mail.

### Upgrading

- Build env vars are `PLURAMAIL_WRANGLER_CONFIG` and `PLURAMAIL_PUBLIC_DIR`. Set them in a deploy repo's scripts.
- Browser layout (collapsed panels) starts from the defaults once.

### Readable to browser agents

Agents that drive a browser, such as Aside, gstack browse, Playwright and Claude in Chrome, read the accessibility tree, as screen readers do. Snapshots of 0.7.4 in Aside and gstack browse showed what they missed.

- Each conversation in the list is a list item, and its subject links to it (`?view=…&open=…`). A row used to be one button labelled "Sender: Subject", which hid its date, preview and labels from Playwright snapshots, and gstack browse dropped every row: Playwright quotes a name containing ": " and gstack skips quoted lines. The whole row still opens the conversation, and Cmd or Ctrl-click on the subject opens it in a new tab.
- Views in the sidebar and the rail are links to their URL: folders, addresses, labels and saved searches. Addresses carry their whole address and unread count ("hello@example.com, 15 unread"). The sidebar shortens them, so "support@example" didn't say which domain.
- Text-only mail sits on the page instead of in the message frame, in the same serif. Some agents can't read inside a frame. The app writes that HTML from escaped text and sanitises it again. Mail that arrives as HTML stays in the sandboxed frame.
- The letterhead names its parts for agents and screen readers: From, to, and Received or Sent. Nothing changes on screen.
- The Reply bar was a clickable box with the Draft reply button inside it. They are two buttons side by side now.
- Agent chat is a log, and each turn says who said it: You or Agent.
- With a mouse, each row's Select is a checkbox an agent can see and tick without hovering. The rest of the row toolbar still appears on hover, and nothing on screen changes. The toolbar used to be left out of the page until hover, so an agent had to open a message to act on it.
- A choice of one is a radio group: the date and sort options, Theme and Remote images in settings, Reply mode and the model provider filter. Aside shows which item is checked or selected, but not which button is pressed, so it couldn't tell which option was on.
- The Filter button is named "Filter, 2 on" when filters are on. Its name used to be the badge's number.
- `tests/agent-readable.test.mjs` keeps it this way: no `role="button"`, no accessible names joined with ": ", rows and views as links, text-only mail on the page, chat turns labelled, radio groups for a choice of one, and a row's Select in the tree.

### Demo build

- `PLURAMAIL_DEMO=1 npm run build` makes a demo build. On its first API request it writes the sample inbox (about 470 messages, 62 attachments, 12 labels, 3 saved searches) into an empty database, with the newest message minutes old. A normal build carries none of it.
- A demo sends nothing and needs no sign-in. Send, reply, forward and scheduled send return 403. The PluraMail Agent, Draft, auto-draft and the MCP server are off, and their controls are hidden. Settings are read-only. Incoming mail is rejected. Cloudflare Access is skipped.
- Visitors can read, search, archive, delete, star, label and save drafts. The cron writes the sample inbox again every hour on the hour, over everything visitors changed.
- `GET /api/v1/config` returns `demo`.
- `npm run test:build` builds both ways and checks that only the demo build carries the sample inbox. CI runs it in place of `npm run build`.
- The dev server's sample inbox (`workers/lib/dev-seed/`) is new in this release; [Sample inbox](docs/development.md#sample-inbox) describes it.
- A demo allows two AI actions: search interpretation and Redraft on an agent's draft. Both run on one Workers AI model that the Workers Free plan allows (Llama 3.3 70B fast) and stop for the day after `DEMO_AI_DAILY` calls across all visitors (default 200, `0` for none), then return 429. Migration `0007_ai_budget.sql` adds the table that counts them.
- `SEED_PROFILE=alex` picks a second sample inbox: Alex Rivera, who runs a catalog API, plays in a band and keeps a code club's books. 100 messages in nine mailboxes on four domains: customers, the tools Partwell runs on, a late-night incident and its recovery, invoices, a payout, food orders, family, a fantasy league, gigs and a grant. Each sender has its own email design; vendors use their published logos and the invented companies original marks. Four openly licensed photos show inline; PDFs, CSVs, text files and JPEGs are real attachments. Links open an in-app page (`/api/v1/sample-link`) instead of leaving the app. [Alex profile](docs/demo-alex.md) covers the mailboxes, story, brands, files and sources.
- A seeded reply draft now opens under the message it answers.

D1 migration: `0007_ai_budget.sql`. `npm run deploy` applies it.

## 0.7.4

The reader.

- Every message is a page with one left edge, lined up with the subject, sender and Reply bar. Plain mail no longer floats indented on the reader background.
- Plain mail reads in a serif at 16px with lines capped at 66 characters, so the message reads as a letter and the app stays sans. Designed HTML mail keeps its own fonts on its white page.
- Text-only mail: blank-line runs collapse to one paragraph break, bare URLs and addresses are links, the signature under a `-- ` line is muted under a rule, and quoted replies (`>` lines and "On … wrote:") fold behind a toggle.
- A text body with an address in angle brackets ("<jane@example.com>") was shown as HTML. Only real tags count now.
- Images hidden is a row at the top of the message instead of a bar above it. A blocked image shows its alt text in a dashed box instead of the broken-image icon, and tracking pixels are dropped.
- The list header reads which addresses, then which folder: the address picker as its mark and a caret, then the folder with the same icon it has in the sidebar. The scope's icon used to sit beside the folder name as if they were one control. Click the folder name to jump to a sibling: the same list the sidebar shows under that address, or under All addresses with its labels. Switching address keeps the folder you are in.
- The message frame skips writing a document it already holds. Two writes in a row, as React makes in development, left plain mail blank in some Chromium browsers.
- In a small window the reader slid under the agent rail, so the agent rail's label sat on top of the toolbar and the sender's address was cut to "<". The reader now shrinks, its toolbar wraps and the sender line breaks.
- Who sent a message and when is now the page's letterhead: name and address over the receiving address on the left, the date over the time on the right, above a hairline. The initial square and the angle brackets are gone.
- Labels are no longer chips. In the reader they sit on a thin rail across the top of the message, right-aligned over the date; in the list they are tags beside the star, with the name on hover, so a labelled row is no taller than any other.
- Quoted earlier messages in HTML replies fold behind the `···` toggle, as in text-only mail. Opened, each one sits under a hairline with its sender and date instead of a grey block.
- Focused search lifts off the page: a soft shadow on both sides of the bar and its window.
- When the agent drafted more than once in one auto-draft run, every draft stayed in Drafts. The run now keeps its last draft and discards the earlier ones (#19).

No D1 migration.

## 0.7.3

The last fixes from the 0.7.0 review.

- Console > Overview showed at most 5 failed actions, and 0 when the failures were older than the newest 50 actions. It now shows the day's real count. `GET /api/v1/agents/overview` returns it as `failed`.
- Auto-draft: a draft saved from the model's text, without a `draft_reply` call, was missing from Console > Activity. It is now logged as `draft_reply`.
- Auto-draft: when the model called `draft_reply` more than once and newer mail superseded the run, only the last draft was discarded. Every draft from that run is discarded now.
- A redraft you ask for in the app was logged as the chat agent. It is now logged as you, with its own "You" filter in Console > Activity.
- The send routes (`POST /api/v1/mailboxes/:id/emails`, reply and forward) now return the attempt's state and provider ID with a 409, as 0.7.0 said they did.
- A failed idempotency key used again kept its first-use time, so it could be pruned hours later and a retry would send a second copy. Using it again now starts a new 7 days.
- Console: `?console=constructor` and other built-in property names opened an empty Console. Save checked the limits only after the address and prefs writes had started, so an invalid limit left the other changes saved. It now checks first and saves nothing. The Drafting tab's Sending line shows the saved limits, not unsaved edits.

No D1 migration.

## 0.7.2

More fixes from the 0.7.0 review.

- A send whose caller died before delivery started left its key pending for 7 days, so every retry of that draft got 409. A pending attempt older than 5 minutes can now be claimed again.
- A send error marked the attempt failed even when the message may have gone out (a timeout or an internal error), so a scheduled send could be delivered twice. Now only an error code that proves the mail service refused the message marks it failed and gives back the send limit slot. Any other error leaves the attempt in sending with the error saved, a deferred send keeps its Sent copy, and the cron stops retrying that scheduled send.
- Auto-draft: when the worker running a draft died, the queue's redelivery acked the message and the run stayed running with no draft. The redelivery now retries once the run can be taken over, and the hourly cron marks failed any run still running after an hour.
- Redraft: typing in the body while a redraft ran lost the edit and left a stray draft. The body is now read-only and autosave waits until the redraft returns. Keys typed meanwhile stay in the composer instead of triggering mail shortcuts.

No D1 migration.

## 0.7.1

Fixes from a review of 0.7.0.

- A send from the app or the API that failed at the mail service was marked sent. A retry with the same idempotency key returned the first send and nothing went out. Now the attempt stays in sending until delivery finishes. A failed delivery marks the key failed, gives back the send limit slot and moves the message from Sent to Drafts.
- Console > Limits: clearing a field saved 0, which stopped agent sending or auto-drafting. A limit must now be a whole number. Save sends only the limits you changed, the fields wait for the saved values to load, and `PUT /api/v1/agent-limits` returns an error instead of saving over defaults when it can't read the saved file.
- Auto-draft: when the model call after `draft_reply` failed, the queue retried and drafted the same reply again. A run with a saved draft now counts as drafted.

No D1 migration.

## 0.7.0

Agent reliability.

- **Send attempts.** An idempotency key now tracks its send through pending, sending, sent or failed. The mail service's message ID is saved before the Sent copy. Reusing a key for a different message returns 409. A send that reached the mail service but wasn't stored returns 409 with its state and provider ID instead of sending again. A key whose send failed before delivery can be used again.
- **Console.** The sidebar's Settings and MCP buttons are now one Console button. The Agents group has Overview, Activity, Limits, Drafting (the old Agent tab), Model & key, and Connections (the old MCP dialog); the Settings group has the rest. Links use `?console=<tab>`; `?settings=` links still open the matching tab.
- **Send limits.** Console > Limits sets agent sends a day per address (default 20, 0 stops agent sending), recipients per agent message (default 10, at most 50) and auto-drafts per sender a day (default 3). Saved in R2 at `config/agent-limits.json`; `GET` and `PUT /api/v1/agent-limits`. No agent or MCP tool can change them. People keep the fixed 20 an hour, 100 a day and 50 recipients. These now count sends, not Sent mail, and the check and count are atomic. A send that never reached the mail service doesn't count. Console > Overview (`GET /api/v1/agents/overview`) shows each address's sends against the limits.
- **Auto-draft runs.** Each new message gets a run row. Newer mail in the thread supersedes an unfinished run, and a draft from a superseded run is discarded. Each sender gets 3 auto-drafts per address a day by default. An optional `DRAFT_QUEUE` queue retries a failed draft three times with backoff and then dead-letters it; see [Auto-draft queue](docs/setup.md#auto-draft-queue). Without the queue each draft is tried once, as before.
- **Activity log.** Every tool call by the chat agent, auto-draft and MCP clients is logged with the address, target, a summary and the MCP client's name. Console > Activity lists and filters it; prefs `activityDays` keeps 90 (default), 120 or 180 days, pruned hourly by the cron. `GET /api/v1/activity`, `GET /api/v1/auto-draft/runs`.
- **Redraft.** An agent draft shows who wrote it and takes a one-off instruction ("shorter") that rewrites it. Instructions are kept with the draft. `POST /api/v1/mailboxes/:id/drafts/:draftId/redraft`.
- A deploy config that supplies its own `queues` can bind `DRAFT_QUEUE` with `max_retries: 3`; nothing else in the config changes.

D1 migration: `0006_agent_reliability.sql`. `npm run deploy` applies it. Deploy this version only after the migration: sends write the new `send_budget` table.

## 0.6.0

Durable Object mail storage removed.

- **Breaking:** mail is stored only in D1. A deployment still on `"STORAGE": "do"` must move to D1 on 0.5.x first ([Moving to D1 in the v0.5.1 docs](https://github.com/johnnywon/pluramail/blob/v0.5.1/docs/setup.md#moving-to-d1)). 0.6 adds the `v5` Durable Object migration with `deleted_classes: ["MailboxDO", "MailIndexDO"]`, which deletes the mail still in them when it deploys.
- A deploy config that supplies its own `migrations` must append `{ "tag": "v5", "deleted_classes": ["MailboxDO", "MailIndexDO"] }` and drop the `MAILBOX` and `MAIL_INDEX` bindings.
- Removed: the `STORAGE` and `INDEX_SYNC_ENABLED` vars, the `MAILBOX` and `MAIL_INDEX` bindings, the copy to D1 with its cron step and `/api/v1/admin/migrate-to-d1` routes, and `/api/v1/index/status` and `/api/v1/index/rebuild`. The Storage tab's counts come from `/api/v1/storage/status`.
- The R2 `mailboxes/*.json` records are no longer read; D1's `mailboxes` table has held mailbox settings since 0.5. They can be deleted from the bucket.
- Removed the `drizzle-orm` dependency.

D1 migration: `0005_drop_copy_job.sql`. `npm run deploy` applies it.

## 0.5.1

- `npm run deploy` applies D1 migrations with the deployment's own Wrangler config. In 0.5.0 it read the repo's example `wrangler.jsonc`, so a deployment with its own config stopped at the migration step and nothing deployed. With more than one Cloudflare account, set `CLOUDFLARE_ACCOUNT_ID`; `wrangler d1` does not read `account_id` from the config.

No D1 migration.

## 0.5.0

D1 by default.

- A new deployment stores mail in D1. `wrangler.jsonc` binds a `DB` database and sets `"STORAGE": "d1"`. The Deploy to Cloudflare button creates the database; by hand, run `npx wrangler d1 create <name>` and copy the id into `d1_databases`.
- **Upgrading a deployment that still stores mail in Durable Objects:** set `"STORAGE": "do"` in `vars` before you deploy 0.5.0, or the app opens on an empty D1 database. Nothing is lost; setting `do` and deploying brings the mail back. Then move with [Moving to D1](https://github.com/johnnywon/pluramail/blob/v0.5.1/docs/setup.md#moving-to-d1). The Durable Object store is removed in 0.6.
- `npm run deploy` applies D1 migrations before it deploys.
- Each address has its own agent prompt. Settings > Agent edits one address at a time, with "Use for every address" to copy one. Draft reply and auto-draft use their address's prompt; the chat panel uses the prompt of the address whose mail is open, or the default when nothing is open.
- The deploy button's form asks for `EMAIL_ADDRESSES` and explains the Access placeholders. `EMAIL_ADDRESSES` can be a list or a comma-separated string.
- Removed: the pre-0.3.0 agent model file shape (pick the model again in Settings > Model & key), the `/mailbox/...` and `/settings` redirects, and the cron that filled `has_link` on older D1 mail. A D1 deployment that applied `0002_has_link.sql` before 0.5.0 has had a minute per 200 messages to fill it; check with `SELECT count(*) FROM messages WHERE has_link IS NULL`.
- Removed dead code: the `MAIL_UI` leftovers, `formatEmailDate`, and the phase 0 D1 bench.

No D1 migration.

## 0.4.2

- Incoming messages with a duplicate Message-ID are skipped, and failed saves clean up attachment files.
- Mail to an address this deployment doesn't handle now bounces back to the sender instead of being dropped silently.
- Outbound subjects and threading headers reject line breaks.
- Responses add frame protections and safer attachment headers; `/mcp` refuses foreign origins.
- Cloudflare Access reuses its JWKS, requires RS256 and an HTTPS `TEAM_DOMAIN`.
- Mailbox settings are validated before they are saved.

No D1 migration.

## 0.4.1

Agent safety.

- Auto-draft gets three tools: `get_email`, `get_thread` and `draft_reply`. Before, it had the chat agent's full set, including label, move, discard and shortcut tools and `draft_email` to any address. `get_thread` reads only the new email's thread, `get_email` only emails in it, and `draft_reply` answers the new email with the recipient fixed to its Reply-To, else its sender. The chat agent keeps its tools.
- The agent panel no longer loads images from markdown in the agent's replies. An image shows as a link that opens when clicked.
- Inbound mail joins a thread only when its In-Reply-To or References names a message stored in that mailbox. Before, the first References entry became the thread id as sent. With no such header, a message joins by subject only when the subject starts with a reply prefix such as `Re:`, the thread had mail in the last two days, and the sender sent mail in it or was written to from the mailbox. Otherwise it starts its own thread. Both stores match the same way.
- The prompt injection check covers everything auto-draft shows the model: sender, display name, recipient, subject and the full body of every message in the thread, in overlapping chunks. Before, it read the body and 500 characters of each earlier message. `get_email` and `get_thread` return that scanned copy. A detected injection, an unclear answer, a failed check, a thread too long to check or a failed read skips the draft; the reason is logged and shown in the agent panel.

No D1 migration.

## 0.4.0

- The logo is gone from the sidebar, the empty reader and error pages. The app icon stays. The link preview card shows the mark without a name.
- README screenshots reshot, with light versions for readers on a light theme.

No D1 migration.

## 0.3.0

- Settings > Model & key is rewritten. The agent runs on Cloudflare (Workers AI) in your own account, or on OpenRouter held to zero data retention; nothing else can be connected. A notice at the top of the tab says why: the agent reads your mail, so a model that keeps or trains on it is a security risk. Each provider's line says what its own policy states and links to it; Cloudflare's says it makes no zero retention promise. A search-interpret log line no longer records the model's reply text. Catalog reads time out after 10 s and show an error instead of leaving the tab loading.
- OpenRouter lists only models with a zero retention endpoint, priced at the cheapest one, and every request sends `provider: { zdr: true, data_collection: "deny" }`, so a model with no such endpoint fails instead of falling back. Free models are left out of every list and refused as typed ids. Cloudflare lists only priced text models that aren't partner models; a typed id outside that list is refused on save and test. Anthropic, OpenAI, Google and xAI models are filters on OpenRouter.
- The tab shows the agent model, a line on what happens to prompts there, and the two providers with their status and key. Change model opens a picker: a search, four suggested models as cards, one per need (Recommended: Kimi K2.6 and Cheapest: GLM 5.3 Flash on Cloudflare; Balanced: Claude Sonnet 5.5 and Best quality: Claude Opus 5.5 on OpenRouter), and rows to browse each provider and maker. Rows show name, provider and maker, context and price per million tokens in aligned columns, sorted by suggestion, price or context.
- A model id not in the lists can be typed in the search and used if its provider allows it: on Cloudflare a priced model that isn't a partner model, on OpenRouter a paid model with a zero retention endpoint. A `:free` id is refused in any case, and a free model saved by an older version is dropped so the recommended model runs. Models a catalog marks as unable to call tools are tagged, not hidden.
- The prompt injection check runs on `@cf/meta/llama-3.1-8b-instruct-fp8`. Cloudflare deprecated `llama-3.1-8b-instruct-fast`, which it used. An empty or unclear answer from the check now skips auto-draft, the same as an error; before, it let the email through.
- `config/agent-model.json` now holds `{ selected, keys }`. The older OpenRouter-only file is read as before. `GET /api/v1/agent-model/catalog` replaces `/models` and `/workers-ai-models`; `PUT /api/v1/agent-model` takes `{ selected, keys }`.
- The README roadmap is reordered: a faster start now (one-command setup, mail import, starting on Workers Free), agent control next (scoped access, an approval queue with an activity log, rules in plain words), then shared inboxes, Queue events, search by meaning and offline. Model choice moves to Shipped.
- The README is half as long. It states the version and where the project stands up top, and a Before you deploy section lists what you can rely on and what to know first: Email Sending is in public beta, agents can send without an approval step, and there's no export, IMAP or SMTP yet. Version and CI badges. The mail flow diagrams and developer notes move to `docs/architecture.md`, and the full roadmap to `docs/roadmap.md`. The approval queue and scoped agent access move up to Now.

No D1 migration.

## 0.2.0

- Keyboard shortcuts are one system. `shared/shortcuts.ts` defines every shortcut once; the mail view's key handler, tooltips, key hints and the new lists read it, so a hint can't name a key that does nothing.
- Press `?` for a map of the mail view drawn like the real one: the sidebar with its Go to keys and `⌘B` on its collapse button, J and K above and below the open conversation, each toolbar key under its button's icon, `⌘J` on the agent's collapse button. Keys pressed all day are drawn larger. The map is built from the registry, so a new shortcut places itself.
- Settings has a Shortcuts tab listing every shortcut by group, where each mail-view shortcut can be rebound: click its keys, press the new one. A key already in use moves over. Rebound keys are saved with the other prefs in `config/prefs.json` (`shortcuts`).
- Report spam: `!`, a button after Trash in the reader toolbar, and one in the bulk bar. It moves the conversation to Spam, with Undo.
- A keyboard button at the foot of the sidebar opens the map. In Settings > Shortcuts, × turns a shortcut off. Keys the browser keeps (`⌘T`, `⌘W`, `⌘R`, copy and paste, zoom, tab switching) can't be bound.
- When shortcuts change somewhere else (the agent, MCP, another browser), a toast says what changed ("Archive is now Y") with Undo, once per browser.
- The agent and MCP can rebind shortcuts: `list_shortcuts`, `set_shortcut` (keys as text such as `"y"`, `"shift+y"`, `"cmd+k"`) and `reset_shortcuts`. The app refreshes its keys when the agent's turn ends.
- Adding a shortcut is one registry entry plus its action; `shared/shortcuts.ts` and `CLAUDE.md` say how.
- Shortcuts follow Gmail: `#` trash (and Outlook's `Delete`), `!` report spam, `s` star, `⇧I` mark read, `⇧U` mark unread, `l` label, `u` back, and `g` then `s`, `d`, `t` or `a` for Starred, Drafts, Sent and All mail. `` ` `` steps through Inbox, Unread, Starred and Drafts, and `~` steps back, as Gmail does with inbox sections. `⌘B` toggles the sidebar, `⌘J` the agent panel and `\` both.
- Shortcuts work while focus is inside a message, including `Shift+x`, `⌘J` and `?`. The message frame used to pass up a fixed list of keys, some with no shortcut behind them.
- Off a Mac, hints show `Ctrl` instead of `⌘`.
- The empty list's "Clear search" button no longer shows the `G I` hint, which goes to the Inbox.
- Settings > General's "Show keyboard shortcuts" is now "Show key hints".

No D1 migration.

## 0.1.3

- Settings holds everything: the Labels page and the Mail index page are now the Labels and Storage tabs of the Settings dialog. `/settings` and `/settings/index` redirect there. The open tab is in the URL (`?settings=labels`), and Back closes the dialog. Storage shows per-address counts on D1 and the index comparison and Rebuild on Durable Objects.
- Settings > General (theme, key hints, mark as read, remote images, reply from) is saved to the deployment in R2 (`config/prefs.json`) and follows you to every browser. The first browser to load this version uploads its own settings. `GET` and `PUT /api/v1/prefs`.
- Dividers are straight: anything with a border on one side only (rows, headers, footers, table cells, the side columns) has square corners. A design test keeps it that way.
- Switches are pills: a 36 by 20 track with a 14px knob inset 3px.
- Settings > Model & key lists Workers AI models with context size and price per million tokens, read live from Cloudflare's catalog (`env.AI.models()`) and limited to models that can call tools. Search and sort (cheapest, most context) the list; five are suggested. Each row has a maker tag, a context bar and a price chip coloured by cost. The pick is saved as `workersAiModel` in `config/agent-model.json`; leaving it on the recommended model follows future defaults. `GET /api/v1/agent-model/workers-ai-models`.
- The default agent model is `@cf/moonshotai/kimi-k2.6`. Cloudflare no longer lists `kimi-k2.5`. A saved model that Cloudflare stops listing falls back to the default.
- A signature with text no longer shows the "No signature" placeholder over it.
- The brushed-metal settings styles, `SettingsHeader`, `DeckBrand` and the Oxanium font are gone.

No D1 migration.

## 0.1.2

- Unknown paths answer HTTP 404 instead of 200.
- Error pages (404, crashes, Access errors in a browser) use the mail view's look and theme instead of the settings shell, Kumo's empty state or plain text. API clients still get plain text.

No D1 migration.

## 0.1.1

- CI: tests, typecheck and build run on every pull request and every push to `main`.
- `package.json` carries the version.

## 0.1.0

First tagged version, at `465b00b`. One list for every address, labels and bulk actions with undo, scheduled send, the in-app agent, the MCP server, one search language with ranked results, D1 storage with attachment search, Move to Inbox and Empty Trash.

D1 migrations: `0001` to `0004`.
