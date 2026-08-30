## What

One paragraph. What changed, at the level the diff does not show.

## Why

The problem this solves. Link the issue, PRD, or ADR.

Closes #

## How

The approach, and the one or two decisions a reviewer would otherwise have to
reverse-engineer.

## Verification

Say what you actually ran, and paste the result. Not what you expect to happen.

```
<command>
<output>
```

- [ ] Lint, typecheck, build green
- [ ] Tests pass — including a new test for the new behaviour
- [ ] Security review, if this touches auth, input, money, or personal data
- [ ] Migration is backward compatible with the running version
- [ ] No secrets in the diff

## Look hardest at

Where you are least confident, and why. Directing review attention is worth more
than a clean summary.

## Not in this PR

Deliberately deferred, with a pointer to where it is tracked.

## Rollback

How to undo this if it goes wrong.
