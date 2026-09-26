# SiGula production runbook

## What this is

SiGula tracks customer reorder cycles and nudges salesmen over WhatsApp.
If it is down, the pilot team cannot trigger reminders, import orders, or log
follow-up reasons.

## Where it runs

| Env | URL | Host | Deployed how |
|---|---|---|---|
| production | https://sigula.ceater.cc | `194.233.71.161` (`/home/sigula/sigula`) | `podman-compose` + host Caddy |

## Health

| Check | Where | Healthy looks like |
|---|---|---|
| HTTP login | `https://sigula.ceater.cc/login` | 200, login form |
| Container | `podman ps` / `podman inspect sigula --format '{{.State.Health.Status}}'` | `running` / `healthy` |
| Local bind | `curl -sI http://127.0.0.1:3010/login` | HTTP 200 |

## Deploy

```bash
cd /home/sigula/sigula
git pull --ff-only
# edit .env only if secrets/config change — never commit it
podman-compose build
podman-compose up -d
podman logs --tail 80 sigula
curl -sI http://127.0.0.1:3010/login
curl -sI https://sigula.ceater.cc/login
```

**Takes:** ~3–8 minutes (build dominated).
**Verify after:** login page over HTTPS, `admin` can sign in, trigger page loads.
Watch `podman logs -f sigula` for a few minutes.

### Upgrade note — ADR-0004 (supervisors folded into salesmen)

The first boot of this version rewrites `salesmen`, `profiles` and
`notification_deliveries` and drops `supervisors`
(`docs/adr/0004-salesman-hierarchy-replaces-supervisors.md`). It is
transactional and self-checking (aborts and rolls back on any foreign-key
violation, leaving the old schema in place), **but it is not reversible by
rolling the code back** — an older build cannot read the new schema. So:

1. Needs explicit approval before running against production (shared migration).
2. Take a file-level backup first, with the app stopped so the WAL is flushed:
   ```bash
   podman-compose stop
   podman run --rm -v sigula-data:/data -v "$PWD":/backup alpine \
     sh -c 'cp -a /data/. /backup/sigula-data-pre-adr0004/'
   podman-compose up -d
   ```
3. After boot: sign in as `admin` → Data Master → Salesman; the former
   supervisors appear as salesmen and each team's members point at them.
   Supervisor-role users log in as before. To roll back, restore the backup
   copy into the volume and check out the previous commit.

## Rollback

```bash
cd /home/sigula/sigula
git log --oneline -5
git checkout <previous-good-sha>
podman-compose build
podman-compose up -d
```

**Takes:** ~3–8 minutes.
**Data written by the new version:** SQLite lives in the `sigula-data` volume —
rollback keeps the DB unless you explicitly remove the volume.
**Rollback worked when:** `/login` returns 200 and a known-good smoke path works.

## Configuration

| Variable | Required | Default | What it does | Where the value lives |
|---|---|---|---|---|
| `SESSION_SECRET` | yes | — | Signs session cookies | `/home/sigula/sigula/.env` |
| `NODE_ENV` | yes | `production` (compose) | Enables secure cookies | compose |
| `PORT` | no | `3000` in container | Listen port inside container | compose |
| `DATABASE_PATH` | no | `data/sigula.db` | SQLite file path | optional `.env` |
| `WAHA_BASE_URL` | no | compose host-gateway URL | WhatsApp gateway | compose / Admin → Pengaturan |
| `WAHA_API_KEY` | no | — | WAHA auth | Admin → Pengaturan (preferred) |

## Logs and metrics

| What | Where |
|---|---|
| App logs | `podman logs -f sigula` |
| Caddy access/error | `/var/log/caddy.log` on the host |

## The three most likely failures

### 1. HTTPS site down / 502
- **Usually caused by:** container not running, or Caddyfile missing `sigula.ceater.cc`
- **Check:** `podman ps -a --filter name=sigula`; `curl -sI http://127.0.0.1:3010/login`; `podman exec caddy cat /etc/caddy/Caddyfile`
- **Fix:** `podman-compose up -d`; reload Caddy after Caddyfile edit

### 2. Login fails / session cookie issues
- **Usually caused by:** missing/changed `SESSION_SECRET`, or `NODE_ENV` not production behind HTTPS
- **Check:** `.env` exists and compose env shows `NODE_ENV=production`
- **Fix:** restore secret; recreate container without wiping the data volume

### 4. Login shows server error / POST /login.data 400
- **Usually caused by:** React Router CSRF — browser `Origin` is `https://sigula.ceater.cc` while `@react-router/serve` behind Caddy builds `request.url` as `http://…`
- **Check:** `podman logs sigula` for `Bad Request` on `POST /login.data`
- **Fix:** ensure `react-router.config.ts` includes `allowedActionOrigins: ["sigula.ceater.cc", …]` then rebuild

## Dependencies

| Service | What breaks without it | Degraded behaviour |
|---|---|---|
| Caddy | No public HTTPS | App still on `127.0.0.1:3010` |
| WAHA (`127.0.0.1:3002`) | Reminder send/retry fails; Pengaturan → Sesi WhatsApp shows "WAHA tidak terjangkau" | Tracking/import/logging still work |
| SQLite volume `sigula-data` | Data loss if removed | — |

## Escalation

| Situation | Who |
|---|---|
| VPS / DNS / Caddy | Infra owner for `ceater.cc` |
| Product / seed users | SiGula admin |

## Things that look alarming but are fine

- First boot seeds demo users (`admin` / `sigula123`) — change passwords before
  sharing the URL widely.
- WAHA optional at boot; configure under Admin → Pengaturan.
- **WhatsApp login** (first time, or after the phone logs the device out): Admin → Pengaturan →
  Koneksi WAHA → *Sesi WhatsApp* → Login, scan the QR (WhatsApp → Perangkat tertaut). The
  *Session* field must equal the session name WAHA actually has (`waha.ceater.cc` had `Sigula`, not
  `default`, on 2026-09-26) — a wrong name shows "Sesi belum dibuat", and Login would create a
  second session.
  Logout drops the linked number; reminders stop until the next Login + scan.
- WAHA answers **403** (not 404) for a session that does not exist, so a 403 on
  `GET /api/sessions/<name>` does not by itself mean the API key is wrong; the app reads the
  session list instead.
