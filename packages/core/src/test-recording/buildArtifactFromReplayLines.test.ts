import { describe, expect, it } from "vitest";
import { buildTestRecordingArtifactFromReplayLines } from "./buildArtifactFromReplayLines.js";
import { TEST_RECORDING_KIND } from "./artifactSchema.js";

describe("buildTestRecordingArtifactFromReplayLines", () => {
  it("merges click steps from replay lines", () => {
    const lines = [
      JSON.stringify({
        schemaVersion: 1,
        type: "pointermove",
        ts: 100,
        x: 1,
        y: 2,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
      JSON.stringify({
        schemaVersion: 1,
        type: "structure_snapshot",
        ts: 101,
        format: "text_digest",
        text: "hello",
      }),
      JSON.stringify({
        schemaVersion: 1,
        type: "click",
        ts: 200,
        x: 10,
        y: 20,
        viewportWidth: 800,
        viewportHeight: 600,
        target: { tagName: "button", id: "ok" },
      }),
    ];
    const r = buildTestRecordingArtifactFromReplayLines({
      replayLines: lines,
      appId: "app1",
      sessionId: "sess1",
      targetId: "tgt1",
      recordedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.artifact.kind).toBe(TEST_RECORDING_KIND);
    expect(r.artifact.appId).toBe("app1");
    expect(r.artifact.steps).toHaveLength(1);
    expect(r.artifact.steps[0]?.action).toBe("click");
    expect(r.artifact.steps[0]?.capture.x).toBe(10);
    expect(r.artifact.steps[0]?.capture.vectorTarget?.id).toBe("ok");
    expect(r.artifact.steps[0]?.capture.structureAnchor).toContain("hello");
    expect(r.artifact.pageContext?.viewportWidth).toBe(800);
  });

  it("returns error on bad JSON line", () => {
    const r = buildTestRecordingArtifactFromReplayLines({
      replayLines: ["not-json"],
      appId: "a",
      sessionId: "s",
      targetId: "t",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("invalid JSON");
  });
});
