import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { resolveBundledWebDistFromCliDir } from "./resolveBundledWebDist.js";

describe("resolveBundledWebDistFromCliDir", () => {
  it("returns web-dist path when index.html exists beside dist parent layout", () => {
    const root = mkdtempSync(join(tmpdir(), "od-web-"));
    try {
      const distDir = join(root, "dist");
      const webDist = join(root, "web-dist");
      mkdirSync(distDir, { recursive: true });
      mkdirSync(webDist, { recursive: true });
      writeFileSync(join(webDist, "index.html"), "<!doctype html><html></html>");
      const got = resolveBundledWebDistFromCliDir(distDir);
      assert.equal(got, webDist);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns undefined when web-dist missing", () => {
    const root = mkdtempSync(join(tmpdir(), "od-noweb-"));
    try {
      const distDir = join(root, "dist");
      mkdirSync(distDir, { recursive: true });
      assert.equal(resolveBundledWebDistFromCliDir(distDir), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns undefined when web-dist exists but index.html missing", () => {
    const root = mkdtempSync(join(tmpdir(), "od-noindex-"));
    try {
      const distDir = join(root, "dist");
      mkdirSync(join(root, "web-dist"), { recursive: true });
      mkdirSync(distDir, { recursive: true });
      assert.equal(resolveBundledWebDistFromCliDir(distDir), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
