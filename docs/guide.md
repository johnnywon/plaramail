# Guide

How the app works day to day. Back to the [README](../README.md).

## Features

- **One list for every address.** Filter by address, domain, sender, label, date and status. Each domain gets its own colour and shape, so you can tell at a glance which address a message reached.
- **Full mail client.** Rich-text compose, reply, reply all, forward, drafts, attachments, folders, stars, search and message source view.
- **One composer.** New mail, replies and forwards share the same layout. Replies and forwards quote the original as HTML, with its styles and scripts removed.
- **Signatures.** One per address, set in Console > Settings > Signatures. None is added unless you turn on "Add by default"; the signature button in the composer adds or removes it on any message.
- **Scheduled send.** Pick tomorrow morning, Monday morning or any future time. The message waits in Drafts until it goes out.
- **Labels and bulk actions.** Select many conversations to archive, delete, mark read, star, label or move. Undo is available after each action. Rename, recolour and delete labels in Console > Settings > Labels, or from Manage labels in the sidebar.
- **Keyboard shortcuts** for navigation and actions. Press `?` for a map of where each key acts. Rebind them in Console > Settings > Shortcuts, or ask the agent ("make archive Y").
- **Per-address isolation.** Every address has its own folders, threads, settings and prompt. Every query on one address filters on it.
- **AI agent.** A side panel that can read, search, label, draft and send on Workers AI, or on OpenRouter with your key. It searches and labels across every address at once (`search_all_mail`, `label_matching`, up to 500 conversations per call). "Draft reply" in either composer (or "Draft" in a new message) asks it for a first draft. Labels the agent has applied are marked with a sparkle. It sends a draft with `send_draft` when you ask it to. Nothing drafts every new email. New mail is drafted only by an agent you set up for it in Console > Your agents (its addresses and rules decide which mail it takes), or by the PluraMail Agent if you choose that for mail no agent takes. Mailing lists, bulk mail, auto-replies and no-reply senders are always skipped.
- **MCP server** for connecting outside agents, including `send_draft`, and `list_shortcuts`, `set_shortcut` and `reset_shortcuts` for the keyboard shortcuts.
- **Sends go out once.** Each send can carry an `Idempotency-Key` header. A retry with the same key returns the first send instead of sending again. The composer sets one per message, and every way of sending a saved draft uses `draft:<id>`, so a draft is sent once whether you, the agent or the schedule sends it. The same key with a different message is refused, and a send that reached the mail service but wasn't saved to Sent reports that instead of sending a second copy.
- **Console.** The Console button at the foot of the sidebar opens one place for agents and settings. Its Agents group has Overview (the last day's sends against each limit, auto-draft runs and failed actions), Activity, Limits, Drafting (prompt per address), Model & key, and Connections (the MCP server). Its Settings group has General, Addresses, Signatures, Labels, Shortcuts and Storage. Each tab has its own link, such as `?console=limits`.
- **Activity log.** Console > Activity lists every read, draft, send, delete and label change by the agent, auto-draft and MCP clients, with the MCP client's name, and each redraft you ask for. Entries are kept 90, 120 or 180 days.
- **Redraft.** Type an instruction such as "shorter" under an agent draft and Redraft rewrites it.
- **Cloudflare Access required.** Outside local development the Worker refuses every request until Access is configured.

## The postal view

The mail view is a three-column workspace: mailboxes on the left, the list and reader in the middle, the agent on the right. Both side columns collapse to rails. Below 1300px the agent overlays the reader; at phone widths the app shows one pane at a time.

Settings are saved to your deployment, so they follow you to any browser. General (theme, key hints, mark-as-read, remote images and reply-from-receiving-address) and rebound shortcuts are in R2 at `config/prefs.json`, beside the agent model. Each browser keeps a copy so the theme is right before the page finishes loading; the deployment's copy wins. Choose System for the theme to let each device follow its own light or dark setting. Display names, signatures and the agent prompt are stored with each mailbox, and labels with the mail. Each address has its own agent prompt: Draft reply and auto-draft use it, and the chat panel uses the prompt of the address whose mail is open, or the default when nothing is open. Only the open or collapsed side columns and recent searches stay in each browser.

Keyboard shortcuts follow Gmail's, with Outlook's Delete for trash. `j`/`k` move, `e` archive, `#` or `Delete` trash, `!` report spam, `s` star, `⇧I` mark read, `⇧U` mark unread, `l` label, `x` select (`⇧X` a range), `r` reply, `a` reply all, `f` forward, `c` new email, `z` undo, `/` or `⌘K` search, `g` then `i`, `s`, `d`, `t` or `a` for Inbox, Starred, Drafts, Sent or All mail, `` ` `` to step through Inbox, Unread, Starred and Drafts (`~` steps back, and keeps the address you are viewing), `u` or `Esc` back, `⌘↵` send, `⌘B` sidebar, `⌘J` agent, `\` both side panels, `?` the map. They work while focus is in a message too. Every shortcut is defined once in [`shared/shortcuts.ts`](../shared/shortcuts.ts); the mail view's handler, tooltips, key hints and the `?` list all read it. `?` opens a map of the mail view with each key drawn where it acts. Console > Settings > Shortcuts rebinds the mail-view keys: click a shortcut's keys and press the new one. The agent and MCP clients can do the same with `list_shortcuts`, `set_shortcut` (keys as text: `"y"`, `"shift+y"`, `"cmd+k"`, `"down"`) and `reset_shortcuts`; the app picks up the change when the agent's turn ends, or within a minute. A key already in use moves to the shortcut you are changing, and the × beside a shortcut turns it off. Keys the browser keeps for itself (`⌘T`, `⌘W`, `⌘R`, copy and paste, zoom, tab switching) are refused. When keys change somewhere else, by the agent, an MCP client or another browser, the app says what changed in a toast with Undo. `Esc`, `u`, `g`, `?`, `Tab`, `Enter` and Space are kept for the app, and on Windows and Linux `⌘` is `Ctrl`.

## Search

The search bar, the agent's `search_all_mail` and `search_emails`, and the MCP tools share one search language ([`shared/search-query.ts`](../shared/search-query.ts)). Words match any field by prefix. `"wire transfer"` matches a phrase, `-word` or `-from:example.com` excludes, and `a OR b` matches either.

| Operator | Matches |
|---|---|
| `from:` `to:` | A name, address or domain. In the search bar, `to:` with one of your addresses picks that address. |
| `cc:` | A copied recipient |
| `subject:` `filename:` | Words in the subject or an attachment name |
| `label:` | A label, by name |
| `in:` | `inbox`, `unread`, `starred`, `drafts`, `sent`, `archive`, `spam`, `trash`, `all` (everything but spam and trash), `anywhere`, or a folder name |
| `is:` | `unread`, `read`, `starred`, `scheduled`, `replied` |
| `has:` | `attachment`, `pdf`, `image`, `draft`, `unsubscribe` |
| `before:` `after:` | A date (`2026-01-31`, your local day) or an age (`30d`, `3w`, `2m`, `1y`) |
| `newer:` `older:` | An age |
| `larger:` `smaller:` | A size including attachments: `500k`, `5mb` |
| `list:` | A mailing list id |

Unknown operators are searched as plain words. An operator with a value that doesn't parse, such as `before:soon`, is left out and named in the search bar.

A search with words lists the best match first: subject matches count most, body text least, and near-ties go to newer mail. Each row shows the text around the matched words and how many messages in the conversation matched. `sort:date`, or Newest above the list, puts newest first. Over 20,000 matching messages the list is newest first, since ranking that many takes too long; `sort:relevance` ranks it anyway. A word of three or more letters that matches no word is searched as part of a word in subjects, addresses, attachment names and attachment text, so `7731` finds `XK7731Q`. When nothing matches, the window suggests a spelling.

With `ATTACHMENT_SEARCH` set to `true`, the text of PDF, Word, Excel, OpenDocument, text and CSV attachments up to 10 MB is searched with the body. The cron converts five files a minute, newest first, with Workers AI `toMarkdown` (text files are read directly) and keeps up to 64 KB of text per file. New mail is searchable as soon as it arrives and its attachments a minute or two later. Mail stored before the setting was on is converted the same way, newest first. When the match is in a file, the row shows the file's name and the text around the match. Turning the setting off stops new conversions; text already converted stays searchable.

The window under the search box shows recent searches (kept in this browser), the people you get the most mail from, filters and addresses. While you type it shows the top six results and filters that narrow them, and with the cursor in an operator it completes the value. `↑` `↓` move, `Tab` completes, `↵` opens the highlighted row or the first result, `⌘↵` runs the search without opening anything, and `Esc` closes the window, then clears the box. `? Operators` in its footer lists every operator.

When the text reads like a request ("unread newsletters from this week"), the window offers Turn into a search. That sends the text, today's date, your label names and your addresses, never mail, to the model once, and puts the search it makes in the box with a one-line explanation and Undo: `is:unread has:unsubscribe after:7d`. Nothing runs that you can't see. On Workers AI it uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, because the default agent model took 10 to 27 seconds; with a model from another provider chosen in Settings it uses that model. If the call fails, the words are searched as typed. Ask the agent about it opens the agent panel with the text instead.

`⌘S` or Save search in the window saves the search in the box. Saved searches appear in the window and the sidebar with the number of conversations each matches in All mail. The window's server side is `GET /api/v1/search/suggest` and `/api/v1/saved-searches`.

## Compose

**Recipients.** Typing in To, Cc or Bcc suggests people you wrote to and people who wrote to you, by name or address, the people you write to first. Arrow keys move through the list and Enter or Tab picks one. Spam, Trash and your own addresses are left out. The server side is `GET /api/v1/contacts?q=`.

**Attachments.** Attach files with the paperclip, by pasting them, or by dropping them on the compose window. Email Sending takes messages up to 5 MiB, counted with the files base64 encoded, so about 3.7 MB of files fit. The window refuses files that would go over, and the Worker refuses a larger message before it is sent.

**Undo send.** Send holds the message for 5 seconds, with Undo in the toast and on the undo key. Undo reopens the message. The draft is deleted only once the message is sent, so a tab closed during the hold leaves it in Drafts, and the browser asks before the tab closes. The pop-out compose window sends at once.

**Unread count.** The tab title and icon show how many conversations are unread.

## Scheduled send

Choose a time from the arrow next to Send in the compose window. The message is saved to Drafts with a "Scheduled" badge, and a one-minute cron sends it through the normal sending path, up to a minute after its time. Cancel removes the schedule and keeps the draft. Editing or deleting the draft before the send time cancels it. A send that fails is retried every 15 minutes, up to three attempts; after that the draft stays in Drafts marked "Send failed". Attachments count toward a 1.5 MB limit per scheduled message.

## Agent drafts

**Redraft.** A draft an agent wrote shows a line above the format bar: who wrote it and how often it was redrafted. Type an instruction ("shorter", "decline politely") and choose Redraft. The model sees the draft, the address's prompt, and the email it answers, after the same prompt-injection check auto-draft runs. It has no tools; its only output replaces the draft's text, and the quote stays. A draft with attachments can't be redrafted.

**Auto-draft runs.** Each new message gets one run. New mail in the same thread supersedes a run that hasn't finished, and a draft from a superseded run is discarded. A run keeps one draft: if the model drafts twice, the earlier draft is discarded. Each sender gets 3 auto-drafts a day per address by default (Console > Limits); later mail from them is stored but not drafted. With the optional queue (see [setup](setup.md#auto-draft-queue)) a failed draft is retried three times, 30, 60 and 120 seconds apart, then moved to a dead-letter queue. Without it, each draft is tried once. Console > Activity lists recent runs with their state and any reason.

**Send limits.** Every address sends up to 20 messages an hour and 100 a day, with up to 50 recipients per message. These are fixed. Inside them, Console > Limits sets what agents may do on their own: sends a day per address by the agent and MCP clients together (default 20; 0 stops agent sending), recipients per agent message (default 10), and auto-drafts per sender a day (default 3; 0 stops auto-drafting). The limits are saved in R2 at `config/agent-limits.json`, and no agent or MCP tool can change them. The check and the count are one database statement, so parallel sends can't overshoot.

## Agent model

The agent reads your mail, so a model that keeps or trains on it is a risk. Two rules hold: no provider that trains on prompts, and no free models. Zero retention is a guide: each model shows whether it has it, and you choose.

| Provider | Key | What happens to prompts |
|---|---|---|
| Cloudflare (Workers AI) | None; bills your Cloudflare account | Not used to train models or improve services ([data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)). No zero retention promise; the mailbox is already stored on Cloudflare, so no new party sees it. |
| OpenRouter | `sk-or-…` | Providers that train on prompts are refused. Zero retention on models that offer it; OpenRouter doesn't log prompts unless you opt in ([ZDR](https://openrouter.ai/docs/guides/features/zdr)) |

Cloudflare's list is filtered too: it holds only text models with a listed price above zero that the catalog doesn't mark as `partner` (models served under a third party's terms; today those are image and speech models). Unpriced models, including Cloudflare's own preview ones, are left out. A typed `@cf/…` id outside that list is refused when you save or test it. The `terms` link some Cloudflare models carry is the license for the model weights, not a data policy; the weights don't learn from what you send.

Nothing else can be connected. Anthropic, OpenAI, xAI and Google models are reached through OpenRouter, not with their own keys. Cloudflare's catalog API lists only Cloudflare-hosted models, so Claude runs through OpenRouter. Free models are never offered or accepted: free endpoints can keep and train on prompts.

OpenRouter's list holds every paid model from [`/models`](https://openrouter.ai/api/v1/models). Models in [`/endpoints/zdr`](https://openrouter.ai/api/v1/endpoints/zdr) are marked Zero retention and priced at the cheapest such endpoint, and their requests carry `provider: { zdr: true, data_collection: "deny" }`, so they never fall back to an endpoint that keeps data. Other models carry `data_collection: "deny"` only and may be kept by the endpoint that serves them. Keys saved for a direct provider by an earlier version are deleted from R2 the next time the config is read.

These are the providers' own policies; nothing here can audit them. What the code does guarantee: requests go only to these two providers, every OpenRouter request carries `data_collection: "deny"`, and a model marked Zero retention also carries `zdr: true` (both tested in `tests/agent-model.test.mjs`). When OpenRouter's lists can't be read, requests ask for zero retention and fail without it. OpenRouter counts in-memory prompt caching as not retaining, and marks any provider without a clear policy as retaining. For a second lock, turn on zero data retention in your OpenRouter account's privacy settings; the per-request flag can add enforcement but never removes the account's.

The agent runs on Workers AI (`@cf/moonshotai/kimi-k2.6`) until you pick something else in Console > Model & key. The picker searches both lists, filters by provider or by maker (Anthropic, OpenAI, Google and xAI on OpenRouter) and sorts by price or context. Prices are per million input and output tokens. Models a catalog marks as unable to call tools carry a "No tools" tag; you can still pick them, but the agent reads, labels and drafts through tools.

Type any paid model id in the search and choose "Use": `@cf/…` goes to Cloudflare, `maker/model` to OpenRouter. Test sends one short prompt to the picked model before you save.

The four suggested models, one per need (Recommended, Cheapest, Balanced, Best quality), are in [`shared/models.ts`](../shared/models.ts). The two that need a key are Claude Sonnet 5.5 and Claude Opus 5.5 on OpenRouter, so one OpenRouter key covers both. Until you pick a model the agent follows the recommended one, so a new default reaches you with an update. A picked model whose key you remove falls back to the recommended one, and so does a Workers AI model Cloudflare stops listing. The chat panel, Draft reply, auto-draft and Turn into a search use the picked model; the prompt-injection check and the draft cleanup on incoming mail stay on Workers AI.

Keys and the pick are stored in R2 at `config/agent-model.json`, which no route serves. The API returns only each key's last four characters. Anyone who can open the app can replace or remove them, so keep the app behind Access. `GET /api/v1/agent-model/catalog` returns both lists; `PUT /api/v1/agent-model` takes `{ selected, keys }`.

## Stack

- **Frontend:** React 19, React Router v7 (server rendered), Tailwind CSS, TanStack Query, Zustand, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, D1, Durable Objects (agent and MCP sessions), R2, Email Routing, Email Sending
- **Agent:** Cloudflare Agents SDK, AI SDK v6, Workers AI or OpenRouter
- **Auth:** Cloudflare Access JWT validation
