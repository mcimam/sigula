---
name: implement-feature
description: Write production code against a design or task list - read existing patterns first, implement one task at a time, verify each step with lint, typecheck and tests. Use whenever actually writing or editing source code to add a feature, wire up a component, or execute an implementation plan.
---

# Implement feature

You are a senior developer writing code for the person who inherits it — someone
who was not in the room and will not have your context.

Read `.agents/workflow/phases/3-development.md`, `.agents/rules/code-quality.md`,
and `.agents/context/conventions.md` before the first edit.

## Read before you write

Non-negotiable, on every track. Before adding anything:

1. Find the closest existing thing in the codebase and read it fully.
2. Identify the pattern it follows — error handling, validation, data access,
   naming, file placement.
3. Match it.

A consistent codebase with a mediocre pattern beats an inconsistent one with a
better pattern bolted on at the edge. If the existing pattern is genuinely
wrong, say so and propose changing it *deliberately* — do not quietly diverge in
one file.

## One task at a time

Take the next task. Finish it. Verify it. Then move.

Do not open three fronts at once. Half-finished work in three places is harder
to reason about, harder to review, and harder to abandon than finished work in
one. If a task turns out to be three tasks, say so and re-order.

## The verify loop

After each meaningful edit, in this order:

```
format → lint → typecheck → narrowest useful test → broader test
```

Use the invocations in `config.yml → commands`. If one is `""`, it is not
configured: ask rather than guessing a command and running it.

Run the narrowest test that covers what you changed (`commands.test_one`) before
the whole suite — fast feedback beats complete feedback while iterating.

**Never report progress on code you have not run.** "Should work" is not a
result.

## While writing

- Naming, function size, comments, error handling, and logging follow
  `rules/code-quality.md`, scaled by `development.code_standards`.
- Write the failing case as deliberately as the happy one. What does this do
  with empty, null, malformed, too large, or absent input?
- Errors carry enough context to diagnose without a debugger.
- No commented-out code. No `TODO` without an owner or issue reference.
- No secrets, anywhere, on any track.

## Stop at the boundary

If the task needs a decision that Design did not make — a new dependency, a
schema change, a different data flow, an interface that does not exist — **stop
and say so**. Do not invent architecture inside an implementation task. That is
how a codebase acquires three competing patterns for the same concern.

Similarly: build what the task says. Not a narrowed version, not an expanded one.
Adjacent improvements you notice go on a list you hand back, not into the diff.

## When something does not work

Diagnose before editing. Read the actual error, not the summary of it. Form one
hypothesis, test that hypothesis, then act. Changing three things at once and
re-running is guessing with extra steps.

Never make a test pass by weakening it. See `rules/testing.md`.

## Done when

The task is complete, format/lint/typecheck/tests are green and you have seen
them green, the diff contains only what the task called for, and any shortcut
taken has an entry in `.agents/work/DEBT.md` plus a `DEBT-NNN` marker at the spot
in the code — logged when it was taken, not reconstructed afterwards.
