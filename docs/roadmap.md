# Roadmap

Where the project stands and what to know before deploying is in the [README](../README.md#status).

Shipped: one list for every address, one search language with ranked results, the in-app agent and the MCP server, a choice of agent model limited to providers that don't keep or train on your mail, hired agents that watch, draft or star, label, archive and mark read on the addresses you choose, labels and bulk actions with undo, undo send and scheduled send, D1 as the only store with attachment search, and keyboard shortcuts that people and agents can rebind.

[Open an issue](https://github.com/johnnywon/plaramail/issues) to argue for one of these or propose another.

## Now: agents earn Send (0.10)

- [x] **Activity log.** Every read, draft, send, delete and label change by the agent, hired agents and MCP clients, in Console > Activity.
- [x] **Action agents.** Hired agents that star, label, archive or mark read instead of replying, starting in Watch. Shipped in 0.9.6.
- [ ] **Test on past mail.** Run an agent against mail you already have and see what it would have done, without sending anything.
- [ ] **Evidence before promotion.** What an agent did in Watch or Draft, shown before you move it to Draft or Send.
- [ ] **Approval queue.** Agent sends and bulk changes can wait for one-click approval.
- [ ] **Scoped agent access.** MCP grants limited to chosen addresses, so a support agent never sees billing mail. Grants already separate reading from sending.
- [ ] **Send mode.** Hired agents that reply on their own, up to a daily limit, once the steps above are in place.

## Next: teams, a faster start, and rules

- [ ] **Sign-in and roles.** Accounts with their own login on top of Cloudflare Access, admin and member roles, and per-address access, so one deployment can serve a whole team as its everyday email instead of Gmail or Google Workspace. Admins add people, choose which addresses each one sees, and remove them.
- [ ] **One-command setup.** A CLI that creates the Email Routing rule for each address, enables Email Sending, turns on Access and writes the secrets. Adding an address becomes one command.
- [ ] **Import existing mail.** Bring in an mbox or IMAP export so a new deployment starts with your history.
- [ ] **Start on Workers Free.** Receive, read, search and use the agent without a paid plan, and add Workers Paid when you want to send.
- [ ] **Rules in plain words.** "File receipts under Receipts" or "draft replies for support@" runs on each new message, shown as a rule you can read and edit.

## Later: shared work and reach

- [ ] **Shared inboxes.** Assignment and internal notes on addresses a team shares, built on sign-in and roles.
- [ ] **Events for other Workers.** New-mail and label events on Cloudflare Queues, so your own code can react without polling.
- [ ] **Search by meaning.** Opt-in Vectorize search alongside full-text, for "the email where they offered a discount".
- [ ] **Notifications and offline.** Web push for new mail and an installable app that reads cached mail offline.
