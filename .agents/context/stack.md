# Stack

> Filled per clone. The runnable commands live in `.agents/config.yml` —
> this file explains the *choices*, that file holds the *invocations*.

## Runtime

| | |
|---|---|
| Language | `<LANG + VERSION>` |
| Runtime | `<e.g. Node 22 / Python 3.12 / Go 1.23>` |
| Package manager | `<pnpm / uv / poetry / go mod>` |
| Lockfile committed | `<yes/no>` |

## Frameworks and major libraries

| Library | Version | Used for | Why this one |
|---|---|---|---|
| `<LIB>` | `<VER>` | `<PURPOSE>` | `<REASON — or link the ADR>` |

## Data

| | |
|---|---|
| Primary store | `<…>` |
| Migrations | `<tool + where they live>` |
| Cache / queue | `<…or none>` |

## Tooling

| | |
|---|---|
| Test framework | `<…>` |
| Linter / formatter | `<…>` |
| Type checker | `<…or none>` |
| CI | `<…or none>` |

## Environments

| Env | Where it runs | Who can deploy | Notes |
|---|---|---|---|
| local | | | |
| staging | | | |
| production | | | |

## Setting up from zero

```bash
<the exact sequence a new machine needs>
```

## Known gotchas

Things that will waste an hour if not known in advance.

- `<…>`
