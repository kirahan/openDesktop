import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_MAX_GLOBAL_KEYS,
  buildGlobalSnapshotExpression,
  DEFAULT_MAX_GLOBAL_KEYS,
  MAX_INTEREST_PATTERN_LENGTH,
  normalizeSnapshotResult,
  parseInterestPattern,
} from "./rendererGlobalSnapshot.js";

describe("parseInterestPattern", () => {
  it("accepts undefined", () => {
    expect(parseInterestPattern(undefined)).toEqual({ ok: true, pattern: undefined });
  });

  it("accepts valid pattern", () => {
    const r = parseInterestPattern("^acquire");
    expect(r.ok && r.pattern).toBe("^acquire");
  });

  it("rejects invalid RegExp", () => {
    const r = parseInterestPattern("[");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("invalid interestPattern");
  });

  it("rejects non-string", () => {
    const r = parseInterestPattern(1);
    expect(r.ok).toBe(false);
  });

  it("rejects overly long pattern", () => {
    const r = parseInterestPattern("a".repeat(MAX_INTEREST_PATTERN_LENGTH + 1));
    expect(r.ok).toBe(false);
  });
});

describe("buildGlobalSnapshotExpression", () => {
  it("embeds maxKeys and null interest", () => {
    const expr = buildGlobalSnapshotExpression(100, undefined);
    expect(expr).toContain("var maxKeys = 100");
    expect(expr).toContain("var interestSource = null");
  });

  it("embeds interest as JSON string literal", () => {
    const expr = buildGlobalSnapshotExpression(DEFAULT_MAX_GLOBAL_KEYS, "foo");
    expect(expr).toContain(JSON.stringify("foo"));
  });
});

describe("normalizeSnapshotResult", () => {
  it("accepts well-formed snapshot", () => {
    const r = normalizeSnapshotResult({
      collectedAt: "t",
      locationHref: "http://x",
      userAgent: "ua",
      globalNames: ["a"],
      entries: [{ name: "a", kind: "number" }],
      truncated: false,
    });
    if (!("snapshot" in r)) throw new Error("expected snapshot");
    expect(r.snapshot.globalNames).toEqual(["a"]);
  });

  it("rejects non-object", () => {
    const r = normalizeSnapshotResult(null);
    expect("error" in r).toBe(true);
  });
});

describe("ABSOLUTE_MAX_GLOBAL_KEYS", () => {
  it("is capped in expression", () => {
    const expr = buildGlobalSnapshotExpression(ABSOLUTE_MAX_GLOBAL_KEYS + 99999, undefined);
    expect(expr).toContain(`var maxKeys = ${ABSOLUTE_MAX_GLOBAL_KEYS}`);
  });
});
