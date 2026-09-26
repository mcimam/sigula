import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit only *generates* migrations from `app/db/schema.ts`
 * (`npm run db:generate`). Applying them is `app/db/migrations.server.ts`,
 * which wraps each one in a foreign-key-safe transaction (see ADR-0005).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./app/db/schema.ts",
  out: "./drizzle",
});
