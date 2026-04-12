import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(dir, "..", "dist", "inject.bundle.js");

test("inject.bundle.js exists and has minimum size after build", () => {
  assert.ok(existsSync(bundlePath), `missing ${bundlePath}`);
  const buf = readFileSync(bundlePath);
  assert.ok(buf.length > 5000, "bundle should be non-trivial size");
  assert.ok(buf.toString("utf8").includes("odOpenDesktopRrweb"), "should reference binding name");
});
