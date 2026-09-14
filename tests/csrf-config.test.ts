import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.dirname(fileURLToPath(import.meta.url));

describe("react-router production CSRF config", () => {
  it("allows the public ceater.cc host for UI actions behind the reverse proxy", () => {
    const src = readFileSync(
      path.join(root, "..", "react-router.config.ts"),
      "utf8",
    );
    expect(src).toMatch(/allowedActionOrigins/);
    expect(src).toMatch(/sigula\.ceater\.cc/);
  });
});
