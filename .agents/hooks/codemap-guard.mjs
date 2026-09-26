#!/usr/bin/env node
// Stop hook — a turn that leaves code changes newer than the code map may not end.
//
// Rule: every change to code (or its build/test/deploy config) must be reflected
// in `.agents/context/codemap.md` in the same change. "Reflected" is checked
// mechanically: any uncommitted code file whose mtime is newer than the map's.
// An honest "nothing structural changed" still means bumping the map's
// `Last synced` line, so the review is recorded.
//
// Gate (resolved like every other gate — see .agents/workflow/README.md):
//   config.yml → overrides.development.codemap_update
//     required     block the stop until the map is updated (default)
//     recommended  warn the user, never block
//     skip         do nothing
//
// Loop safety: when Claude is already continuing because of this hook
// (`stop_hook_active`), it never blocks again — it only warns.
//
// Fails open: not a git repo, git missing, or unreadable input → allow the stop.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// What counts as "code". Keep in sync with the "Directory layout" in the map.
const CODE_PATHS = [
  "app",
  "tests",
  "Dockerfile",
  "docker-compose.yml",
  "package.json",
  "react-router.config.ts",
  "vite.config.ts",
  "vitest.config.ts",
];
const DEFAULT_CODEMAP = ".agents/context/codemap.md";
const MAX_LISTED = 8;

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function readConfig(root) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, ".agents", "config.yml"), "utf8");
  } catch {
    /* no config → defaults */
  }
  // Line regexes are enough for two flat keys; commented lines start with `#`
  // and never match `^\s*key`.
  const gate = text.match(/^\s*codemap_update:\s*([A-Za-z-]+)/m)?.[1] ?? "required";
  const codemap = text.match(/^\s+codemap:\s*(\S+)/m)?.[1] ?? DEFAULT_CODEMAP;
  return { gate, codemap };
}

/** Uncommitted (modified, deleted, or untracked) files under CODE_PATHS, or null if git can't tell. */
function dirtyCodeFiles(root) {
  try {
    const out = execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", ...CODE_PATHS],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(3)); // "XY <path>"
  } catch {
    return null;
  }
}

/** mtime of a file; for a deleted file, of the nearest surviving parent directory (its removal bumps it). */
function mtimeMs(root, rel) {
  let current = path.join(root, rel);
  while (current.length >= root.length) {
    try {
      return fs.statSync(current).mtimeMs;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return 0;
}

const input = readInput();
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const { gate, codemap } = readConfig(root);
if (gate === "skip") process.exit(0);

const dirty = dirtyCodeFiles(root);
if (!dirty || dirty.length === 0) process.exit(0);

const mapTime = mtimeMs(root, codemap);
const stale = dirty.filter((file) => mtimeMs(root, file) > mapTime);
if (stale.length === 0) process.exit(0);

const listed = stale.slice(0, MAX_LISTED).join(", ");
const more = stale.length > MAX_LISTED ? ` (+${stale.length - MAX_LISTED} more)` : "";

if (input.stop_hook_active || gate === "recommended") {
  process.stdout.write(
    JSON.stringify({
      systemMessage: `⚠ Kode berubah tetapi ${codemap} belum diperbarui: ${listed}${more}`,
    }),
  );
  process.exit(0);
}

process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason:
      `Code changed after ${codemap} was last updated: ${listed}${more}. ` +
      `Project rule: every code change updates the code map in the same change. ` +
      `Compare the map with what you changed and edit every section that is now wrong ` +
      `(files, routes, tables, function contracts, tests, recipes, quirks). ` +
      `If nothing structural changed, still update the "Last synced" line with a one-line note. ` +
      `Then finish. (Gate: config.yml → overrides.development.codemap_update.)`,
  }),
);
