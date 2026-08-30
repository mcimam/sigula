# Agent operating instructions

This is the entry point. Everything the agent needs is under `.agents/`.

## Read first, every session

1. `.agents/config.yml` — the knob file. Track, phases, language, paths,
   commands, autonomy. **Behaviour is configured here, never hardcoded in a
   skill.**
2. `.agents/work/STATE.md` — where this project actually stands right now.

Then read what the task needs, and not more.

## How work is organised

Two independent axes:

**Phases** — what kind of work is happening. Six, always the same six, each with
a persona. Defined in `.agents/workflow/phases/`.

| Phase | Persona | Command | Skill |
|---|---|---|---|
| requirement | Business Analyst | `/idea` | `requirement-grilling` |
| design | Architect | `/design` | `design-system` |
| development | Developer | `/build`, `/optimize` | `implement-feature`, `optimize-code` |
| testing | QA | `/qa`, `/secure` | `qa-testing`, `security-review` |
| deployment | DevOps | `/deploy` | `deploy-release` |
| maintenance | Support / SRE | `/issue` | `triage-issue` |

Cross-cutting: `/debt` + `debt-tracking` runs in every phase — anything that
compromises what exists gets logged when it is taken.

**Tracks** — how strictly each phase runs. `poc` skips most documents and tests;
`production` requires them. A track never adds or removes a phase, only moves the
bar. Defined in `.agents/workflow/tracks/`.

The user may enter at any phase and stop at any phase. State which phase and
track you are operating in **before** starting work, so the framing can be
corrected before effort is spent.

## Resolving a gate

When you need to know whether to do something, resolve in this order — first hit
wins:

1. `config.yml → overrides.<phase>.<gate>`
2. `workflow/tracks/<active track>.yml → <phase>.<gate>`
3. Ask the user

Values: **required** (do it; do not hand back work without it) ·
**recommended** (do it unless there is a stated reason not to — say which) ·
**skip** (do not do it, do not apologise for it, do not silently do it anyway).

## Standing rules

`.agents/rules/` holds policy that applies on every project:

- `engineering.md` — scope, reporting, judgment, definition of done
- `code-quality.md` — naming, structure, comments, errors, logging
- `testing.md` — what a test is for, how to write one, how to fix a failing one
- `security.md` — non-negotiables and the review checklist
- `git.md` — branches, commits, PRs, what is never committed
- `ops.md` — the approval boundary, config, migrations, releases

`.agents/context/` holds facts about **this** project, filled by `/kickoff`.
When it conflicts with a general rule, the project's own conventions win.

## Non-negotiable, on every track

- **No secrets** in the repo, the image, or the logs.
- **Never report unverified work.** Ran it → say what happened, including
  failures. Did not run it → say that.
- **Never weaken a test** to reach green.
- **Stop and ask** before anything under `config.yml → autonomy.ask_first`:
  production deploys, shared migrations, rollbacks, secret or infra changes,
  deleting data, new runtime dependencies, pushes and PRs. Approval does not
  carry forward.
- **Match the codebase** you are in over any personal preference.
- **Record every shortcut** in `.agents/work/DEBT.md`, at the moment it is taken,
  with a `DEBT-NNN` marker in the code. That ledger is what makes a POC
  promotable instead of merely rewritable.

## Language

`config.yml → language` controls what you produce: documents, code, commits, and
how you talk to the user — each set independently. The files under `.agents/` stay
in English so this scaffold travels; that is not a signal about output language.

## Keeping state honest

Update `.agents/work/STATE.md` when the phase changes, when an iteration
finishes, and when something is deployed. Update `.agents/work/DEBT.md` the
moment a shortcut is taken. A stale STATE is worse than an empty one, because it
gets trusted.
