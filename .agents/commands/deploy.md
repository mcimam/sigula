---
description: Act as DevOps — build, configure, and deploy (production always asks first)
argument-hint: <local|staging|production>
---

Run the **Deployment** phase targeting: **$ARGUMENTS**

1. Read `.agents/config.yml` (`commands`, `autonomy`),
   `.agents/workflow/phases/5-deployment.md`, and `.agents/rules/ops.md`.
2. Invoke the `deploy-release` skill.
3. Confirm the gates the track requires: containerise, CI pipeline, IaC, runbook,
   rollback plan, observability.
4. If `debt.blockers_allowed` is `false`, check `DEBT.md` for open `blocker`
   entries and report them **before** deploying. They must be paid or explicitly
   accepted first.

## The boundary

- **local / staging** — proceed.
- **production** — stop. State exactly what will happen, what the rollback is,
  and what it affects. Wait for explicit approval. Same for any migration against
  a shared environment, any rollback, and any secret or infrastructure change.

Approval does not carry forward from a previous deploy. Ask again, every time.

## After deploying

Verify by observation, not by exit code: health endpoint, smoke the critical
path, watch the logs, check error rates. Report what you observed. If it failed,
roll back first and diagnose second.

Then update `.agents/work/STATE.md`: what is running where, which version, how to
roll it back.
