# ADR-0007 — Role-based access control: roles, permissions with scope, many roles per user

| | |
|---|---|
| Status | accepted (release R2 implemented on branch `feat/erd-v2-foundation`; not deployed) |
| Date | 2026-09-26 |
| Deciders | User (chat: seed roles and pick them in the user form, no role editor; keep a `supervisor` role as a permission bundle; several roles per user, checkboxes) |
| Builds on | ADR-0004 (hierarchy), ADR-0005 (foundation) |

## Context

Access was one column: `profiles.role` (`admin` / `salesman` / `supervisor` / `management`), one per user,
checked by `requireRole(request, "admin")` at ~25 route entry points, by a per-role `NAV` map, and by
`homeForRole`. A person could not be both an administrator and a salesman, "what may a supervisor do" was spread
over route files, and a `CHECK` on `profiles` was the only thing tying a role to a salesman.

## Decision

1. **Tables.** `roles`, `permissions`, `role_permissions` (each grant has a **scope**: `own` = the user's salesman,
   `team` = the salesman's subordinates at any depth, `all`) and `user_roles` (many per user). `profiles` is dropped;
   the salesman link moves to `users.salesman_id`. `users` also gains `is_active` (cannot sign in; distinct from soft
   delete) and `last_login_at`.
2. **The vocabulary lives in code** (`app/lib/permissions.ts`, 13 codes such as `masterdata.manage`,
   `customer.follow_up`, `report.team`) and is seeded by migration 0004; a test keeps the two identical. Roles are
   data: the four built-ins are seeded and reproduce, permission by permission, what each old `profiles.role` could
   reach (a test states the matrix). **No role editor** — an admin chooses roles for users; a new role or grant is a
   migration (DEBT-017).
3. **`supervisor` stays a role** (a bundle: `team.read`, `customer.reactivate`, `report.team`, all scope `team`). It is
   *not* derived from the hierarchy: a user can hold it without having subordinates, or lead a team without it.
4. **Several roles per user** (checkboxes in Data Master → User). Permissions merge; for the same permission the
   widest scope wins. A user with no role can sign in but reaches nothing (`/` answers 403).
5. **Guards.** `requirePermission(request, PERM.x)` replaces `requireRole`. Row-level checks are in
   `access.server.ts`: `assertOwnOrAll` (all → any salesman, otherwise only the user's own — used for the salesman
   dashboard, the reminder export and the team export, where "my team" is the salesman I lead) and
   `assertInTeamOrAll` (team → subordinates only, not oneself). `requireSalesmanId` refuses a user with no linked
   salesman, so a scoped role without one fails closed instead of reading as "everyone".
6. **A role needs a salesman iff it has an `own`/`team` permission.** The user form requires one then, and drops the
   link when no chosen role needs it.
7. **Navigation and landing page come from permissions.** The sidebar shows the entries the user can open, with a
   small heading per section when there are several; the landing page is the first area they can open (admin →
   management → team → salesman).
8. **Lock-out guard.** After any change, at least one live, active user must still hold `masterdata.manage`; the
   last one cannot be given another role, deactivated or deleted.

## Consequences

- **Nobody gains or loses access at migration** (0004 maps each `profiles.role` to the same-named role and moves
  `salesman_id`). Verified on a copy of the development database: every route answers as before for each old role.
- The database no longer enforces "salesman/supervisor ⇒ has a salesman" (the old `CHECK`); the application does,
  in the user form and in `requireSalesmanId` (DEBT-018). `users.salesman_id` is not unique, because `profiles`
  allowed two logins for one salesman.
- Permissions are read on every request (two small queries), so a deactivated or re-roled user is affected on their
  next request; there is no cache to invalidate.
- Adding a permission = a `PERM` entry + a migration inserting it and granting it; the catalogue test fails until both
  agree. A cross-cutting rule ("supervisors may also do X") is now a data change on a role, not a code change.
- Migration is not reversible by rolling code back (runbook).

## Alternatives rejected

- **Derive "supervisor" from the hierarchy** (offered, not chosen): would make the role impossible to disagree with the
  tree, at the cost of losing the ability to grant team access independently.
- **One role per user in the UI** (offered, not chosen): the schema allows several; the form exposes them.
- **A role/permission editor page** (offered, not chosen): larger, and needs its own safety rules; deferred.

## Verification

`tests/rbac.test.ts` (catalogue = seeded table; the role matrix; merged scopes and landing page; sessions for
inactive/deleted/salesman-deleted users; `requirePermission`; the scope helpers; user-form rules; roles diffed and
audited; the last-administrator guard; restore keeps roles) with three deliberate breakages that the tests caught;
migration 0004 backfill in `tests/migrations.test.ts`; an HTTP matrix of 14 routes × the four old roles on a copy of the
development database; the user list, the role drawer and the multi-section sidebar checked in a browser.
