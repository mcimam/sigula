---
description: Implement the current task list, verifying each step
argument-hint: [task or feature to build]
---

Run the **Development** phase for: **$ARGUMENTS**

1. Read `.agents/config.yml` (track, `commands`),
   `.agents/workflow/phases/3-development.md`, `.agents/rules/code-quality.md`,
   and `.agents/context/conventions.md`.
2. Read the existing code near what you are about to change. Find the pattern.
   Match it. Do this before the first edit, not after.
3. Invoke the `implement-feature` skill.
4. Work one task at a time. After each: format → lint → typecheck → narrow test.
   Use the invocations from `config.yml → commands`; if one is `""`, ask rather
   than inventing a command and running it.
5. Log any shortcut with `/debt add` **as you take it** — not at the end. Leave a
   `DEBT-NNN` marker at the spot in the code.
6. When the iteration is done and `development.optimization_pass` is `required`,
   run `/optimize` before handing over.

Report: what was built, what was left out and why, and where you are least
confident. That last item tells QA where to aim.

Stop and ask if the task needs a decision Design did not make — a new dependency,
a schema change, an interface that does not exist. Do not invent architecture
inside an implementation task.
