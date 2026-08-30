---
name: qa-testing
description: Act as QA - design and run functional tests that try to break the code, cover edge cases, state transitions and integration failures, and report a verdict with real output. Use when testing a feature, writing a test plan, deciding what to test, or verifying that an implementation actually meets its stated behaviour.
---

# QA testing

Switch sides. You may have written this code an hour ago; here you are paid to
find where it fails, not to confirm that it works.

Read `.agents/workflow/phases/4-testing.md` for which categories the track
requires, and `.agents/rules/testing.md` for how tests get written.

## Where to aim first

Ask the developer — or yourself — which parts they are least confident in. That
is where the bugs are. Then, in order of yield:

1. Boundaries between components
2. Anything that touches external input
3. Error paths (routinely written, rarely exercised)
4. Anything changed most recently
5. Anything with a history of bugs

## Attack patterns

**The contract.** For each documented behaviour: does it do exactly that? Not
approximately, not usually.

**The edges.** Run these against every input that accepts them:

| Class | Try |
|---|---|
| Emptiness | empty string, empty list, null, absent field, whitespace only |
| Size | zero, one, maximum, maximum + 1, very large, negative |
| Type | wrong type, coercible-but-wrong, unicode, emoji, control characters |
| Time | past, future, DST boundary, leap day, timezone mismatch, expired |
| Multiplicity | duplicate, out of order, concurrent, retried, replayed |
| Structure | malformed, truncated, extra fields, deeply nested |

**The transitions.** State machines break *between* states. What happens on
retry? On partial failure? On interruption mid-write? On the same action twice?

**The integrations.** For every external dependency: what happens when it is
slow, down, returns an error, times out, or — the nastiest — returns something
plausible but wrong?

**The permissions.** Can user A reach user B's data by changing an id? Test it
directly; do not assume the router handles it.

## Running tests

Use `config.yml → commands.test`. Show the real output — never a summary of a
run you did not perform.

When a test fails, diagnose which side is wrong before touching anything: the
test, or the code. Then fix that side. Weakening an assertion, adding a skip, or
widening a tolerance to reach green is forbidden on every track.

## Reporting

State a verdict, then the evidence:

```
Verdict: <pass / fail / pass with findings>

Ran:      <categories, with the actual commands>
Passed:   <n>
Failed:   <n>  ← each with the failure output
Not run:  <what and why>

Findings:
  [severity] <what breaks, with the input that breaks it>
```

Report failures as failures. Never smooth one over, never re-label a failure as
a limitation. A passing report on a path you did not test is worse than no report.

## Done when

Every category the track requires has actually run with output shown, edge cases
and error paths were attacked deliberately rather than incidentally, every found
bug has a reproduction, and the verdict states plainly what was not tested.
