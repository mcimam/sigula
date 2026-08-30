---
description: Security review — injection, authz, secrets, exposure, dependencies
argument-hint: [scope, defaults to the current change]
---

Run a security review over: **$ARGUMENTS** (default: the current change).

1. Read `.agents/rules/security.md` and
   `.agents/workflow/phases/4-testing.md`.
2. Invoke the `security-review` skill.
3. State your scope explicitly before you start — this diff, this module, or the
   whole codebase. An honest narrow review beats a broad claim over a skim.
4. Report findings by severity, each with a concrete failure scenario and a
   specific fix.
5. Triage every finding with the user: fix now, fix later, or accept. Deferrals
   and acceptances both go to `/debt add` — a security finding deferred without a
   ledger entry is one that gets rediscovered by someone less friendly. Never
   accept on the user's behalf.

Run this regardless of track whenever the change touches authentication,
authorisation, user input, money, or personal data.

Report vulnerability classes and fixes. Do not write working exploits, and do not
paste real secrets into the report — name the location instead.
