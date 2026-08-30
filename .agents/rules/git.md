# Git rules

## Committing

- Commit and push **only when asked**. Finishing work is not a commit trigger.
- On the default branch, create a branch first.
- One logical change per commit. Unrelated fixes get their own.
- Never commit: secrets, `.env`, credentials, build output, dependency
  directories, editor config, `.DS_Store`, or large binaries.

## Branch names

`<type>/<short-kebab-description>` where type is
`feat` | `fix` | `refactor` | `docs` | `chore` | `spike`.

## Commit messages

Conventional Commits, in `language.commits`:

```
<type>(<scope>): <imperative summary, <=72 chars>

Why the change was needed. What changed at a level the diff does not show.
Anything a reviewer would otherwise have to ask about.

Refs: #123
```

Subject line: imperative mood, no trailing period. The body explains *why*; the
diff already shows *what*.

## Pull requests

Use `.agents/templates/pr.md`. Opening or pushing a PR needs explicit approval —
see `config.yml → autonomy`. A PR states what changed, why, how it was verified,
and what a reviewer should look at hardest.

## Forbidden without explicit instruction

Force-push, history rewrite, `git reset --hard` on work you did not create,
amending someone else's commit, deleting a remote branch, skipping hooks with
`--no-verify`.

## Before handing work back

Check `git status` and `git diff` and state what changed. Never leave stray
files from your own debugging — scratch work belongs outside the repo.
