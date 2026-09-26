-- Baseline: the schema as of ADR-0004 (supervisors folded into salesmen).
-- It is *created* by `applyLegacyBaseline()` in app/db/migrate.server.ts (frozen
-- raw DDL that existing databases already have), so this step only records the
-- starting point that drizzle-kit's snapshot 0000 describes.
SELECT 1;
