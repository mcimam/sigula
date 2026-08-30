# Agent instructions

This repository keeps all AI agent configuration in **`.agents/`**, which is the
single source of truth. Tool-specific directories (`.claude/`, `CLAUDE.md`) are
thin symlinks and pointers into it — never edit those, edit `.agents/`.

**Start here:** [`.agents/AGENTS.md`](.agents/AGENTS.md)

## Layout

| Path | What it holds |
|---|---|
| `.agents/config.yml` | The knob file — track, phases, language, paths, commands, autonomy |
| `.agents/work/STATE.md` | Where this project stands right now |
| `.agents/work/DEBT.md` | The debt ledger — every shortcut being carried, and the promotion backlog |
| `.agents/workflow/` | The six SDLC phases, and the tracks that set how strictly each runs |
| `.agents/rules/` | Standing policy — engineering, code quality, testing, security, git, ops |
| `.agents/context/` | Facts about *this* project — filled by `/kickoff` |
| `.agents/skills/` | How to do each kind of work well |
| `.agents/commands/` | Slash-command entry points |
| `.agents/templates/` | PRD, FRD, TDD, ADR, test plan, runbook, PR, issue |

## The short version

Work runs through six phases — requirement, design, development, testing,
deployment, maintenance — each with a persona. How strictly a phase runs is set
by the active **track** in `config.yml`: `poc` (fast, disposable, minimal gates)
or `production` (full rigor). You may enter at any phase.

Before starting work: read `.agents/config.yml` and `.agents/work/STATE.md`, then
state which phase and track you are operating in.

Every deliberate compromise is logged in `.agents/work/DEBT.md` when it is taken,
with a `DEBT-NNN` marker in the code. That ledger is the promotion backlog.

Never: commit a secret, report unverified work, weaken a test to reach green,
leave a shortcut unlogged, or take an action listed under
`config.yml → autonomy.ask_first` without asking.
