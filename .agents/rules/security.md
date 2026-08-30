# Security rules

The **[always]** items hold even on `poc` — they are about not creating a
liability, not about rigour. The review checklist runs when
`testing.security_review` is `required`.

## Non-negotiable **[always]**

- No secrets in the repository. Not in code, config, fixtures, tests, comments,
  or commit history. If one is found committed, treat it as compromised: rotate
  it, then remove it.
- Secrets come from the environment or a secret manager. `.env` files are
  gitignored, and `.env.example` carries names with empty values only.
- No secrets, tokens, or PII in logs, error messages, or API responses.
- No credentials in URLs, and no credentials in shell history.
- Never disable TLS verification to make something work.

## Review checklist

**Input** — every value from outside the process is untrusted: request bodies,
query params, headers, file uploads, env vars, third-party responses, and
database rows written by an older version of the code.

- Injection: parameterised queries only; no string-built SQL, shell, or template
- Path traversal on any filesystem path derived from input
- Deserialisation of untrusted data
- Size and rate limits on anything a stranger can call

**Authentication & authorisation**

- Every endpoint states its auth requirement; there is no "inherits it somehow"
- Authorisation is checked on the *object*, not only the route — the classic
  hole is a valid user reading another user's id
- Sessions and tokens: expiry, rotation, revocation, secure cookie flags

**Data**

- Encrypted in transit; encrypted at rest where the data warrants it
- Passwords hashed with a current, slow, salted algorithm — never encrypted,
  never home-rolled
- APIs return the fields needed, not the whole row
- PII is inventoried and its retention is deliberate

**Dependencies**

- Pinned versions and a committed lockfile
- Known-vulnerability scan in CI when `deployment.ci_pipeline` is on
- New runtime dependencies need explicit approval — see `config.yml → autonomy`

**Operational**

- Errors to users are generic; details go to logs
- Debug modes, verbose stack traces, and default credentials cannot reach prod
- CORS, CSP, and security headers set deliberately, not copied from a tutorial

## Reporting findings

Severity + a concrete failure scenario: who does what, and what they get. A
finding with no scenario reaching a real consequence is noise — drop it rather
than pad the report. Triage each one: fix now, fix later with a ticket, or
accept with the acceptance recorded and attributed.
