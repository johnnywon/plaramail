# Roadmap

Where the project stands and what to know before deploying is in the [README](../README.md#status).

Shipped: one list for every address, one search language with ranked results, the in-app agent and the MCP server, a choice of agent model limited to providers that don't keep or train on your mail, labels and bulk actions with undo, scheduled send, D1 storage with attachment search, and keyboard shortcuts that people and agents can rebind.

[Open an issue](https://github.com/johnnywon/pluramail/issues) to argue for one of these or propose another.

## Now: control over what agents do

- [x] **Activity log.** Every read, draft, send, delete and label change by the agent, auto-draft and MCP clients, in Console > Activity.
- [ ] **Approval queue.** Agent sends and bulk changes can wait for one-click approval.
- [ ] **Scoped agent access.** MCP grants limited to chosen addresses, so a support agent never sees billing mail. Grants already separate reading from sending.

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

Underneath: D1 becomes the only store, so there is one storage model to learn and upgrade.
