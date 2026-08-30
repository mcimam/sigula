---
description: Bootstrap a fresh clone — interview the user and fill in config.yml and context/
argument-hint: [one-line project idea]
---

Bootstrap this clone of the scaffold for a new project.

Initial idea from the user: **$ARGUMENTS**

## Do this in order

**1. Check the ground.** Read `.agents/config.yml`. If `project.name` is already
set to something other than `<PROJECT_NAME>`, this project is already
initialised — stop and ask whether to re-run before overwriting anything.

**2. Establish the track.** Ask which applies, and explain the difference in one
line each:
- `poc` — prove the idea, cheap and fast, expected to be rewritten
- `production` — other people will depend on this

Do not guess. This single value changes every gate downstream.

**3. Grill the idea.** Invoke the `requirement-grilling` skill at the depth the
chosen track calls for. Do not skip this even on `poc` — a light grilling is
still a grilling.

**4. Establish the stack.** Ask for language, framework, package manager,
database, test framework, and where it deploys. If the user is undecided, offer
a recommendation with one line of reasoning per choice — do not silently pick.

**5. Fill in the files.** Write, replacing every placeholder:
- `.agents/config.yml` — project block, track, language, and every entry under
  `commands` that you now know. Leave genuinely unknown ones as `""`.
- `.agents/context/project.md` — from the grilling
- `.agents/context/stack.md` — from step 4
- `.agents/work/STATE.md` — track, phase `requirement` or `design`, first tasks

Leave `architecture.md` and `conventions.md` for the Design phase, unless code
already exists — in which case read it and fill them from what is actually there.

**6. Prune the phases.** Ask whether any phase does not apply — a library has no
`deployment`, a one-off script has no `maintenance` — and remove those from
`config.yml → phases`.

**7. Report.** Show what you set: track, phases, stack, and every command still
left as `""`. Those gaps are the things you will have to ask about later, so
name them now.

## Rules

- Interview in batches of related questions, not one at a time.
- Every `<PLACEHOLDER>` you leave behind is a place the agent will later work
  blind. Fill it or explicitly flag it as unknown.
- Do not write any application code in this command. Kickoff sets up context;
  building comes after.
