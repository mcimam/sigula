# FRD — Admin list export and structured filters

| | |
|---|---|
| Status | approved (iteration 1 built next) |
| PRD | `docs/prd/admin-list-export-and-filters.md` |
| Date | 2026-11-20 |

## Scope

Behaviour of structured URL filters and Excel export on **admin Customer**
(iteration 1). Later lists reuse the same rules with their own filter keys.
Does not change role-dashboard Excel exports (FR-22…24).

## Actors and permissions

| Actor | Can | Cannot |
|---|---|---|
| User with `masterdata.manage` | Filter Customer list; Export; Export terpilih; see Export section on Log Audit if they also have `audit.read` | Export without list permission; invent a separate export role |
| Other roles | Unchanged | Admin list export |

## Functional requirements

| # | Requirement | Acceptance |
|---|---|---|
| FR-E1 | Customer list shall filter by salesman (`sm`) and optional team expansion (`smTeam=1` = that salesman plus `subordinateIds`) | Given salesman A with subordinate B, when `sm=A&smTeam=1`, then customers of A and B appear; without `smTeam`, only A's |
| FR-E2 | Customer list shall filter by order standing (`standing=overdue\|on_track`), tipe (`tipe=lama\|baru`), and last-order date range (`lastFrom`, `lastTo` on `last_order_date`) | Given mixed rows, each param narrows the list; invalid values are ignored |
| FR-E3 | Filters live in the URL and reset `page` to 1 when changed; they coexist with `q`, `trash`, `pageSize`, `tab` | Reloading the URL reproduces the same filtered set |
| FR-E4 | Toolbar **Export** downloads one-sheet `.xlsx` of every row matching current filters (all pages), using the chosen columns | Row count in file equals list "of N"; dates are Excel dates |
| FR-E5 | Bulk bar **Export terpilih** downloads only currently ticked ids that still match the current filters | Spoofed id outside the filter set is omitted; empty selection does not download |
| FR-E6 | Column picker offers list columns plus `id` and `createdAt`; choice is remembered per list in the browser (`localStorage`) | Toggling columns changes the next export; defaults include all |
| FR-E7 | Every successful export writes `export_logs` (actor, list key, mode filtered\|selected, filters JSON, row count, column keys, time) | Entry appears under Log Audit → Export |
| FR-E8 | Export endpoints require `masterdata.manage` | Unauthenticated / wrong permission → redirect or 403 as elsewhere |

## User flows

### Filter then export team overdue

1. Admin opens Data Master → Customer.
2. Sets salesman + "Seluruh tim", standing Overdue (and optional date range).
3. Confirms "of N" matches expectation.
4. Clicks **Export** → `.xlsx` downloads; Log Audit gains one Export row.

**Alternate:** ticks rows on the page → **Export terpilih**.  
**Error:** no matching rows → empty sheet with headers only still logs rowCount 0 (or refuse with flash — prefer headers-only + log for reproducibility).

## Business rules

| # | Rule | Applies when |
|---|---|---|
| BR-E1 | Selected export is the intersection of posted ids and the filtered live/trash set — never trust the client alone | Export terpilih |
| BR-E2 | Soft-deleted view (`trash=1`) exports only deleted customers; live view only alive | Any export |
| BR-E3 | Team expansion uses the same subtree as ADR-0004 (`subordinateIds` + self) | `smTeam=1` |
| BR-E4 | Order standing uses BR-1 (`orderStanding` / `isOverdue`) at export and list time | `standing` filter |

## Data

### URL params (Customer)

| Param | Type | Notes |
|---|---|---|
| `sm` | salesman id | Exact salesman when `smTeam` absent |
| `smTeam` | `1` | Expand to team |
| `standing` | `overdue` \| `on_track` | |
| `tipe` | `lama` \| `baru` | |
| `lastFrom` / `lastTo` | `YYYY-MM-DD` | Inclusive on `last_order_date`; null last-order excluded from ranged filter |

### `export_logs`

| Field | Type | Notes |
|---|---|---|
| listKey | text | e.g. `customer` |
| mode | `filtered` \| `selected` | |
| filters | JSON text | Snapshot of applied filters |
| rowCount | int | Rows written (data rows) |
| columnKeys | JSON text | Keys exported |
| actorId / actorName | snapshot | |
| createdAt | ISO-UTC | |

### Export columns (Customer v1)

`id`, `nama`, `salesman`, `tipeCustomer`, `orderCycleDays`, `lastOrderDate`, `daysSinceOrder`, `standing`, `statusCustomer`, `createdAt`.

## Edge cases

- `lastFrom` after `lastTo` → empty result.
- Customer never ordered + `lastFrom`/`lastTo` set → excluded.
- Unknown `sm` → empty salesman match (no rows from that filter).
- Column picker empty → fall back to all default columns on the server if none posted; client prevents empty submit.

## Out of scope (this FRD iteration)

Transaksi/Salesman/User/Audit list filters and exports; multi-sheet; CSV/PDF.
