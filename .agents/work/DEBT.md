# Debt ledger

Every shortcut this project is knowingly carrying. This is the promotion
backlog: `/track poc production` reads it to tell you what "doing it properly"
actually costs.

Maintained by `/debt`. Read `.agents/skills/debt-tracking/SKILL.md` for the rules.

---

## Open

| ID | Opened | Phase | Sev | What was skipped | Why | Fix cost | Code |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Accepted

Debt deliberately carried forever. Each names who accepted it — an unattributed
acceptance is just an unpaid item with better PR.

| ID | Accepted | By | What | Why it is acceptable | Revisit when |
|---|---|---|---|---|---|
| | | | | | |

## Closed

| ID | Closed | Outcome | Note |
|---|---|---|---|
| | | paid / obsolete | |

---

## Implicit debt — regenerated, do not hand-edit

Everything the `production` track requires that the active track skips. Computed
by `/debt` from the gate diff, so this list stays complete even when nobody
remembered to write anything down.

_Run `/debt` to populate. Empty on the `production` track by definition._

| Gate | Active track | production | Means |
|---|---|---|---|
| | | | |

---

## Format

**ID** — `DEBT-001`, sequential, never reused. Once assigned it survives closure;
a closed entry keeps its number so old code comments and PRs still resolve.

**Sev** — by consequence, not by how bad it feels:

| Sev | Means | Effect |
|---|---|---|
| `blocker` | Real users get hurt: data loss, a security hole, a silent wrong answer | Blocks promotion. On `production`, blocks shipping. |
| `major` | Costs real time or risk on the next change through this area | Should be paid; needs a stated reason to carry |
| `minor` | Untidy, bounded, not spreading | Fine to carry indefinitely |

**Fix cost** — a rough size (`1h`, `half-day`, `2d`) plus what it touches. A cost
nobody estimated is a cost nobody will schedule.

**Code** — the `DEBT-NNN` marker in source, as `file:line`, or `—` if the debt is
an absence (a test never written, a doc never produced) with nowhere to anchor.

### Detail blocks

`blocker` and `major` entries get a block below the table. `minor` does not — a
row is enough.

```
### DEBT-004 — <one-line claim>

**What was skipped.** The specific thing, concretely.
**Why.** The pressure at the time. Written so it reads as a decision, not an excuse.
**Interest.** What makes this worse the longer it stands. ← the field that gets it paid
**Blast radius.** What breaks, and for whom, if it is never fixed.
**To fix properly.** The actual steps, and the size.
**Triggers payment.** The condition that makes this urgent.
```

`Interest` is the one people skip and the one that matters. "Costs nothing extra
to leave" is a legitimate answer — write it, and the entry can safely become
`accepted`.
