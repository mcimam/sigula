# Technical Design — Admin list export and structured filters

| | |
|---|---|
| Status | approved (iteration 1) |
| FRD | `docs/frd/admin-list-export-and-filters.md` |
| Date | 2026-11-20 |

## Summary

Add URL filters and Excel export on the admin Customer list, with shared
modules for later lists. Downloads go through a dedicated resource route;
auditing uses a new `export_logs` table. The shaping decision is
**server-side filter + id intersection** so the file never trusts the browser.

## Context

- List UI: `admin.masterdata.tsx`, `TableSearch` / `DataTable`, in-memory
  `listLiveCustomers` + `paginate`.
- Excel: `exceljs` already used in `reports.server.ts`.
- Audit: `activity_logs` is per-record mutate trail — unsuitable for list
  exports (ADR-0010).

## Components

| Component | Responsibility | Owns | New/changed |
|---|---|---|---|
| `list-filters/customer.ts` | Parse URL params and filter customer rows | Filter contract | New |
| `export.server.ts` | Build one-sheet xlsx; write `export_logs` | Workbook + log | New |
| `ListFilterBar.tsx` | Customer filter controls → URL | Filter UX | New |
| `ExportToolbar.tsx` | Export link + column picker (localStorage) | Column choice | New |
| `admin.export.customer.tsx` | GET/POST download | Auth + response | New |
| `admin.masterdata.tsx` | Apply filters before paginate; wire UI | Customer tab | Changed |
| `admin.audit.tsx` | Export log section | Listing | Changed |
| `schema` + migration 0010 | `export_logs` | Persistence | New |

## Boundaries

| From → To | Carries | Via | Failure |
|---|---|---|---|
| Browser → export route | Filter query / selected ids + column keys | GET/POST | 401/403; spoofed ids dropped |
| Export route → `export.server` | Rows + columns + actor | Sync call | Throw → 500 |
| Export route → DB | Log row | Sync insert | Fail export if log fails (prefer durable audit) |
| Browser → masterdata | Filter URL | GET navigation | Invalid params ignored |

## Data model

| Entity | Fields | Lifecycle |
|---|---|---|
| `export_logs` | id, list_key, mode, filters, row_count, column_keys, actor_id, actor_name, created_at | Append-only; never updated/deleted |

**Migration:** `drizzle/0010_export_logs.sql` — create table only; no data backfill.

**Must never be lost:** export audit rows (same retention expectation as activity).

## Interfaces

```
parseCustomerFilters(url: URLSearchParams) → CustomerFilters

applyCustomerFilters(rows, filters, opts: {
  salesmanNama: Map<id, nama>,
  teamIds?: Set<number>,  // precomputed when smTeam
  today?: string
}) → rows

buildCustomerExportXlsx(rows, columnKeys) → Buffer

logExport({ listKey, mode, filters, rowCount, columnKeys, actorId }) → void

GET  /admin/export/customer?<filters>&cols=a,b
POST /admin/export/customer  form: id*, cols?, same filter fields
  → application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

## Sequence — filtered export

1. Admin sets filters → URL updates → loader filters then paginates.
2. Admin clicks Export → GET resource with filter params + `cols`.
3. Server reloads live/trash set, applies same filter helper, builds xlsx.
4. Inserts `export_logs`, returns file bytes.

## Architecture review (against this design)

**Attack — volume:** in-memory list + sync xlsx will hurt if the pilot grows
10–100×. Acceptable now (PRD assumption); revisit with SQL `WHERE` + streaming
if lists exceed comfortable RAM.

**Attack — selected spoofing:** client could POST arbitrary ids. Mitigated by
intersecting with the filtered set (BR-E1).

**Attack — stuffing activity_logs:** rejected in ADR-0010; keeps mutate trail
clean.

## Ordered tasks (iteration 1)

1. Docs (this set + ADR-0010)
2. Schema + migration + `logExport`
3. Customer filter parse/apply + ListFilterBar + masterdata loader
4. ExportToolbar + resource route + Export terpilih
5. Audit section
6. Tests + typecheck + STATE/codemap
