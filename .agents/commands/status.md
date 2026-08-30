---
description: Report where the project stands — track, phase, open threads, drift
---

Report the current state of this project. Do not change anything.

1. Read `.agents/config.yml`, `.agents/work/STATE.md`, and
   `.agents/work/DEBT.md`.
2. Check `git status` and `git diff --stat` for uncommitted work.
3. Report:

```
Project:   <name> — <one-line summary>
Track:     <track>  (definition of done: <from the track file>)
Phase:     <current phase>
Focus:     <what is actively being worked on>

Open threads:     <what is unfinished>
Debt:             <open (b blocker/m major/mi minor), + implicit, next to pay>
Unconfigured:     <commands.* still ""> 
Placeholders:     <any <PLACEHOLDER> left in context/>
Uncommitted:      <files changed>
```

4. Flag drift explicitly: does `STATE.md` still match what is actually in the
   repo, and do its debt counters match `DEBT.md`? If not, say where they
   disagree — a stale STATE is worse than an empty one, because it gets trusted.
   Run `/debt` for the full reconciliation against code.

End with the single most useful next action, and why that one.
