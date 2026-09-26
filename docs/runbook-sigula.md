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

### Upgrade note — ERD v2 (ADR-0005 foundation + ADR-0006 notifications)

The first start of this version (the app migrates its database as soon as it opens it, i.e. at container start, before serving a single request) runs the SQL migrations from `drizzle/` (baseline, `0001` foundation, `0002`
cascade marker, `0003` notifications, `0004` access control, `0005` record comments, `0006` new reminder text, `0007` WhatsApp replies). The `drizzle/` folder is copied into the image by the `Dockerfile`; if it is
ever missing the app refuses to boot. Each migration is transactional and self-checking (rolls back on any failure
or foreign-key violation), **but the set is not reversible by rolling the code back** — an older build cannot read
the new schema. It also includes the ADR-0004 upgrade above if production is still on the old schema.

1. **Needs explicit approval** before running against production (shared migration).
2. **Check for names that differ only by case** — migration `0001` refuses to run if one salesman has two live
   customers whose names differ only by upper/lower case (the message lists them and nothing is changed). Before
   deploying, run against a copy of the DB:
   ```sql
   SELECT lower(nama), salesman_id, count(*), group_concat(id) FROM customers
   GROUP BY lower(nama), salesman_id HAVING count(*) > 1;
   ```
   Merge or rename those customers first.
3. **Back up the volume** with the app stopped (same procedure as above, e.g. `sigula-data-pre-erdv2`).
4. Deploy, then check: `/login` 200; sign in as `admin`; **Dashboard** shows the last batches (old ones read
   "manual", customers still waiting for a reply are still listed for their salesmen); **Data Master → Salesman**
   shows each WhatsApp number (now stored as a contact); **Pengaturan → Template Pesan** shows the two WhatsApp
   texts; **Data Master → any tab → Terhapus** opens (empty).
5. Behaviour that changed for operators: deleting a customer/salesman/user/transaksi now moves it to **Terhapus**
   (restorable with **Pulihkan**) instead of removing it; the dashboard's "Hapus batch" became **Batalkan pengiriman**, offered only for a send that
   delivered nothing (a message that went out cannot be cancelled); a scheduled run is no longer attributed to the first admin.
6. Rollback = restore the backup copy into the volume and check out the previous commit.

**Also in this release — access control (ADR-0007, migration `0004`).** `profiles` is replaced by roles and
permissions; every user keeps exactly the access their old role gave (the four built-in roles are seeded and each user
is given the role of the same name). After boot, sign in as each kind of user once: `admin` lands on the dashboard,
`salesman` on `/salesman`, `supervisor` on `/supervisor`, `management` on `/management`. Data Master → User now shows
roles (several can be ticked), an "Akun aktif" switch and the last sign-in. Nobody can remove, deactivate or delete the
last account that manages master data. There is no page to define new roles yet (DEBT-017).

**Also in this release — comments, reasons on the customer panel, paged logs, new reminder text (ADR-0008, migrations `0005`–`0006`).**
Every record's edit panel now has "Aktivitas & komentar" (a comment box and the log in one list, paged). A salesman gives the reason a
customer is late from the customer's panel (click a row on `/salesman`); the dashboard no longer has reason buttons. After boot: open a
customer as `admin` and post a comment; open `/salesman` as a salesman, open a customer and check the reason picker appears for a late one;
open Log Audit and page through it. `0006` makes the new reminder text the active one for salesman WhatsApp messages **only if it is still
the seeded text** — check Pengaturan → Template Pesan (an admin's own text is kept). Send yourself a test reminder before the next real one.

### Replies from WhatsApp (ADR-0009, migration `0007`)

Salesmen can answer a reminder by replying to it (`3 Kalah Harga`, `1,2 Stok Masih Ada`, or just `Kalah Harga` for every
customer of that reminder still waiting). WAHA has to call the app for that. **This is a change to the WAHA container and needs
your approval; until it is done, replies are simply not received.**

1. **Optional but recommended:** pick a long random secret and put it in the app: Pengaturan → Koneksi WAHA → *Webhook secret (HMAC)* → Simpan WAHA. With no secret the endpoint takes any call on trust, so anyone who knows the URL and a salesman's number could post a forged reply; with one, WAHA must sign its calls.
2. Point WAHA at the app — as environment of the WAHA container, then restart it:
   `WHATSAPP_HOOK_URL=https://sigula.ceater.cc/webhooks/waha` (or, from a container on this host, `http://host.containers.internal:3010/webhooks/waha`),
   `WHATSAPP_HOOK_EVENTS=message`, and — only if you set a secret — `WHATSAPP_HOOK_HMAC_KEY=<the same secret>`. WAHA retries a call that fails; the app processes each message once. If you set a secret in the app but not in WAHA (or the other way round) every call is refused with 401.
3. Check: from a salesman's phone reply `1 Kalah Harga` to a reminder. Expect a confirmation message back within seconds; the customer's
   activity shows the reason "(via WhatsApp)"; Admin → Log Audit → *Balasan WhatsApp* lists the message. A message that was not
   understood shows as "tidak dikenali" there.
4. Session name: WAHA's `session` must equal the *Session* field in Pengaturan, or its messages are ignored.
5. Anonymous senders (`@lid`) are resolved through WAHA's API; if a salesman's replies are never recognised, check Log Audit for "bukan salesman"
   and that the number in their contact is the WhatsApp number (digits are compared).

Behaviour to know: a bare reason with no number applies to *every* customer of that reminder still waiting, so a bare "Sudah Bangkrut"
deactivates all of them (the confirmation lists what was recorded; reactivating a customer is one click). Reminders sent before this
release have no line numbers stored and cannot be answered by number.

## Release checklist — ERD v2, comments, WhatsApp replies (migrations `0000`–`0009`)

Prepared 2026-09-26 and **carried out the same day** (see `.agents/work/STATE.md` for the result, the backup and the exact rollback commands). It was **not** run with the steps below in this order: the demo passwords were rotated after the deploy, in the same session. each step that changes production needs your go-ahead.
What *was* rehearsed: the production build (`npm run build`, `react-router-serve`) booted against a copy of the development
database rolled back to migration `0007`; migrations `0008`–`0009` applied on open (integrity and foreign-key checks clean),
every role's pages answered 200, other roles' pages 403, and the webhook answered 200 / 401 / 413 as designed.

**Before deploying**

1. **Rotate any account that still uses the demo password `sigula123`** — do this on the *current* production first: the
   pre-release build prints that password on the login page. Admin → Data Master → User → set a new password (≥ 8
   characters; `sigula123` is refused). Then check nobody can sign in with it.
2. Take the backup (see *Upgrade note — ERD v2* above; SQLite file + `-wal`/`-shm`, copied with the app stopped or with `.backup`).
3. Decide the WAHA webhook secret. With none, the endpoint is open to anyone who knows its URL and a salesman's number
   (DEBT-020). Recommended: set one (Pengaturan → Koneksi WAHA) and give WAHA the same `WHATSAPP_HOOK_HMAC_KEY`.
4. `NODE_ENV=production`, `SESSION_SECRET` set (the app refuses to start otherwise). No new required variables for a database that already has users.
5. Merge/push the branch (needs your approval) so the server can `git pull --ff-only`.

**Deploy** (`config.yml → commands.deploy_production`): `cd /home/sigula/sigula && git pull --ff-only && podman-compose up -d --build`.
*If the build fails at `npm ci` with `gyp ERR! … ETIMEDOUT` (DEBT-026)*: build the image by hand with `podman build --jobs 1 --network=host -t localhost/sigula_app:latest .`,
then `podman stop sigula && podman rm sigula && podman-compose up -d`. Before deploying, tag the running image (`podman tag localhost/sigula_app:latest localhost/sigula_app:pre-<release>`)
and take the backup with the app's own SQLite backup (`podman exec sigula node -e "…new Database('/app/data/sigula.db').backup('/app/data/x.db')…"`, then move the file out of the volume) — that is consistent while the app runs.

**After deploying — verify by looking, not by the exit code**

- `podman logs sigula` shows no migration error; `SELECT count(*) FROM __drizzle_migrations` is 10.
- `curl -I https://sigula.ceater.cc/login` → 200 with `x-content-type-options`, `x-frame-options`, `strict-transport-security`; the page has no "Demo:" line.
- Sign in as each kind of user: admin (Dashboard, Data Master, Log Audit, Pengaturan), salesman (`/salesman`, open a customer), supervisor, management.
- Data Master → Customer → open one → "Aktivitas & komentar" shows; post a comment.
- Pengaturan → Template Pesan: the salesman text is the new one (version 3) unless an admin had written their own.
- Send yourself a test reminder (Dashboard) before the next real one; reply to it from that phone (`1 Kalah Harga`) once WAHA is pointed at the app (see *Replies from WhatsApp*).

**Rollback.** Migrations `0001`–`0004` rebuild tables (a supervisor is a salesman, `profiles` becomes roles) and `0005`–`0009` add tables,
columns and rows: **all are one-way**, and the previous app version cannot run on the new schema. Rollback is therefore the
section below — restore the pre-deploy backup into the volume and check out the previous commit — and anything written since
the deploy is lost. This is why step 2 comes first.

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
| `WAHA_WEBHOOK_SECRET` | no (recommended) | — | HMAC key WAHA signs webhook calls with (replies). Empty = the webhook takes any caller (DEBT-020) | Admin → Pengaturan (preferred) |
| `ADMIN_USERNAME` | no | `admin` | Only for an **empty** production database: the first administrator's username | `.env` |
| `ADMIN_PASSWORD` | only for an empty database | — | Only for an **empty** production database: the first administrator's password (≥ 8 characters, not the demo one). Without it nothing is seeded. Remove it from `.env` after the first start | `.env` |

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

- Demo users (`admin` / `sigula123`) exist only where an older build seeded them. **The current build never creates
  them in production and does not print that password on the login page** — but a database seeded by an older build
  still has them: change those passwords (see the release checklist below).
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
