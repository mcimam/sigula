---
description: Design the system and produce the documents the active track requires
argument-hint: [feature or system name]
---

Run the **Design** phase for: **$ARGUMENTS**

1. Read `.agents/config.yml` (track, `paths`, `language`),
   `.agents/workflow/phases/2-design.md`, and `.agents/context/architecture.md`.
2. Resolve the unknowns carried over from Requirement. Each becomes a resolved
   fact, a written assumption, or a spike — none stays unlabelled.
3. Invoke the `design-system` skill.
4. Produce **only** the documents the track gates call for
   (`design.prd`, `design.frd`, `design.tdd`, `design.adr`), from
   `.agents/templates/`, into the paths in `config.yml`, in `language.documents`.
   If all are `skip`, give a short design note in the conversation and stop —
   that is the correct outcome, not a shortcut.
5. Update `.agents/context/architecture.md` with the component map, boundaries,
   data model, and any newly frozen decisions.
6. Produce an ordered task list, riskiest task first.

State up front which documents you are producing and which the track skips, so
the user can override before you write them.
