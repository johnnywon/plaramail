# Console 0.9

Built in 0.9.0, apart from Test on past mail and Send, which arrive in 0.10. WON-231 and WON-209.

## In one line

Each agent does one job on the addresses you choose. It starts in Watch, moves to Draft, then to Send once you trust it.

## Pages

The console replaces the mail with its own rail, opened at `?console=<page>`.

| Page | What's on it |
|---|---|
| Overview | The last 24 hours: agent actions, sends, auto-drafts, failures, each agent's count today, sends per address |
| Your agents | Every agent: name, job, addresses, mode, in the order they take mail. The PlaraMail Agent is the built-in one. |
| Draft review | Drafts waiting for you, as mail rows |
| Approvals | Sends and bulk changes held for approval, each with Approve and Drop, the latest decided, and each agent's and MCP client's Hold for approval switch |
| Activity log | Every action by an agent, an MCP client or you, kept 90, 120 or 180 days |
| AI models | The agent model and its facts, and Cloudflare and OpenRouter side by side: training, retention, models, key |
| MCP | The server URL, connect steps per client, connected apps (OAuth grants, read or read and send) with Revoke |
| Addresses, Signatures, Labels, Preferences, Keyboard shortcuts, Mail storage | The 0.8 settings tabs |

## An agent

- **Job**: one sentence, in your words.
- **Addresses**: one, several, or all.
- **Mode**: Watch (shows what it would do), Draft (writes drafts for you), Send (replies on its own, up to a daily limit). Send is off in 0.9 and arrives in 0.10.
- **Instructions** and an **example reply**.
- One column: Trust, Test (run on past mail; nothing is sent), Activity, How it works.

New agents start in Watch.

## Rules

- An agent replies only to the sender of the message it took.
- Every reply passes the safety check first.
- Each agent has a daily limit (25 by default) and a limit of two replies a day to one sender.
- When two agents want the same message, the one higher in the list takes it.

## From 0.7

- Playbooks were cut before 0.7 shipped, so there is nothing to migrate. 0008 adds agents and `draft_notes.agent`.
- Auto-draft becomes the PlaraMail Agent's fallback for mail no agent takes.
- Runs, draft notes, redraft, logs, safety checks and send limits stay as built.

## First agents to ship

Decline pitches, ask for missing details, acknowledge new senders, answer FAQs.

## Releases

- 0.9: console, agents in Watch and Draft, Draft review, MCP page, MCP sign-in with OAuth 2.1 and a separate send grant.
- 0.9.6: action agents.
- 0.9.7: Test on past mail, the approval queue, MCP grants limited to chosen addresses.
- 0.10: the workbench (setup beside what the agent does), Test on past mail, promotion evidence, then Send.

## Action agents (0.9.6, WON-453)

An agent can do something to mail instead of replying: "favorite emails from higgsfield", "label invoices", "archive newsletters". In 0.9 an agent can only write a reply, so a job like that matches mail and does nothing.

- **Does.** Each agent has a Does field: Reply, Star, Label (one label, picked when the agent is set up), Archive, or Mark read. Reply is the 0.9 behaviour. An agent does one of these, never several.
- **Rules-only fast path.** An action agent whose rules say exactly which mail it takes runs without a model: when the rules pass, the action happens. No model call, no cost, no delay. The setup offers a rule from the job ("from higgsfield" suggests From domain). An action agent with no rules asks the model only whether the job fits, and gets no reply tools.
- **Watch, then On.** The ladder for action agents has two steps. Watch logs what it would do ("Would star"). On does it. Draft and Send stay for reply agents. The move to On uses the same gate as Watch to Draft.
- **Undo from the Activity log.** Every action shows in the Activity log with Undo: unstar, remove the label, move back to the inbox, mark unread. Undo is offered for 30 days.
- **No competition with reply agents.** Every action agent whose rules and job fit acts. One reply agent at most replies, chosen by list order as in 0.9. Starring a message never stops it getting a reply.
- **Limits.** An action agent has a daily limit (100 by default), so a loose rule can't archive a whole inbox in one run.
- **Tools.** The drafting run gets one tool per action (`star_email`, `label_email`, `archive_email`, `mark_read`) only for an agent whose Does field names it. A message is acted on once per agent; a second run on the same message does nothing.

As built: `workers/lib/agent-actions.ts`, migration `0013_action_agents.sql`. Star, Label and Archive act on the conversation, as the app's own buttons do; Mark read acts on the new message. Undo is `POST /api/v1/agent-actions/:id/undo`. A rule-only action runs before the injection scan, since no model reads the mail. An action agent with no rules waits for the scan like a reply. Changing an agent's Does starts it again in Watch.

## Test on past mail (0.9.7, WON-530)

An agent's Test runs it on mail it already has, as if each message had just arrived, and lists for each one whether it took the message and the reply it would have written.

- **Which mail.** The latest 25 received messages for the agent's addresses by default. A search in the mail search language narrows them, and a run takes 50 messages at most. Sent mail and drafts are left out, and so are Spam and Trash unless the search names them with `in:`.
- **Nothing happens.** Nothing is sent and no draft is saved. Each message goes through the agent's rules, the injection scan, then the agent model with the same prompt and read tools as a live run. `draft_reply` runs the draft check and keeps the text. An action agent's tool records that it would act. Other agents are left out, so the test shows what this agent does on its own. A paused agent can be tested.
- **Each message's result.** Took it (with the reply, or what an action agent would do), Left it (its rules or its job don't fit), Skipped (the injection scan stopped it, or the message is gone), or Failed (the model call failed, or the reply failed the draft check).
- **Cost.** The run adds up the agent model's input and output tokens and shows them with the cost at the model's listed price when it finishes. The injection scan and the draft check run on Workers AI and are not counted.
- **Kept.** Each agent keeps its latest run, as the evidence for moving it up a rung (WON-531). A new run replaces it, and deleting the agent deletes it.

As built: `workers/agent/test-run.ts`, `shared/agent-test.ts`, migration `0016_agent_tests.sql`, and Test on the agent's page (`AgentTest.tsx`). The browser tests one message per request, `POST /api/v1/agents/:id/test` to start (`search`, `limit`), then `POST .../test/next` until the run is done, so no request runs long and a run left half done picks up again when the page is opened. `POST .../test/stop` stops it and keeps what was tested; `GET .../test` returns the latest run. A demo build refuses all three.

## Approval queue (0.9.7, WON-532)

Agent sends and bulk changes can wait for one-click approval.

- **Hold for approval.** Each agent and each MCP client has its own switch, in Console > Approvals. It is on by default for an agent's first 7 days in Send and off otherwise. A switch someone set stays as set.
- **What waits.** A send (`send_draft`, `reply_to_email`, `send_email`), and a bulk change: any one call that moves, trashes, labels or marks more than 25 messages. From MCP that is `label_matching`, `label_conversation` and unstarring with `star_conversation` over more than 25 messages.
- **One click.** Approve runs the call as it was made, through the same checks: a reply whose conversation moved on is still refused. Drop discards it. Both are in the Activity log.
- **24 hours.** A queued item waits 24 hours, then expires and is logged as dropped.
- **Limits.** A queued send counts toward the daily limit when it is approved, not when it is queued. An approved send over the limit fails and says so.

As built: `workers/lib/approvals.ts` (the queue and the switches), `workers/lib/approval-run.ts` (holding and running calls), migration `0017_approval_queue.sql`. `GET /api/v1/approvals`, `POST /api/v1/approvals/:id/approve`, `POST /api/v1/approvals/:id/drop`, `PUT /api/v1/approvals/holds/:kind/:id`. The cron drops expired items every minute. Send mode stays off until 0.10; an agent's `send_since` is recorded so the 7-day default applies once it opens. The in-app chat agent is not held: a person is present for each of its turns.

## Promotion evidence (0.10, WON-531)

An agent moves up a rung only when its gate is met. The gate blocks the move: the Console disables it and the API refuses it (409, with the checks). There is no override. Moving down is always allowed, and a new agent starts in Watch.

| Move | Needs |
|---|---|
| Watch to Draft, Watch to On | 10 messages matched and none failed in the last 7 days |
| Draft to Send | A Test run of 20 or more messages with no failures; at least 10 agent drafts sent, 8 of every 10 without edits; no safety check failures in the last 7 days |

The move shows the record it is based on: each check has its count beside it ("Latest Test ran on 22 messages, none failed", "7 of 10 sent without edits", "1 safety check failure"), and the latest safety check failures are listed. Send itself stays locked until `SEND_VERSION`.

- **Sent without edits.** An agent draft keeps a fingerprint of the reply it wrote in its notes (`draft_notes.written`), through edits and redrafts. When a person sends the draft (the send carries the `draft:<id>` key), the reply part of what was sent is fingerprinted the same way: the signature and the quoted original are left out, and markup and spacing don't count. A redraft counts as an edit. Drafts written before this version, and drafts sent by an MCP client's `send_draft`, are not counted.
- **Safety check failures.** The injection scan stopping mail the agent's rules took, and the draft check failing a reply the agent wrote.
- **Test.** The agent's latest run (see above). A stopped run counts what it tested.

As built: `shared/agent-gates.ts` (the gates), `workers/lib/agent-evidence.ts` (the record, `GET /api/v1/agents/:id/evidence`), migration `0019_agent_evidence.sql` (`agent_events`, `draft_notes.written`).

## Build order

1. Console page and navigation (0.9.0)
2. Agents in Watch and Draft, and Review (0.9.0)
3. Test on past mail (0.10)
4. Action agents (0.9.6)
5. Send (0.10)
