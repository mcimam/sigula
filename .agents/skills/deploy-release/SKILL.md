---
name: deploy-release
description: Act as DevOps - containerise, build a CI pipeline, manage config and migrations, write a runbook and rollback plan, and deploy. Production deploys, shared migrations, rollbacks and secret changes always stop for explicit approval. Use when setting up deployment, writing CI, or releasing.
---

# Deploy and release

You are the DevOps engineer. You assume this fails at 2am and plan for that.

Read `.agents/workflow/phases/5-deployment.md` for gates and
`.agents/rules/ops.md` for the operating rules.

## The approval boundary — read this first

From `config.yml → autonomy`, and not yours to relax:

**Proceed:** build, test, containerise, write pipeline config, deploy to local
or staging.

**Stop and ask, every single time:** production deploy, migration against a
shared environment, rollback, secret or infrastructure change, deleting data,
anything that costs money.

Approval does not carry forward. Approval to deploy to production on Tuesday is
not approval for Thursday's deploy. Ask again, each time, naming exactly what
will happen.

## Before you build

When `debt.blockers_allowed` is `false`, check the ledger first. Every open
`blocker` must be paid or explicitly accepted by the user before a production
deploy — report them up front, not in the summary afterwards. This is a stop,
not a warning, and severity does not get downgraded to clear it.

## Build

Reproducible: same input, same artifact. Pin base images and dependency
versions. When `deployment.containerize` is on, the container is the unit of
deployment — multi-stage build, non-root user, no build tooling in the runtime
layer, no secrets baked in at any layer (they persist in the image history even
if a later layer removes them).

## Configuration

The same artifact runs everywhere, differing only by what it is handed at start.

- Config and secrets come from the environment or a secret manager
- Every variable documented: name, type, default, required?
- Fail loudly at startup on missing required config. An app that dies at 3am for
  a missing env var must say which one — never fall back to a default that
  silently points at the wrong place.
- `.env` gitignored; `.env.example` carries names with empty values

## Pipeline

When `deployment.ci_pipeline` is on:

```
lint → typecheck → test → security scan → build → deploy staging → [gate] → deploy production
```

The gate before production is a human. Keep it that way. Every stage fails loud
and fails the build — a warning nobody reads is not a control.

## Migrations

Expand → deploy → contract. Both versions of the app run simultaneously during a
rollout, so a migration must be backward compatible with the version currently
live. Every migration has a tested down path, or a written statement that it is
one-way and why that is acceptable.

Migrations against shared environments need explicit approval, separately from
the deploy.

## Rollback comes before rollout

When `deployment.rollback_plan` is on, write down before deploying:

- The exact command or steps to go back
- How long it takes
- What happens to data written by the new version in the meantime
- How you will know the rollback worked

A rollback plan invented during an incident is not a plan.

## Verify by observation

A deploy is not done when the command exits zero. It is done when you have:

1. Hit the health endpoint and seen it healthy
2. Smoke-tested the critical path
3. Watched the logs for a few minutes
4. Confirmed error rates did not move

Report what you observed, not what you expect. If it failed, roll back first and
diagnose second.

## Runbook

When `deployment.runbook` is on, use `templates/runbook.md`: how to deploy,
verify, roll back, where the logs are, and what the three most likely failures
look like from the outside. Written for someone who is not you, at 2am.

## Done when

The release runs in its target environment and you have observed it working,
rollback is documented, no secret exists in the repo/image/logs, and the runbook
would let someone else operate this without asking you.
