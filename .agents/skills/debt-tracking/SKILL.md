---
name: debt-tracking
description: Record, review and pay down technical debt in .agents/work/DEBT.md - log a shortcut with its interest and blast radius, reconcile the ledger against the code, and compute the promotion backlog from the track gate diff. Use whenever a shortcut is taken, a gate is skipped, a mitigation is applied instead of a real fix, a security finding is accepted, or when asked about tech debt.
---

# Debt tracking

The ledger is `.agents/work/DEBT.md`. It exists so a POC can be **promoted**
rather than merely rewritten, and so nobody discovers a shortcut by tripping over
it in production.

An unrecorded shortcut is not a shortcut. It is a defect nobody has met yet.

## When an entry is required

Gated by `debt.record`. It is `required` on every shipped track — a track that
does not record its compromises is not a lighter process, it is an undocumented
one. Log it the moment it happens, not at the end of the iteration: by then the
*why* has evaporated, and the *why* is the whole value.

- A gate resolved to `skip` that `production` marks `required`
  → **do not hand-log these**; they are implicit debt, computed from the gate diff
- A shortcut taken while implementing: a hardcoded value, a missing error path,
  an unhandled edge case, a copy-paste left un-abstracted
- A **mitigation** applied instead of a root-cause fix (`triage-issue`)
- A security finding **accepted** rather than fixed (`security-review`)
- A test deliberately not written for behaviour that shipped
- A dependency pinned to a workaround version, or a patch applied downstream
- A design decision made under time pressure that you would not defend on merit

Not debt, do not log: things you simply have not built yet, ideas for later,
style preferences, or anything already tracked as a task. The ledger is for
**deliberate compromises to what exists**, and it loses its force if it becomes a
backlog.

## Recording

1. Take the next sequential ID from the ledger. Never reuse a number, including
   from closed entries — old code comments and PRs still point at them.
2. Add the row. Severity by *consequence* (see the table in `DEBT.md`), not by
   how uncomfortable it feels.
3. Write the detail block per `debt.entry_detail`:
   - `short` (poc) — only `blocker` and `major` get one
   - `full` (production) — every entry gets one, including **Interest** and
     **Blast radius**

   Fill **Interest** honestly. "Costs nothing extra to leave" is a valid answer
   and the fastest route to `accepted`.
4. If the debt lives in code and `debt.code_marker` is `required`, leave a marker
   at the exact spot:

   ```
   // DEBT-004: happy path only, no retry on timeout. See .agents/work/DEBT.md
   ```

   A bare `TODO` is forbidden by `rules/code-quality.md`. This marker is what
   keeps the ledger and the code from drifting apart.
5. Update the counters in `STATE.md`.

## Reviewing

At the cadence in `debt.review_cadence` — by default, end of each iteration:

**Reconcile against the code.** Two failure modes, both silent:

| Problem | Looks like | Do |
|---|---|---|
| Orphan | `DEBT-007` in code, no ledger entry | Create the entry, or remove a stale marker |
| Ghost | Ledger says `open`, marker gone from code | The debt was probably paid — verify, then close it |
| Drift | Marker exists but the code around it changed | Re-read the entry; severity may have moved |

**Re-price.** Severity is not fixed. Debt that was `minor` becomes `major` when
the code around it grows, and `blocker` when it starts touching user data. Check
the `Interest` field: an entry whose interest is compounding gets re-graded now,
not when it bites.

**Flag the size.** Past `debt.review_threshold` open entries, say so plainly. A
ledger too long to hold in your head is a ledger that has stopped being managed —
the fix is to pay some down or accept them, not to keep appending.

## Paying

- Fix the thing. Verify it. Remove the code marker in the same change.
- Move the row to **Closed** with outcome `paid`. Do not delete it — the history
  of what this project traded away is worth more than a tidy file.
- If the code it referred to is simply gone, close it as `obsolete`.

## Accepting

Some debt should be carried forever, and saying so is better than pretending it
is still on a list.

Move it to **Accepted** with: who accepted it, why it is acceptable, and the
condition that would reopen it. **Never accept debt on the user's behalf** —
acceptance is a decision with an owner, and unattributed acceptance is just an
unpaid item with better presentation.

## Implicit debt

Everything `production` requires that the active track skips. Computed from the
gate diff, never hand-written, so the promotion backlog stays complete even when
nobody wrote anything down during the sprint.

Regenerate it whenever the track or an override changes. On `production` this
section is empty by definition.

## Blockers and shipping

`debt.blockers_allowed` decides whether a `blocker` entry may stand open:

- `true` (poc) — it may. It still blocks promotion to a stricter track; it does
  not block the POC itself from running.
- `false` (production) — it may not. Before a production deploy, every open
  `blocker` is paid or explicitly accepted by the user. Report them **before**
  the deploy, not in the summary afterwards.

This is a stop, not a warning. Do not deploy past an open blocker on a track
where they are disallowed, and do not downgrade a severity to get past it.

## Promotion

When `/track` moves a project to a stricter track, the ledger *is* the plan:

1. Regenerate implicit debt against the new track
2. List open `blocker`s — these must be paid or explicitly accepted before the
   promotion means anything
3. Total the fix costs so the promotion has a number attached, not a vibe
4. Present it as ordered work, blockers first

Switching track does not retroactively fix anything. Say that plainly, so nobody
reads the new label as a claim about the existing code.

## Done when

Every deliberate compromise has an entry, every `blocker` and `major` has an
interest and a blast radius, code markers and ledger entries agree in both
directions, and the counters in `STATE.md` match the ledger.
