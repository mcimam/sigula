---
description: Record, review, pay or accept technical debt in the ledger
argument-hint: [add <what> | pay DEBT-NNN | accept DEBT-NNN | review | (empty = report)]
---

Manage the debt ledger: **$ARGUMENTS**

Read `.agents/config.yml → debt`, `.agents/work/DEBT.md`, and invoke the
`debt-tracking` skill. Dispatch on the first word of the argument.

---

## No argument — report

1. Regenerate the **Implicit debt** section from the gate diff between the active
   track and `production`.
2. Reconcile code markers against the ledger, both directions:
   - `grep -rn "DEBT-" <paths.src> <paths.tests>` → markers with no entry (orphans)
   - entries marked `open` whose marker is gone (ghosts)
3. Report:

```
Ledger:    <n> open  (<b> blocker, <m> major, <mi> minor) · <a> accepted · <c> closed
Implicit:  <n> gates skipped that production requires
Interest:  <the entries whose interest is compounding>
Orphans:   <DEBT-NNN in code, not in ledger>
Ghosts:    <open in ledger, marker gone from code>
Estimate:  <sum of fix costs for open items>
```

4. End with the single entry most worth paying next, and why that one.

---

## `add <description>`

1. Take the next sequential ID. Never reuse, including from closed entries.
2. Ask only what you cannot infer: severity if the consequence is unclear, and
   the fix cost. Infer phase, date, and code location yourself.
3. Write the row. If `blocker` or `major`, write the detail block — including
   **Interest**, which is the field that gets debt paid.
4. If it lives in code and `debt.code_marker` is `required`, add the marker at
   the exact spot in the same change.
5. Update the counters in `STATE.md`.

---

## `pay DEBT-NNN`

1. Read the entry. Confirm the fix described is still the right one — an entry
   written three months ago may have been overtaken.
2. Do the work. Verify it. Add a test if the debt was missing cover.
3. Remove the code marker **in the same change**.
4. Move the row to **Closed**, outcome `paid`. Do not delete it.
5. Update the counters.

---

## `accept DEBT-NNN`

**Requires the user's explicit go-ahead.** Never accept debt on their behalf.

1. Present the entry: what it is, its interest, and its blast radius.
2. Ask for the acceptance, and for the condition that should reopen it.
3. Move it to **Accepted** with who accepted it, why, and that revisit condition.
4. Remove the code marker only if the acceptance means it is no longer a
   compromise. If it is still a known compromise, the marker stays.

---

## `review`

Full pass, per the review section of the `debt-tracking` skill: reconcile against
code, re-price severities against how the code has grown, and flag the ledger
size if it is past `debt.review_threshold`.

Re-pricing is the point of this pass. Debt that was `minor` becomes `major` as
the code around it grows, and `blocker` once it starts touching user data — an
entry whose interest is compounding gets re-graded now, not when it bites.
