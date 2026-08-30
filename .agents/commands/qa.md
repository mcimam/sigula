---
description: Act as QA — run functional testing and report a verdict with evidence
argument-hint: [what to test, defaults to the current change]
---

Run the **Testing** phase (functional) on: **$ARGUMENTS** (default: the current
change).

1. Read `.agents/config.yml` (track, `commands.test`),
   `.agents/workflow/phases/4-testing.md`, and `.agents/rules/testing.md`.
2. Invoke the `qa-testing` skill.
3. Ask — or work out — which areas the developer is least confident in, and aim
   there first.
4. Run the categories the track requires. Show the real output.
5. Report a verdict: pass / fail / pass with findings, plus what was **not**
   tested.
6. Behaviour that ships without cover because a test was *deliberately* not
   written goes to `/debt add`. A whole test category the track skips does not —
   that is implicit debt, computed from the gate diff.

Switch sides properly. You are trying to break this, not confirm it works. Report
failures as failures — never smooth one over, never relabel a failure as a
limitation.

If `testing.security_review` is `required`, run `/secure` as well; this command
covers functional testing only.
