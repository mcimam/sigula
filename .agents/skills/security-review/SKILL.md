---
name: security-review
description: Security pass over a change or codebase - injection surfaces, authn/authz gaps, secret handling, data exposure, and dependency risk, reported by severity with a concrete failure scenario. Use before a production deploy, when reviewing code that touches auth, user input, payments or personal data, or when asked for a security review.
---

# Security review

Runs when `testing.security_review` is `required`, and any time the change
touches authentication, authorisation, user input, money, or personal data —
regardless of track.

Work from `.agents/rules/security.md`. This skill is how you run that checklist.

## Scope it first

Name what you are reviewing: this diff, this module, or the whole codebase. A
review that claims to cover everything and actually skimmed the diff is worse
than an honest narrow one.

## The passes

**1. Trace untrusted input.** Every value from outside the process is
untrusted — request bodies, query params, headers, cookies, file uploads, env
vars, third-party responses, and rows written by an older version of the code.
Follow each to where it is used:

- Reaches a query → parameterised, or string-built? *(String-built is a finding.)*
- Reaches a shell, template, or eval → same question
- Reaches a filesystem path → traversal possible?
- Reaches a deserialiser → is the type constrained?
- Reaches a response or log → is it escaped, is it filtered?

**2. Check every entry point for auth.** Enumerate the routes, handlers, jobs,
and message consumers. For each: what authentication is required, and where is
authorisation checked?

The classic hole is object-level: a valid, authenticated user changes an id in
the URL and reads someone else's record. Route-level auth does not catch it.
Check the *object* access, not just the route.

**3. Hunt secrets.** Source, config, fixtures, tests, comments, logs, error
responses, and commit history. Anything found in history is compromised: it gets
rotated, then removed. Say so plainly.

**4. Audit dependencies.** Unpinned versions, missing lockfile, known
vulnerabilities, abandoned packages, and anything pulled in for one function.

**5. Look at what leaks.** Over-fetching APIs returning whole rows, verbose
errors exposing internals, stack traces reachable in production, debug endpoints,
default credentials, permissive CORS.

**6. Check the crypto basics.** Passwords hashed with a current slow salted
algorithm — never encrypted, never home-rolled. TLS not disabled anywhere. Random
values for tokens from a cryptographic source.

## Reporting

Each finding needs a **concrete failure scenario**: who does what, and what they
get. A finding without a scenario that reaches a real consequence is noise —
drop it rather than pad the report.

```
[CRITICAL|HIGH|MEDIUM|LOW] <one-line claim>
  Where:    <file:line>
  Scenario: <attacker does X → gets Y>
  Fix:      <the specific change>
```

Severity is about consequence and reachability, not how alarming it sounds. An
unreachable code path is LOW no matter how ugly it looks.

Triage every finding with the user: fix now, fix later, or accept.

- **Fix later** → `/debt add`, severity mapped from the finding's severity. A
  security finding deferred without a ledger entry is a finding that will be
  rediscovered by someone less friendly.
- **Accept** → the ledger's **Accepted** section, naming who accepted it and the
  condition that reopens it. Never accept on the user's behalf.

## Constraints

- Report vulnerability classes and how to fix them. Do not write working exploits.
- Do not exfiltrate or paste real secrets into the report — name the location.
- If the review found nothing, say that, and say what you covered. An empty
  report with stated scope is a legitimate result; padding it is not.

## Done when

Every checklist area is covered or explicitly declared out of scope, each finding
has a reachable scenario and a specific fix, findings are triaged with a decision
recorded, and any accepted risk names who accepted it.
