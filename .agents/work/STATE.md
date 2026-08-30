# Project state

> The agent reads this at the start of every session to find out where things
> stand. Keep it current — a stale STATE is worse than an empty one, because it
> gets trusted. Update on: phase change, iteration end, shortcut taken, deploy.

| | |
|---|---|
| Project | `<PROJECT_NAME>` |
| Track | `<poc / production>` |
| Phase | `<requirement / design / development / testing / deployment / maintenance>` |
| Updated | `<YYYY-MM-DD>` |

## Now

What is actively being worked on. One or two lines.

## Problem statement

From the Requirement phase. The problem, stated without a solution.

## Success criteria

- 

## Non-goals

- 

## Open unknowns

Questions that are not yet answered, and what they block.

| Unknown | Blocks | Owner |
|---|---|---|

## Task list

Current iteration, ordered. Riskiest first.

- [ ] 

## Debt

The ledger lives in [`DEBT.md`](DEBT.md) — this is the summary. Refresh with
`/debt`; if these numbers disagree with the ledger, the ledger is right.

| | |
|---|---|
| Open | `<n>` — `<b>` blocker, `<m>` major, `<mi>` minor |
| Accepted | `<n>` |
| Implicit | `<n>` gates skipped that `production` requires |
| Estimate | `<sum of open fix costs>` |
| Next to pay | `<DEBT-NNN — why this one>` |

## Deployed

| Env | Version | Deployed | Rollback |
|---|---|---|---|

## Decisions log

Cross-references to ADRs, plus small calls that did not warrant one.

| Date | Decision | Where recorded |
|---|---|---|

## Parked

Things deliberately set aside, with the condition that would revive them.

- 
