import { describe, expect, it } from "vitest";
import {
  isNativeAccessibilityTreeActionEnabled,
  nativeAccessibilityAtPointDisabledReason,
  nativeAccessibilityTreeDisabledReason,
} from "./nativeAccessibilityObservability.js";

describe("nativeAccessibilityTree UI gate", () => {
  it("disables when capability missing", () => {
    expect(
      nativeAccessibilityTreeDisabledReason([], { state: "running", pid: 1 }),
    ).toBeTruthy();
    expect(isNativeAccessibilityTreeActionEnabled([], { state: "running", pid: 1 })).toBe(false);
  });

  it("enables when capability + running + pid", () => {
    expect(
      nativeAccessibilityTreeDisabledReason(["native_accessibility_tree"], { state: "running", pid: 42 }),
    ).toBeNull();
    expect(
      isNativeAccessibilityTreeActionEnabled(["native_accessibility_tree"], { state: "running", pid: 42 }),
    ).toBe(true);
  });

  it("disables when not running", () => {
    expect(
      nativeAccessibilityTreeDisabledReason(["native_accessibility_tree"], { state: "starting", pid: 1 }),
    ).toContain("运行");
    expect(
      isNativeAccessibilityTreeActionEnabled(["native_accessibility_tree"], { state: "starting", pid: 1 }),
    ).toBe(false);
  });

  it("disables when pid missing or invalid", () => {
    expect(
      nativeAccessibilityTreeDisabledReason(["native_accessibility_tree"], { state: "running" }),
    ).toContain("PID");
    expect(
      isNativeAccessibilityTreeActionEnabled(["native_accessibility_tree"], { state: "running", pid: 0 }),
    ).toBe(false);
  });
});

describe("nativeAccessibilityAtPointDisabledReason", () => {
  it("requires capability", () => {
    expect(nativeAccessibilityAtPointDisabledReason([], { state: "running", pid: 1 })).toContain(
      "native_accessibility_at_point",
    );
  });

  it("allows when capability and running and pid", () => {
    expect(
      nativeAccessibilityAtPointDisabledReason(["native_accessibility_at_point"], { state: "running", pid: 2 }),
    ).toBeNull();
  });
});
