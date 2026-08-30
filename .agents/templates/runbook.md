# Runbook — <Service name>

Written for someone who is not you, at 2am, without your context.

## What this is

One sentence. What it does, and what breaks for users if it is down.

## Where it runs

| Env | URL | Host / cluster | Deployed how |
|---|---|---|---|

## Health

| Check | Where | Healthy looks like |
|---|---|---|

## Deploy

```bash
<exact commands>
```

**Takes:** ~N minutes.
**Verify after:** health endpoint, smoke the critical path, watch logs N minutes,
check error rate.

## Rollback

```bash
<exact commands>
```

**Takes:** ~N minutes.
**Data written by the new version in the meantime:** <what happens to it>
**Rollback worked when:** <what you observe>

## Configuration

| Variable | Required | Default | What it does | Where the value lives |
|---|---|---|---|---|

## Logs and metrics

| What | Where | Useful query |
|---|---|---|

## The three most likely failures

### 1. <Symptom as an operator sees it>
- **Looks like:** 
- **Usually caused by:** 
- **Check:** 
- **Fix:** 
- **If that does not work:** 

### 2. …

### 3. …

## Dependencies

| Service | What breaks without it | Degraded behaviour |
|---|---|---|

## Escalation

| Situation | Who | How |
|---|---|---|

## Things that look alarming but are fine

Saves an hour of panic. Fill it in as you learn them.

- 
