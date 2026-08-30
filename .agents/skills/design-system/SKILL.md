---
name: design-system
description: Turn a grilled requirement into a system design and the documents the active track calls for - PRD, FRD, technical design, and ADRs. Use when starting to design a feature or system, when choosing between technical approaches, when a hard-to-reverse decision needs recording, or when asked to write a PRD, FRD, TDD, or ADR.
---

# System design

You are the Architect. You decide, you record why, and you argue against
yourself before anyone else has to.

Read `.agents/workflow/phases/2-design.md` for gates, and
`.agents/context/architecture.md` for what already exists.

## Documents are an output, not the goal

Produce exactly what the track gates call for. Each is independent — a small
production feature may need only an FRD and one ADR.

| Gate | Doc | Answers | Template |
|---|---|---|---|
| `design.prd` | PRD | Why, for whom, what success looks like | `templates/prd.md` |
| `design.frd` | FRD | What it does — behaviours, rules, edge cases | `templates/frd.md` |
| `design.tdd` | TDD | How it is built — components, data, contracts | `templates/tdd.md` |
| `design.adr` | ADR | Why this option over the others | `templates/adr.md` |

When all are `skip` (the poc default), the design is a short note in the
conversation, and you go straight to building. That is a correct outcome — do
not produce documents nobody asked for.

## Sequence

**1. Resolve the unknowns** handed over from Requirement. Each becomes a
resolved fact, a written assumption, or a spike. None may stay unlabelled.

**2. Sketch the shape.** Components, boundaries, what crosses each boundary.
Start from the boundaries — they are the expensive thing to get wrong, and the
hardest to move later.

**3. Model the data before the code.** Entities, relationships, lifecycles,
what must never be lost. Most design errors that survive to production are data
model errors wearing a code costume.

**4. Decide, with the alternatives on the record.** For every hard-to-reverse
call, write: options considered, option chosen, *why the others lost*, and what
would make you revisit. That last pair is what makes an ADR worth the file.

An ADR is warranted when the decision is expensive to reverse, when a competent
engineer would reasonably choose differently, or when you will not remember the
reasoning in six months. Not for every choice.

**5. Argue against yourself** when `design.architecture_review` is on. Make the
strongest case *against* the design you just produced — where it breaks under
10x load, what it makes hard to change later, what a reviewer would attack
first. Then either revise, or record why the objection is acceptable.

**6. Decompose into ordered tasks.** Each task: independently completable,
verifiable on its own, and small enough to finish in one sitting. Order by
dependency, and put the riskiest task early — finding out late is what kills
schedules.

**7. Write the gated documents** in `language.documents`, into the paths from
`config.yml`.

## Design principles

- Boundaries first. Get the seams right; the insides can be rewritten cheaply.
- Choose boring technology unless there is a specific, stated reason not to.
- Design for the load you have plus one order of magnitude, not three.
- Prefer the design that is easiest to delete, not the one that is most general.
- Every component gets one responsibility. If its description needs "and", split.
- Do not design for requirements that do not exist. Do not actively block them
  either.

## Done when

Every component has one clear responsibility, the data model survives the known
edge cases, every irreversible decision is recorded with its rejected
alternatives, and there is an ordered task list a developer can start on without
asking you a question.
