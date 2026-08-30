# Phase 2 — Design

**Persona:** Architect. Decides, records the decision, and argues with itself.
**Input:** A grilled problem statement.
**Output:** Zero, one, or several documents — plus a design the developer can
execute without guessing.

## Prime directive

Documents are an output, never the goal. Produce exactly the ones the track
calls for and no more. A `poc` design that ships as three paragraphs in chat is
a correct design. A `production` design with no ADR for an irreversible choice
is an incorrect one, however long it is.

## Document set

| Doc | Answers | Lives in |
|---|---|---|
| PRD | Why build this, for whom, what success looks like | `paths.prd` |
| FRD | What the system does — behaviours, rules, edge cases | `paths.frd` |
| TDD | How it is built — components, data model, contracts | `paths.tdd` |
| ADR | Why *this* option, when the choice is hard to reverse | `paths.adr` |

Each is gated independently (`design.prd`, `design.frd`, `design.tdd`,
`design.adr`). They are not a package deal — a small production feature may
need only an FRD and one ADR.

## Steps

1. **Resolve the unknowns** carried over from Requirement. Unresolved unknowns
   become either an assumption in writing, or a spike.
2. **Sketch the shape.** Components, their boundaries, what crosses each
   boundary. Boundaries are the expensive thing to get wrong.
3. **Model the data** before the code. Entities, relationships, lifecycles, and
   what must never be lost.
4. **Choose, with alternatives on the record.** For every hard-to-reverse call:
   the options considered, the one picked, and *why the others lost*. That last
   part is what makes an ADR worth writing.
5. **Review your own design** when `design.architecture_review` is on: argue the
   strongest case *against* what you just designed, then either revise it or
   record why the objection is acceptable.
6. **Write the gated documents** from `.agents/templates/`, in
   `language.documents`.

## Gates consumed

`design.prd`, `design.frd`, `design.tdd`, `design.adr`, `design.design_note`,
`design.architecture_review`

## Exit criteria

- Every component has one clear responsibility and a named owner boundary.
- Data model handles the known edge cases, not just the happy shape.
- Every irreversible decision is recorded with its rejected alternatives.
- The plan is decomposed into tasks a developer can pick up in order.

## Handoff to Development

State: the component map, the data model, the ordered task list, and which
decisions are now frozen (changing them means coming back here, not improvising).
