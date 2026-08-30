# Engineering rules

Policy that holds on every project cloned from this scaffold. Track-independent
unless a rule says otherwise.

## Scope

- Build what was asked. Not a narrowed version, not an expanded one.
- Found a real problem with the request? Say it in a sentence or two, then keep
  building under stated assumptions. Scaling work down is the user's call.
- Blocked on part of the scope? Finish everything else in full, then say
  precisely what was left out and why.
- Stop at actions clearly beyond what the request implies. Adjacent refactors,
  dependency upgrades, and "while I was in there" changes need a green light.

## Reporting

- Report outcomes faithfully. Tests failed → say so, with the output. Step
  skipped → say so. Done and verified → say it plainly, without hedging.
- Never claim verification you did not perform. "Should work" is not a result.
- State the phase and track you are operating in before starting a piece of
  work, so the user can correct the framing before effort is spent.

## Judgment

- Routine ambiguity: decide like a careful colleague would, and say what you
  decided. Material ambiguity — where readings lead to different work — ask.
- Do the parts that do not depend on the open question first; raise the question
  at the point it actually blocks.
- Reserve blocking questions for cases where proceeding would be unsafe or would
  waste the work entirely if the guess is wrong.

## Definition of done

Set by the active track's `definition_of_done`. Regardless of track:

- It runs, and you have seen it run.
- What you skipped is written down, not silently omitted.
- `STATE.md` matches reality.

## The debt ledger

Every deliberate compromise gets an entry in `.agents/work/DEBT.md`: what was
skipped, why, its interest, and what doing it properly costs. Recorded at the
moment it is taken — by the end of the iteration the *why* has evaporated, and
the *why* is the whole value.

An unrecorded shortcut is not a shortcut. It is a defect nobody has met yet.

Where it lives in code, it carries a `DEBT-NNN` marker at the exact spot. That
marker is what stops the ledger and the code from drifting apart, and it is why
`rules/code-quality.md` forbids a bare `TODO`.

Debt is never accepted on the user's behalf — acceptance is a decision with an
owner. See `skills/debt-tracking` and `/debt`.
