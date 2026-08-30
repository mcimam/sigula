---
description: Grill a raw idea into a stated problem, success criteria and non-goals
argument-hint: <the idea, in whatever form>
---

Run the **Requirement** phase on this idea:

**$ARGUMENTS**

1. Read `.agents/config.yml` for the active track, and
   `.agents/workflow/phases/1-requirement.md` for the gates.
2. Invoke the `requirement-grilling` skill.
3. Write the outcome per the track's gates — `poc` may be ten lines in
   `STATE.md`; `production` feeds the PRD in the next phase.
4. Update `.agents/work/STATE.md`: phase, the problem statement, open unknowns.

Start by playing the idea back in your own words and getting confirmation. Do not
propose a solution, an architecture, or a stack in this phase — that is Design's
job, and jumping to it is how the wrong thing gets built confidently.
