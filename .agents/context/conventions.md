# Conventions

> Project-specific. `rules/code-quality.md` holds the universal rules; this
> file holds the ones that are true *here*. When they conflict, this file wins —
> matching the surrounding codebase always beats a general preference.

## Directory layout

```
<tree of the meaningful directories, with one line each on what belongs there>
```

Where things go:

| Adding a… | Put it in | Named |
|---|---|---|
| `<feature module>` | `<path>` | `<pattern>` |
| `<test>` | `<path>` | `<pattern>` |

## Naming

| Kind | Convention | Example |
|---|---|---|
| Files | `<kebab / snake / Pascal>` | |
| Functions | | |
| Types / classes | | |
| Constants | | |
| Database tables / columns | | |
| API routes | | |
| Env vars | | |

## Patterns in use

The established way to do each recurring thing here. New code matches these.

| Concern | The pattern | Reference implementation |
|---|---|---|
| Error handling | | `<file:line>` |
| Validation | | `<file:line>` |
| Data access | | `<file:line>` |
| Async / concurrency | | `<file:line>` |
| Configuration | | `<file:line>` |
| Logging | | `<file:line>` |

## API conventions

- Response envelope: `<…>`
- Error shape: `<…>`
- Pagination: `<…>`
- Versioning: `<…>`

## Anti-patterns

Things previously tried here that did not work. Do not reintroduce them.

- `<ANTI-PATTERN>` — `<why it was removed>`
