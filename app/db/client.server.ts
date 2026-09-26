import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { migrateDatabase } from "./migrate.server";
import * as schema from "./schema";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = process.env.DATABASE_PATH ?? path.join(DATA_DIR, "sigula.db");

function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrateDatabase(sqlite);
  return sqlite;
}

const sqlite = openDb();
export const db = drizzle(sqlite, { schema });
export { sqlite, DB_PATH };

/** The handle inside `db.transaction((tx) => …)`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Either the database or an open transaction — for helpers that work in both. */
export type DbHandle = typeof db | Tx;
