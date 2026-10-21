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
| Activity log | Every action by an agent, an MCP client or you, kept 90, 120 or 180 days |
| AI models | The agent model and its facts, and Cloudflare and OpenRouter side by side: training, retention, models, key |
| MCP | The server URL, connect steps per client, connected apps (OAuth grants, read or read and send) with Revoke |
| Addresses, Signatures, Labels, Preferences, Keyboard shortcuts, Mail storage | The 0.8 settings tabs |

## An agent

- **Job**: one sentence, in your words.
- **Addresses**: one, several, or all.
- **Mode**: Watch (shows what it would do), Draft (writes drafts for you), Send (replies on its own, up to a daily limit). Send is off in 0.9 and arrives in 0.10.
- **Instructions** and an **example reply**.
- One column: Trust, Activity, How it works. Test (run on past mail; nothing is sent) joins in 0.10.

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
- 0.10: the workbench (setup beside what the agent does), Test on past mail, promotion evidence, action agents, then Send.

## Action agents (0.10, WON-453)

An agent can do something to mail instead of replying: "favorite emails from higgsfield", "label invoices", "archive newsletters". In 0.9 an agent can only write a reply, so a job like that matches mail and does nothing.

- **Does.** Each agent has a Does field: Reply, Star, Label (one label, picked when the agent is set up), Archive, or Mark read. Reply is the 0.9 behaviour. An agent does one of these, never several.
- **Rules-only fast path.** An action agent whose rules say exactly which mail it takes runs without a model: when the rules pass, the action happens. No model call, no cost, no delay. The setup offers a rule from the job ("from higgsfield" suggests From domain). An action agent with no rules asks the model only whether the job fits, and gets no reply tools.
- **Watch, then On.** The ladder for action agents has two steps. Watch logs what it would do ("Would star"). On does it. Draft and Send stay for reply agents. The move to On uses the same evidence as Watch to Draft.
- **Undo from the Activity log.** Every action shows in the Activity log with Undo: unstar, remove the label, move back to the inbox, mark unread. Undo is offered for 30 days.
- **No competition with reply agents.** Every action agent whose rules and job fit acts. One reply agent at most replies, chosen by list order as in 0.9. Starring a message never stops it getting a reply.
- **Limits.** An action agent has a daily limit (100 by default), so a loose rule can't archive a whole inbox in one run.
- **Tools.** The drafting run gets one tool per action (`star_email`, `label_email`, `archive_email`, `mark_read`) only for an agent whose Does field names it. A message is acted on once per agent; a second run on the same message does nothing.

## Build order

1. Console page and navigation (0.9.0)
2. Agents in Watch and Draft, and Review (0.9.0)
3. Test on past mail (0.10)
4. Action agents (0.10)
5. Send (0.10)
