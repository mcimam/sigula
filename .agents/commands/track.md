---
description: Show or switch the active rigor track, and report what changes
argument-hint: [poc|production|<custom track id>]
---

Manage the active track: **$ARGUMENTS**

## With no argument

Read `.agents/config.yml` and `.agents/workflow/tracks/<active>.yml`. Report the
active track, its intent, its definition of done, and its gate table per phase.
List which gates are currently overridden in `config.yml → overrides`.

## With a track id

1. Confirm `.agents/workflow/tracks/<id>.yml` exists. If not, list what does and
   stop.
2. **Show the diff before changing anything** — which gates move, per phase:

```
requirement.grilling_depth   light → deep
design.prd                   skip  → required
testing.security_review      skip  → required
...
```

3. Run the promotion analysis via the `debt-tracking` skill:
   - regenerate implicit debt against the **new** track's gates
   - list open entries at or above `debt.promotion_blocker` — these must be paid
     or explicitly accepted before the promotion means anything
   - total the fix costs, so the promotion carries a number rather than a vibe
   - present it as ordered work, blockers first
   That ledger is the whole point of recording shortcuts — surface it here.
4. Ask for confirmation, then set `track:` in `config.yml` and note the change
   with its date in `STATE.md`.

Switching track never rewrites existing code or documents. It changes the bar
for work from here on. Say that explicitly so nobody expects a retroactive
upgrade.
