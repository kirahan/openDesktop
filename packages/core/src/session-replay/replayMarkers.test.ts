import { describe, expect, it } from "vitest";
import { validateReplayMarkerPayload } from "./replayMarkers.js";

describe("validateReplayMarkerPayload", () => {
  it("accepts session scope without targetId", () => {
    const r = validateReplayMarkerPayload({ mergedTs: 1, scope: "session" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.scope).toBe("session");
  });

  it("requires targetId when scope is target", () => {
    const r = validateReplayMarkerPayload({ mergedTs: 1, scope: "target" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });

  it("accepts target scope with targetId", () => {
    const r = validateReplayMarkerPayload({
      mergedTs: 2,
      scope: "target",
      targetId: "T1",
      kind: "checkpoint",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.targetId).toBe("T1");
      expect(r.value.kind).toBe("checkpoint");
    }
  });
});
