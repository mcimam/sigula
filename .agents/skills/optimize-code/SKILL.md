---
name: optimize-code
description: End-of-iteration cleanup pass - remove duplication that has actually appeared, delete dead code, simplify what turned out more complex than needed, and tighten measured hot paths without changing behaviour. Use at the end of a development iteration, before handing to QA, or when asked to optimise, clean up, or tidy the code.
---

# Optimisation pass

Runs when `development.optimization_pass` is `required` — at the **end** of an
iteration, never during one. Optimising while building is how features stop
shipping.

## The contract

**Behaviour does not change.** The tests that passed before must pass after,
unmodified. If a test needs changing, this is not an optimisation — it is a
change of behaviour, and it needs to go back through Design.

Run the full suite before you start and note the result. That is your baseline.

## What to do, in order

**1. Delete.** The highest-value optimisation is removal.
- Dead code, unreachable branches, unused exports, unused dependencies
- Abstractions with exactly one caller that hide more than they save
- Configuration options nobody sets
- Commented-out blocks and stale `TODO`s

**2. De-duplicate — but only what actually repeated.** Now that the feature is
built, real duplication is visible where it was speculative before. Extract on
the third occurrence, not the second. Duplication is cheaper than the wrong
abstraction.

**3. Simplify.** Look for what turned out more complicated than it needed to be:
- Deep nesting → guard clauses and early returns
- Long functions that grew during the build → split at the seams that emerged
- Clever code → obvious code
- Wide interfaces → the surface that is actually used

**4. Tighten hot paths — measured only.** Performance work without a measurement
is decoration that costs legibility.
- Measure first. Name the number and where it came from.
- Fix the algorithm before the constant factor. An N+1 query beats every
  micro-optimisation you could apply to the loop around it.
- Measure after. If it did not move, revert it — you paid readability for nothing.
- Note the result. An unmeasured "optimisation" gets reverted, not merged.

**5. Re-check consistency.** Does the new code now match the codebase, or did the
patterns drift while you were building? Realign names to the domain vocabulary in
`context/conventions.md`.

**6. Reconcile the debt ledger.** The iteration is over, so this is the cadence
point (`debt.review_cadence`). Run `/debt review`: markers in code with no entry,
entries whose marker is gone, and severities that moved because the code around
them grew. Anything you *paid* during this pass gets closed here — a shortcut
removed but left open in the ledger is how the ledger stops being trusted.

## What this pass is not

- Not a refactor of things the iteration did not touch
- Not a dependency upgrade
- Not the place to add features, tests for new behaviour, or error handling that
  changes what the code does
- Not an excuse to rewrite someone else's module

Stay inside the iteration's footprint. Things you noticed outside it go on a
list you hand back.

## Done when

The diff removes more than it adds or has a stated reason it does not, the full
suite passes unchanged from the baseline, every performance claim has a
before/after number, the debt ledger agrees with the code in both directions, and
nothing outside the iteration's footprint was touched.
