# ADR-0001 — Send WhatsApp reminders via self-hosted WAHA, not Meta's official Cloud API

| | |
|---|---|
| Status | accepted |
| Date | 2026-08-31 |
| Deciders | User (product owner), Architect |

## Context

SiGula needs to send WhatsApp messages to internal salesmen (never to end
customers) nudging them about overdue accounts, and to receive their
reason-code replies. Two ways exist to automate WhatsApp from a Django app:

1. **WAHA** (WhatsApp HTTP API) — a self-hosted, open-source gateway that
   automates a real WhatsApp account by puppeting the WhatsApp Web protocol.
   No approval process; you scan a QR code with a real phone number and it
   works immediately.
2. **Meta's official WhatsApp Business Cloud API** — the sanctioned,
   Meta-hosted API. Requires business verification, template-message
   approval for anything sent outside a 24-hour customer-initiated window,
   and ongoing compliance with Meta's usage policies.

This choice is expensive to reverse once messages, phone numbers, and
salesman habits are built around one gateway's semantics (WAHA has no
template-approval concept; Meta's API requires pre-approved message
templates for any proactive send). It's also non-obvious which one a
competent engineer would pick — Meta's API is the "textbook correct" choice
for anything customer-facing, but this traffic is 100% internal
(salesman-to-salesman-and-supervisor, never customer-facing), which changes
the calculus.

Note: an early exported prototype of this app (`sigula-deskripsi.txt`)
contains a UI banner claiming "implementasi produksi memakai Meta Cloud API"
(production implementation uses Meta Cloud API). That line is leftover
placeholder text from the prototyping tool and pre-dates this decision — the
prototype itself never calls any real API (its "sends" are entirely mocked in
local state). This ADR is the one binding source of truth: **WAHA**, not Meta
Cloud API, and the prototype's banner text is not to be carried into the real
product's copy.

## Options considered

### Option A — WAHA (self-hosted, unofficial)
- **How it works:** Runs as a Docker container alongside the Django app; a
  real WhatsApp number logs in by scanning a QR code once, after which the
  container exposes a simple HTTP API (`POST /api/sendText`, webhooks for
  incoming messages) that Django calls directly.
- **For:** Zero approval process — pilot can start immediately. No message
  template restrictions — free-form text to any number the account can
  reach. No per-message cost. Full control over hosting and data.
- **Against:** Unofficial — WhatsApp's terms don't sanction this pattern, and
  the connected number can be rate-limited or banned if the account is used
  carelessly (high message volume, bot-like patterns). No Meta support
  channel if something breaks. The team must self-host and maintain the
  gateway (QR re-auth on session drop, uptime).

### Option B — Meta WhatsApp Business Cloud API
- **How it works:** Meta-hosted; Django calls Meta's REST API with an access
  token issued after business verification. Proactive messages (like an
  overdue reminder) generally require a pre-approved message template unless
  sent inside a 24-hour window opened by the recipient.
- **For:** Officially sanctioned — no ban risk from Meta's own policies
  (only from misuse). Meta operates the infrastructure; no self-hosted
  gateway to maintain. Enterprise-grade reliability and support.
- **Against:** Business verification and template approval add real
  time-to-first-message before the pilot can even start. Template approval
  also makes the reminder message's wording and the reason-code reply flow
  more rigid — free-form back-and-forth (a salesman replying "1", "2", or "3")
  doesn't fit the template model cleanly outside the 24-hour window. Per
  Meta's pricing, conversations may carry a per-message cost depending on
  volume and country.

## Decision

We chose **Option A — WAHA**.

**Why the others lost.** Meta's Cloud API loses on time-to-pilot and rigidity:
this is an internal, low-volume, free-form messaging need (a handful of
salesmen replying with one of three short codes), not a customer-facing
messaging product that needs Meta's compliance guarantees. The verification
and template-approval overhead of Option B would delay the pilot for a
benefit (official sanction) that mostly matters at a scale and a
customer-facing use case this pilot doesn't have. The user explicitly
confirmed this choice, accepting the ban risk as a known, managed tradeoff
(see Consequences) rather than a blind one.

## Consequences

**Accepted costs:** The connected WhatsApp number can be rate-limited or
banned by WhatsApp if the gateway is used carelessly (this directly motivates
`docs/adr/0002-manual-notification-trigger.md`'s conservative, admin-gated
sending model). The team must self-host and operate WAHA (Docker container,
QR re-authentication, uptime) rather than relying on Meta's managed
infrastructure.

**What this makes easy:** Immediate pilot start with no approval process.
Free-form reminder text and free-form reason-code replies, matching the
FRD's reply flow exactly. No per-message cost.

**What this makes hard:** Any future move to official, compliance-grade
WhatsApp messaging (e.g. if volume or customer-facing scope grows) means
redesigning the message flow around template approval — this is not a
drop-in swap.

**What we now cannot do:** Guarantee delivery or account safety the way an
officially sanctioned integration would; the app's core value (overdue
tracking) is therefore designed to work standalone even if WAHA/the number
goes down entirely (FRD FR-29).

## Revisit when

The pilot graduates to full company-wide rollout (materially higher message
volume), or the connected number is rate-limited/banned at least once — either
should trigger a re-evaluation of whether Meta's Cloud API's overhead is now
worth it at the new scale.
