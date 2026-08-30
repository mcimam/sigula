# Code quality rules

Scaled by `development.code_standards` (`relaxed` on poc, `strict` on
production). Rules marked **[always]** apply on every track.

## Naming **[always]**

- Names state what a thing *is* or *does*, not how it is implemented.
- No abbreviations beyond ones the domain already uses. `usr`, `calc`, `tmp2`
  cost the reader more than they saved the writer.
- Booleans read as assertions: `is_expired`, `has_access`, `should_retry`.
- Functions that mutate say so. Functions that return say what they return.
- The domain vocabulary in `context/conventions.md` wins over your preference.
  One concept, one word, everywhere.

## Structure

- One responsibility per unit. If the summary of a function needs "and", split it.
- **[strict]** Functions stay short enough to read without scrolling; files stay
  focused enough that their name predicts their contents.
- Nesting depth is a smell. Prefer early returns and guard clauses.
- Match the file layout, module boundaries, and idioms already in the codebase.
  Consistency beats personal preference — always.

## Comments **[always]**

- Comment *why*, never *what*. The code already says what.
- **[strict]** Public functions get a contract: inputs, outputs, failure modes,
  side effects.
- No commented-out code. Version control remembers it for you.
- Every `TODO` names an owner, an issue, or a `DEBT-NNN` entry — a bare `TODO`
  does not get written. A known compromise carries its marker at the exact spot:
  `// DEBT-004: happy path only, no retry on timeout`
- Match the comment density and style of the surrounding code.

## Error handling

- `happy-path` (poc): let it fail loudly and early. No silent catches — an
  empty `except`/`catch` is forbidden on every track.
- `defensive` (production): every external boundary — I/O, network, parsing,
  user input — has an explicit failure path. Errors carry enough context to
  diagnose without a debugger, and never leak internals to the caller.
- **[always]** Never swallow an error to make a test pass or a log go quiet.

## Logging

- `minimal` (poc): enough to see the flow when it breaks.
- `structured` (production): machine-parseable, levelled, correlation ID on
  request paths.
- **[always]** No secrets, credentials, tokens, or PII in logs. Ever.

## Extensibility

Written for the person who inherits this and was not in the room:

- Prefer explicit over clever. Clever code is a bill the next reader pays.
- Do not build for a requirement that does not exist yet. Do not make it
  actively hard to add either.
- Duplication is cheaper than the wrong abstraction. Wait for the third
  occurrence before extracting — and on the third, actually extract it.
