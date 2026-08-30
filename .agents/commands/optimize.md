---
description: End-of-iteration cleanup pass — behaviour-preserving, measured
argument-hint: [scope, defaults to this iteration's changes]
---

Run the optimisation pass over: **$ARGUMENTS** (default: what this iteration
changed).

1. Run the full test suite first and record the result. That is your baseline.
2. Invoke the `optimize-code` skill.
3. Work in order: delete → de-duplicate (third occurrence only) → simplify →
   tighten measured hot paths → re-check consistency against
   `.agents/context/conventions.md`.
4. Run the full suite again. It must pass **unmodified**. If a test needs
   changing, this is a behaviour change, not an optimisation — stop and say so.
5. Run `/debt review`. This is the cadence point (`debt.review_cadence`):
   reconcile markers against the ledger both ways, re-price severities that
   drifted, and close anything this pass actually paid.

Every performance claim needs a before and after number. If a change did not move
the number, revert it — you paid legibility for nothing.

Stay inside this iteration's footprint. Things you noticed elsewhere go on a list
you hand back, not into the diff.
