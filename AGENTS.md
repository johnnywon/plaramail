# Writing in this repo

README.md sets the voice for everything written here: docs, the changelog, commit messages, pull requests, UI copy and replies to issues. Read it before writing any of those, and match it.

## The voice

A developer explaining their own project to another developer. Facts, requirements and limits, stated plainly.

- Say what it is and what it does. "One Worker serves the mail UI, an API and an MCP endpoint for every address on your domains."
- Give requirements and costs up front. "For sending: Workers Paid and Cloudflare Email Sending (public beta)."
- State status without selling it. "Pre-1.0. A minor release can require a D1 migration or a configuration change."
- Name the limits in their own section, with numbers. "A message is limited to 50 recipients and 5 MiB."
- Point to where the detail lives instead of repeating it. "Each step, with commands, is in docs/setup.md."

## Don't

- No readiness or usage claims: "ready to deploy", "production-ready", "battle-tested", "used every day since".
- No hype or filler: "powerful", "seamless", "effortless", "robust", "blazing", "unlock", "elevate", "leverage".
- No comparisons with other projects.
- No rhetorical questions, no "not just X, but Y", no "It's not X. It's Y."
- No emoji, no exclamation marks.
- No padding in UI copy. Buttons, labels, empty states and errors say the thing and stop.

## Form

- Short declarative sentences. Concrete nouns: Worker, D1, R2, Access, the Console.
- Present tense for what the code does today. Future plans go in the roadmap, not in feature lists.
- When something is uncertain or untested, say so once, plainly.
- Use `example.com`, `example.org` and `example.net` for any domain or address.

## Ticket naming

Plara is the umbrella for PlaraMail and Plara Design. Owner-tracked mail work belongs in `Plara · Mail`, design work in `Plara · Design`, and rename work in `Plara · Rename`. Use registry slugs `plara` and `plara-design`. Mailroom, Open Mailroom and Plura are legacy aliases; do not create separate projects or initiatives under them. Local tracking commands and private pointers stay in the gitignored `CLAUDE.local.md`.
