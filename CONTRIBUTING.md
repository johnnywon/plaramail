# Contributing

## Before a pull request

Run these and make sure each passes:

```sh
npm test
npm run typecheck
npm run build
```

`npm run test:build` also checks the demo build. Local setup, the sample inbox and browser checks are in [docs/development.md](docs/development.md).

## Rules

- Use `example.com`, `example.org` and `example.net` for every domain and address in config, docs and tests. Never commit a real domain, address, account ID or Worker name.
- D1 migrations are append-only. Add a new numbered file in `migrations/`; never edit one that has shipped. Durable Object class names and migration tags are permanent.
- Each change that users see gets a line in CHANGELOG.md, and a new migration is named there.
- DESIGN.md is the design system, and `tests/design-rules.test.mjs` enforces the rules it can check. Keyboard shortcuts live only in `shared/shortcuts.ts`.
- Write docs, commit messages, pull requests and UI copy in the voice described in [AGENTS.md](AGENTS.md).

## Security issues

Report them privately, as [SECURITY.md](SECURITY.md) describes, not in an issue or pull request.
