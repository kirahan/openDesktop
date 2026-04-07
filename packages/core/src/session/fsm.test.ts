import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./fsm.js";

describe("session FSM", () => {
  it("allows pending -> starting", () => {
    expect(canTransition("pending", "starting")).toBe(true);
  });

  it("disallows running -> starting", () => {
    expect(canTransition("running", "starting")).toBe(false);
  });

  it("assertTransition throws on invalid", () => {
    expect(() => assertTransition("running", "pending")).toThrow("INVALID_TRANSITION");
  });
});
