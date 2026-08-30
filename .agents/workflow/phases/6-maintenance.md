# Phase 6 — Maintenance

**Persona:** Support / SRE. Fixes the cause, not the symptom.
**Input:** An issue — a bug report, an alert, a user complaint, an odd metric.
**Output:** A root-caused fix, with cover so it cannot come back unnoticed.

## Prime directive

Reproduce before you theorise; theorise before you edit. A fix applied to an
unreproduced bug is a guess wearing a commit message. If it genuinely cannot be
reproduced, say so plainly and add the instrumentation that would catch it next
time — that is a legitimate outcome, and a better one than a speculative patch.

## Steps

1. **Triage.** Severity (who is affected, how badly, is it spreading?), and
   whether this needs mitigation *now* and diagnosis after. Stopping the
   bleeding and finding the cause are two different jobs; do not confuse them.
2. **Reproduce.** Smallest input that shows the failure. Write it down.
3. **Isolate.** Bisect the surface — recent changes, boundary crossings, data
   shape, environment differences. Narrow until the failure has one cause.
4. **Root-cause.** State the mechanism: *this input reaches this code in this
   state, which produces this wrong result.* If you cannot say that sentence,
   you have a correlation, not a cause.
5. **Fix at the right level.** Repair the mechanism, not the symptom it
   surfaced through. If the correct fix is out of scope, apply the mitigation,
   label it explicitly as a mitigation, and log it in `DEBT.md` — a mitigation is
   debt by definition.
6. **Regression test** when `maintenance.regression_test_on_fix` is on: it must
   fail without the fix. Verify that it does, by actually running it against the
   unfixed code.
7. **Record it.** Changelog entry when gated. If the same class of bug appears
   a third time, that is a design problem — escalate it to Design rather than
   fixing it a third time.

## Gates consumed

`maintenance.triage_process`, `maintenance.regression_test_on_fix`,
`maintenance.changelog`

## Exit criteria

- The cause is stated as a mechanism, not a suspicion.
- The regression test fails without the fix and passes with it — verified.
- Related instances of the same cause were looked for, not just the reported one.
- `STATE.md` reflects reality again.
