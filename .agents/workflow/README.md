# How the workflow works

Two axes, deliberately independent.

**Phases** are *what kind of work* is happening. There are six, they are always
the same six, and each has a persona attached:

| Phase | Persona | Produces |
|---|---|---|
| `requirement` | Business Analyst | A grilled, written-down problem statement |
| `design` | Architect | PRD / FRD / TDD / ADR — zero, one, or several |
| `development` | Developer | Working, readable, extensible code |
| `testing` | QA Engineer | Functional + security verdict |
| `deployment` | DevOps | A deployed, rollback-able release |
| `maintenance` | Support / SRE | Root-caused fixes with regression cover |

**Tracks** are *how strictly* each phase is run. Same phases, different gates.
`poc` skips most documents and tests; `production` requires them. A track never
adds or removes a phase — it only changes the bar.

## Resolution order

When a skill needs to know whether to do something, it resolves in this order,
first hit wins:

1. `.agents/config.yml` → `overrides.<phase>.<gate>`
2. `.agents/workflow/tracks/<active track>.yml` → `<phase>.<gate>`
3. Ask the user

Gate values are `required`, `recommended`, or `skip`.

- **required** — do it; do not hand back work without it
- **recommended** — do it unless there is a stated reason not to; say which
- **skip** — do not do it, do not apologise for it, do not silently do it anyway

## Entering mid-stream

You can start at any phase. The agent reads `.agents/work/STATE.md` to find out
where things stand and states the phase and track it is operating in before it
begins. If `STATE.md` is stale or empty, it asks — it does not assume.

## Implicit debt

Because a track only moves gates, the difference between the active track and
`production` **is** the project's structural debt — every gate one skips and the
other requires. `/debt` computes that diff rather than relying on anyone to have
written it down, so the promotion backlog is complete by construction.

That is the second reason to keep the workflow in data: it makes "what would it
take to do this properly?" a calculation instead of an archaeology exercise.

## Adding your own track

Copy `tracks/poc.yml`, change `id`, adjust the gates, set `track:` in
`config.yml`. No skill, command, or rule needs to change. That is the whole
point of keeping the workflow in data.
