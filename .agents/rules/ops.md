# Operations rules

Applies to anything that runs outside your own machine.

## The approval boundary

Set in `config.yml → autonomy`. Restated because it is the rule most costly to
get wrong:

**Proceed freely:** read, search, edit source and tests, install, build, lint,
format, typecheck, test, deploy to local or staging.

**Stop and ask, every time:** production deploy, migration against a shared
environment, rollback, secret or infrastructure change, deleting files or data,
adding a runtime dependency, pushing or opening a PR, anything that costs money
or is visible outside this repo.

Approval in one context does not carry to the next. "Deploy to prod" approved on
Tuesday does not authorise Thursday's deploy.

## Configuration

- Config comes from the environment. The same artifact runs in every
  environment, differing only by what it is handed at start.
- Every variable the app reads is documented with type, default, and whether it
  is required. An app that fails at 3am for a missing env var should say which.
- Fail fast and loudly at startup on missing required config — never fall back
  to a default that silently points somewhere wrong.

## Migrations

Expand → deploy → contract. A migration must be backward compatible with the
version currently running, because during a rollout both versions exist. Every
migration has a tested down path, or a written statement that it is one-way and
why that is acceptable.

## Releases

- Rollback is written down before the rollout, not improvised during it.
- Deploys are verified by observation — health check, smoke the critical path,
  watch the logs — not by the deploy command exiting zero.
- If a release must be undone, undoing it comes first and the diagnosis second.

## Incidents

Mitigate, then diagnose. Keep a timeline as you go — memory of an incident is
reliably wrong afterwards. Once resolved, the fix gets a regression test and the
cause gets recorded. A recurring incident is a design defect, not bad luck.
