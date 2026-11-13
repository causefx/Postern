# Security policy

Postern holds upstream credentials and sits in front of private services, so security reports matter. Thank you for taking the time.

## Reporting a vulnerability

Please report it **privately**, not in a public issue, pull request or discussion:

1. Open the [Security tab](https://github.com/causefx/Postern/security) of the repository.
2. Choose **Report a vulnerability**, or go straight to [the report form](https://github.com/causefx/Postern/security/advisories/new).

Include what you found, the version (shown in the admin footer, the startup log and `/admin/api/meta`), how to reproduce it, and what an attacker could do with it. A short proof of concept helps. Do not include real credentials.

## What to expect

Postern is maintained by one person, so these are goals, not guarantees:

- A first reply within about 7 days.
- An assessment and a plan within about 30 days.
- A fix released as soon as it is ready and tested, with the advisory published after people have had a chance to update. You are credited in the advisory and release notes unless you ask not to be.

There is no bug bounty. Postern is funded by donations and sponsorships only.

## Supported versions

Only the latest release gets security fixes. While Postern is below 1.0 that means the newest 0.x. After 1.0 it means the newest 1.x. Please reproduce on the latest release before you report.

## What is in scope

Reports about Postern itself, for example:

- Getting past admin sign-in, or any admin API call without a valid session or the `X-Postern-Admin` header.
- A caller reaching a service without a valid token, with a paused or expired token, outside a token's scope, or through an open path rule that should not match.
- Reaching the upstream with a path other than the one that was checked (path traversal, encoding tricks).
- A way to read an upstream credential, a caller token or the encryption key, including from logs, error messages, the audit log or the browser.
- Cross-site scripting, request forgery or clickjacking in the admin UI.
- Weaknesses in how the data file is encrypted or how sessions and OIDC sign-in are handled.
- Rate limiting or the sign-in lockout being bypassed, including by spoofing forwarded headers.

## What is out of scope

- Findings that need you to already be signed in as the admin, or to have access to the machine, the data volume or the environment variables.
- Running Postern over plain HTTP, or with `POSTERN_TRUSTED_PROXIES`, `POSTERN_SECURE` or the embedding setting configured loosely. The README says what each one does.
- Weaknesses in the upstream services Postern fronts, in your reverse proxy, or in your identity provider.
- Denial of service by sending a very large amount of traffic, and missing rate limiting where the limit has been turned off.
- Reports from automated scanners with no demonstrated impact, and missing headers that Postern deliberately leaves to the reverse proxy (such as `Strict-Transport-Security`).

## Good-faith research

If you act in good faith, test only against your own installation, do not access or change other people's data, and give a reasonable time to fix a problem before you discuss it publicly, I will not take legal action against you for your research.
