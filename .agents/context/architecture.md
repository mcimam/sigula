# Architecture

> Filled during Design. Keep it current — a stale architecture doc is worse
> than none, because it is trusted.

## Shape

<One paragraph: the style — monolith, service split, CLI, batch pipeline,
library — and why that shape fits this problem.>

## Components

| Component | Responsibility | Owns | Depends on |
|---|---|---|---|
| `<NAME>` | `<ONE sentence, no "and">` | `<data/state it owns>` | `<…>` |

## Boundaries

What crosses between components, and in what form. Boundaries are the expensive
thing to get wrong, so they are written down explicitly.

| From → To | Carries | Via | Sync/async |
|---|---|---|---|
| `<A → B>` | `<…>` | `<HTTP / queue / function call>` | |

## Data model

| Entity | Key fields | Relationships | Lifecycle |
|---|---|---|---|
| `<ENTITY>` | `<…>` | `<…>` | `<created … archived/deleted>` |

Must never be lost: `<…>`

## External dependencies

| Service | Used for | Failure mode | What we do about it |
|---|---|---|---|
| `<…>` | `<…>` | `<down / slow / wrong>` | `<retry / degrade / fail>` |

## Frozen decisions

Changing one of these means returning to Design, not improvising in code.
Each links to its ADR.

- `<DECISION>` — `docs/adr/NNNN-*.md`

## Known weaknesses

Where this design is deliberately imperfect, and what would trigger a rework.

- `<WEAKNESS>` — revisit when `<TRIGGER>`
