import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

describe("documentation links", () => {
  it("verify-doc-links script exits 0", () => {
    const root = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
    execSync("node scripts/verify-doc-links.mjs", { cwd: root, stdio: "pipe" });
  });
});
