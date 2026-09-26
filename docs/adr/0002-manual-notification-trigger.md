# ADR-0002 — Notification batches are Admin-triggered, never scheduled or automatic

| | |
|---|---|
| Status | accepted |
| Date | 2026-08-31 |
| Deciders | User (product owner), Architect |

## Context

Once a customer is overdue and active, something has to decide *when* the
WhatsApp reminder actually goes out. The two natural designs are: (a) a
background job that runs on a schedule (e.g. nightly) and sends automatically
whenever it finds eligible customers, or (b) a manual action an Admin
explicitly takes whenever they choose.

This matters more than it looks: SiGula sends over WAHA, a self-hosted,
unofficial gateway that puppets a real WhatsApp account
(`docs/adr/0001-waha-vs-meta-cloud-api.md`). WhatsApp can rate-limit or ban a
number that shows automated, bot-like sending patterns — and a scheduled job
is exactly that pattern: fixed timing, unattended, potentially bursty if many
customers become overdue at once (e.g. right after a bulk Excel import).
Reversing this later — going from manual to automatic, or vice versa — means
changing user habits (Admin currently expects to press a button) and
re-litigating the ban-risk tradeoff, so it's worth deciding deliberately now
rather than defaulting to "of course it should be automatic."

The reference prototype (`sigula-deskripsi.txt`) already embodies this
choice explicitly — its UI carries a permanent banner stating *"notifikasi
tidak terkirim otomatis — Admin menekan tombol ... kapan pun ia mau"*
(notifications are not sent automatically — Admin presses the button
whenever they want) — confirming this was a deliberate design intent, not an
accidental limitation of the mock.

## Options considered

### Option A — Admin-triggered batch (manual)
- **How it works:** Overdue/eligible customers accumulate silently. An Admin
  opens the "Send Notification" screen, sees a preview of who would be
  notified, and explicitly presses a button to fire the batch. Nothing sends
  without that action.
- **For:** Bounds sending volume and timing to human judgment — an Admin
  naturally paces sends and can hold off after, say, a large Excel import
  dumps in hundreds of newly-overdue customers at once. Matches the
  already-validated prototype behaviour the user reviewed. Simpler to build
  and reason about — no scheduler, no background worker needed for the
  pilot's SQLite/no-queue stack (`context/stack.md`).
- **Against:** Relies on an Admin remembering to trigger it — an overdue
  customer could sit un-notified indefinitely if nobody presses the button.
  Doesn't scale well to many teams each wanting their own cadence.

### Option B — Scheduled/automatic sending
- **How it works:** A background job (cron, Celery beat, etc.) runs on a
  fixed interval, computes eligible customers, and sends without human
  involvement.
- **For:** Nothing falls through the cracks from forgetfulness. Removes a
  manual step from the Admin's workflow.
- **Against:** Directly increases ban risk on an already-unofficial gateway —
  automated, unattended, regularly-timed sends are the pattern WhatsApp's
  anti-abuse systems are tuned to catch. Requires a scheduler/worker the
  stack doesn't have yet (`context/stack.md` explicitly flags "no queue
  chosen yet ... not needed for pilot scale"). Removes the natural
  human circuit-breaker that would otherwise catch a burst (e.g. a bad
  import) before hundreds of messages fire at once.

## Decision

We chose **Option A — Admin-triggered batch**.

**Why the others lost.** Option B's core appeal — nothing forgotten — is
outweighed by what it costs on an unofficial gateway that can be banned
outright: automated, scheduled sending is precisely the failure mode
`docs/adr/0001-waha-vs-meta-cloud-api.md` accepted as a risk to actively
manage, not to compound. A single pilot team of ~9 salesmen doesn't need
scheduling to avoid customers being forgotten — an Admin checking in
periodically is a reasonable, already-validated (via the prototype) operating
model at this scale. Building the scheduler/worker infrastructure for
Option B also isn't free, and the stack has explicitly deferred that
decision until it's actually needed.

## Consequences

**Accepted costs:** An overdue customer will not be notified until an Admin
actively triggers a batch — there is no time-based guarantee. This is a
process risk (an Admin must remember to check in), not a technical one.

**What this makes easy:** A simple, synchronous request/response
implementation with no background worker or scheduler required at pilot
scale. A natural human checkpoint against sending storms (e.g. right after a
large Excel import).

**What this makes hard:** Guaranteeing timely notification without relying on
someone remembering to act. If this pilot expands to many teams, each Admin
manually triggering sends may not scale operationally.

**What we now cannot do:** Promise a fixed reminder cadence (e.g. "always
notified within 24 hours of going overdue") — that would require Option B.

## Revisit when

The pilot graduates to a scale where relying on an Admin to remember becomes
the actual bottleneck (e.g. multiple teams, each needing their own cadence),
or once official, compliance-grade sending (Meta's Cloud API, per ADR-0001's
revisit condition) removes the ban-risk argument against scheduling.

> **Note 2026-09-26 (ADR-0009).** Confirmations sent in answer to a salesman's WhatsApp reply are not reminders and
> are not covered by this decision: each answers a message the salesman just sent (and the how-to is limited to once an
> hour). Reminders themselves remain Admin-triggered (or the opt-in schedule, DEBT-010).
