---
description: Triage, reproduce, root-cause and fix a reported issue
argument-hint: <bug report, error, or alert>
---

Run the **Maintenance** phase on this issue:

**$ARGUMENTS**

1. Read `.agents/workflow/phases/6-maintenance.md`.
2. Invoke the `triage-issue` skill.
3. Triage first: who is affected, how badly, is data at risk? If users are
   actively affected, mitigate before diagnosing — and say clearly that you
   mitigated rather than fixed.
4. Reproduce. Reduce to the smallest failing case. Do not theorise before this.
5. Root-cause until you can state the mechanism in one concrete sentence.
6. Fix at the right level — the mechanism, not the symptom. If you mitigated
   rather than fixed, log it with `/debt add`: a mitigation is debt by
   definition, and the entry is what stops it becoming permanent by accident.
7. When `maintenance.regression_test_on_fix` is on: write the test, **run it
   against the unfixed code and confirm it fails**, then fix, then confirm it
   passes.
8. Search for other instances of the same cause before closing.

If it genuinely cannot be reproduced, say so and add the instrumentation that
would catch it next time. That is a legitimate outcome. A speculative patch is
not.
