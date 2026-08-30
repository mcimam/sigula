# Technical Design — <Feature name>

| | |
|---|---|
| Status | draft / approved / built |
| FRD | `docs/frd/<file>.md` |
| Date | YYYY-MM-DD |

## Summary

Three sentences: what is being built, the approach, and the one decision that
most shapes it.

## Context

What already exists that this fits into. Constraints inherited from it.

## Components

| Component | Responsibility (one sentence, no "and") | Owns | New/changed |
|---|---|---|---|

## Boundaries

What crosses between components and in what form. Get these right; insides are
cheap to rewrite, seams are not.

| From → To | Carries | Via | Sync/async | Failure behaviour |
|---|---|---|---|---|

## Data model

| Entity | Fields | Keys | Relationships | Lifecycle |
|---|---|---|---|---|

**Migration:** what changes in the existing schema, and how it stays backward
compatible during rollout.

**Must never be lost:** 

## Interfaces

```
<endpoint / function signature / message schema>
  in:     
  out:    
  errors: 
```

## Sequence — the critical path

```
<caller> → <component> → <component> → <store>
```

Where it can fail at each hop, and what happens then.

## Decisions

| Decision | Chosen | Rejected, and why | ADR |
|---|---|---|---|

## Failure modes

| What fails | Detected how | Behaviour | Recovery |
|---|---|---|---|

## Security considerations

Trust boundaries, untrusted input paths, authz checkpoints, what is sensitive.

## Testing approach

What is unit-tested, what is integration-tested, what needs a manual check and
why it cannot be automated.

## Task breakdown

Ordered by dependency, riskiest first.

| # | Task | Depends on | Verifiable by |
|---|---|---|---|

## What this makes harder later

Honest section. Every design closes some doors — name them.
