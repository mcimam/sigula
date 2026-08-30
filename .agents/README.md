# The `.agents` scaffold

A reusable starting point for building software with an AI agent. Clone it, run
`/kickoff`, and start.

## Design principle

**The workflow is data, not code.** Skills describe *how to do a kind of work
well*; they never hardcode *when* to do it. When a skill needs to know whether to
write a PRD or run a security review, it reads a gate from
`workflow/tracks/<active>.yml`. Change a track, or add your own, and every skill
adapts without being edited.

That is what makes this reusable across a throwaway spike and a client
production system without maintaining two scaffolds.

## Adapting to a new project

```bash
git clone <this repo> my-project && cd my-project
rm -rf .git && git init
claude
> /kickoff a tool that reconciles supplier invoices against POs
```

`/kickoff` interviews you and fills in `config.yml`, `context/project.md`,
`context/stack.md`, and `work/STATE.md`. Check off after it runs:

- [ ] `config.yml → track` set (`poc` or `production`)
- [ ] `config.yml → phases` pruned — a library has no `deployment`
- [ ] `config.yml → commands` filled in; every remaining `""` means the agent
      will have to ask you
- [ ] `config.yml → language` set for documents / code / commits / conversation
- [ ] No `<PLACEHOLDER>` left in `context/`
- [ ] `work/STATE.md` reflects reality

## Daily use

| Command | Phase | Does |
|---|---|---|
| `/kickoff` | — | Bootstrap a fresh clone |
| `/status` | — | Where things stand; flags drift and placeholders |
| `/track` | — | Show or switch rigor; shows the gate diff first |
| `/debt` | — | Record, review, pay or accept technical debt |
| `/idea` | requirement | Grill an idea into a stated problem |
| `/design` | design | System design + whatever documents the track needs |
| `/build` | development | Implement, verifying each step |
| `/optimize` | development | End-of-iteration cleanup, behaviour-preserving |
| `/qa` | testing | Functional testing, with a verdict |
| `/secure` | testing | Security review by severity |
| `/deploy` | deployment | Build, configure, release (prod always asks) |
| `/issue` | maintenance | Triage → reproduce → root-cause → fix → cover |

## Customising

**Change how strictly work is done** → edit `config.yml → track`, or
`config.yml → overrides` for a single gate.

**Add a rigor level** (e.g. `internal-tool` between poc and production) → copy
`workflow/tracks/poc.yml`, adjust the gates, point `track:` at it. No skill,
command, or rule changes.

**Add a capability** → new directory under `skills/` with a `SKILL.md`. The
`description` in its frontmatter is what makes it auto-invoke, so write it as
*when to use this*, not *what it is*.

**Add an entry point** → new markdown file in `commands/`. Becomes `/<filename>`.

**Change a standing policy** → edit `rules/`. These apply on every project cloned
from here, so change them here and the change propagates to future clones.

**Project-specific conventions** → `context/conventions.md`. This beats `rules/`
when they conflict; matching the codebase in front of you always wins.

## The debt ledger

`work/DEBT.md` is what makes a POC *promotable* rather than merely rewritable. It
has two sources:

- **Explicit** — compromises logged with `/debt add` the moment they are taken,
  each carrying a `DEBT-NNN` marker at the spot in the code
- **Implicit** — every gate the active track skips that `production` requires,
  computed from the gate diff, so the backlog is complete even when nobody
  remembered to write anything down

`/track poc production` reads both and hands you the promotion backlog with the
blockers first and a cost attached. `/debt review` runs at the end of each
iteration to reconcile ledger against code in both directions and re-price
severities that have drifted.

## The bridge

`.agents/` is canonical. Everything else points at it:

```
.agents/                    ← edit here, always
.claude/skills           →  ../.agents/skills
.claude/commands         →  ../.agents/commands
.claude/settings.json    →  ../.agents/settings.json
CLAUDE.md                →  imports .agents/AGENTS.md
AGENTS.md                →  pointer for other agent tools
```

Symlinks, so there is nothing to keep in sync. If your tool does not follow
symlinks, replace them with copies and add a sync step — but check first, most do.

## Layout

```
.agents/
├── AGENTS.md            Entry point — read every session
├── README.md            This file
├── config.yml           The knob file
├── workflow/
│   ├── README.md        How phases × tracks resolve
│   ├── phases/          The six SDLC phases, with personas and gates
│   └── tracks/          poc.yml, production.yml, + your own
├── context/             Facts about THIS project (filled by /kickoff)
├── rules/               Standing policy, every project
├── skills/              How to do each kind of work well
├── commands/            Slash-command entry points
├── templates/           PRD, FRD, TDD, ADR, test plan, runbook, PR, issue
├── work/
│   ├── STATE.md         Where the project stands
│   ├── DEBT.md          The debt ledger — the promotion backlog
│   └── notes/           Scratch — safe to delete
├── settings.json        Committed harness config
└── settings.local.json  Personal, gitignored
```

Generated deliverables land in `docs/` (`prd/`, `frd/`, `tdd/`, `adr/`) — they
belong to the project, not to the tooling.
