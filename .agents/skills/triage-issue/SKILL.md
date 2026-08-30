---
name: triage-issue
description: Handle a reported bug, alert or production issue - triage severity, reproduce, isolate, root-cause the mechanism, fix at the right level, and add a regression test that fails without the fix. Use when given a bug report, an error, an alert, unexpected behaviour, or asked to debug or investigate something broken.
---

# Triage and fix

You are support / SRE. You fix causes, not symptoms.

Read `.agents/workflow/phases/6-maintenance.md` for gates.

## Triage before diagnosis

Two different jobs — do not confuse them:

- **Mitigation** stops the bleeding. Roll back, disable the feature, drain the
  queue. Fast, temporary, and explicitly labelled as temporary.
- **Diagnosis** finds the cause. Slower, permanent.

If users are actively affected, mitigate first and say clearly that you have
mitigated rather than fixed. Then diagnose.

Severity: who is affected, how badly, is it spreading, is data being lost or
corrupted? Data loss outranks everything.

## Reproduce before you theorise

A fix applied to an unreproduced bug is a guess wearing a commit message.

1. Get the exact input, environment, and sequence
2. Reproduce it
3. Reduce it to the smallest case that still fails
4. Write it down

If it genuinely cannot be reproduced, say so plainly and add the instrumentation
that would catch it next time. That is a legitimate outcome — and a better one
than a speculative patch that makes the symptom disappear for unknown reasons.

## Isolate

Bisect the surface, not the code line by line:

- What changed recently? *(Start here — it is right more often than it deserves)*
- Does it fail at a boundary — I/O, network, parsing, a version mismatch?
- Is it data-shaped? Does it fail for one record and not another?
- Is it environment-shaped? Works locally, fails deployed?
- Is it timing-shaped? Only under load, only concurrently, only on retry?

Change one variable at a time. Changing three and re-running teaches you nothing.

## Root-cause

You have the cause when you can say this sentence concretely:

> *This input reaches this code in this state, which produces this wrong result.*

If you cannot, you have a correlation. Keep going. Read the actual error and the
actual stack trace — not your memory of what that error usually means.

## Fix at the right level

Repair the mechanism, not the symptom it surfaced through. Ask: is this bug an
instance of a class? If the same shape has now appeared three times, that is a
design defect — escalate it to Design rather than fixing it a third time.

If the correct fix is genuinely out of scope, apply the mitigation, label it as a
mitigation in the code and the report, and log it with `/debt add` — a mitigation
is debt by definition, and the ledger entry is what stops it from quietly
becoming the permanent state.

## Regression test

When `maintenance.regression_test_on_fix` is on:

1. Write the test
2. **Run it against the unfixed code and confirm it fails**
3. Apply the fix
4. Confirm it passes

Step 2 is the one that gets skipped and the one that matters. An unverified
regression test is a comment with extra steps.

## Then look wider

Before closing: search for other instances of the same cause. The reported one is
rarely the only one — it is just the one someone noticed.

## Report

```
Symptom:   <what was observed>
Cause:     <the mechanism, in one sentence>
Fix:       <what changed, and at what level>
Cover:     <the regression test, and that it was seen to fail first>
Also found:<other instances of the same cause, or "none">
Remaining: <what is still open, or "nothing">
```

## Done when

The cause is a stated mechanism rather than a suspicion, the regression test was
observed failing before the fix, related instances were searched for, and
`STATE.md` reflects reality again.
