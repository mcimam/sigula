import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A migrations folder holding only the first `count` real migrations. */
export function firstMigrations(count: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigula-partial-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const kept = journal.entries.slice(0, count);
  for (const e of kept) fs.copyFileSync(path.join("drizzle", `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: kept }));
  return dir;
}
