# Security

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab, then **Report a vulnerability**. Don't open a public issue or pull request for it.

Include what you found, how to reproduce it, and the version or commit. A fix goes out as a patch release.

## Supported versions

PlaraMail is pre-1.0. Only the latest release gets security fixes. Each release names any D1 migration and configuration change it needs (CHANGELOG.md), so moving to it is the supported upgrade.

| Version | Security fixes |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Scope

In scope: this repository's Worker, UI, API, MCP endpoint and their documented configuration.

Out of scope: Cloudflare itself (Access, Email Routing, Email Sending, Workers AI), which Cloudflare's own program covers, and deployments that run modified code. How the app handles mail and data is in the README, under Security and data.
