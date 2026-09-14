import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Must run before any app module opens SQLite.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigula-vitest-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
process.env.SESSION_SECRET = "test-secret";
