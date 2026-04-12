import { describe, expect, it } from "vitest";
import {
  parseTestRecordingArtifact,
  TEST_RECORDING_KIND,
  TEST_RECORDING_SCHEMA_VERSION,
} from "./artifactSchema.js";

describe("parseTestRecordingArtifact", () => {
  it("accepts minimal valid artifact", () => {
    const v = parseTestRecordingArtifact({
      schemaVersion: TEST_RECORDING_SCHEMA_VERSION,
      kind: TEST_RECORDING_KIND,
      recordedAt: "2026-01-01T00:00:00.000Z",
      appId: "my-app",
      sessionId: "s1",
      targetId: "t1",
      steps: [
        {
          ts: 1,
          action: "click",
          capture: { x: 0, y: 0 },
        },
      ],
    });
    expect(v).not.toBeNull();
    expect(v?.appId).toBe("my-app");
    expect(v?.steps[0]?.capture.x).toBe(0);
  });

  it("rejects missing appId", () => {
    expect(
      parseTestRecordingArtifact({
        schemaVersion: TEST_RECORDING_SCHEMA_VERSION,
        kind: TEST_RECORDING_KIND,
        recordedAt: "2026-01-01T00:00:00.000Z",
        sessionId: "s1",
        targetId: "t1",
        steps: [{ ts: 1, action: "click", capture: { x: 0, y: 0 } }],
      }),
    ).toBeNull();
  });

  it("rejects invalid vectorTarget", () => {
    expect(
      parseTestRecordingArtifact({
        schemaVersion: TEST_RECORDING_SCHEMA_VERSION,
        kind: TEST_RECORDING_KIND,
        recordedAt: "2026-01-01T00:00:00.000Z",
        appId: "a",
        sessionId: "s1",
        targetId: "t1",
        steps: [
          {
            ts: 1,
            action: "click",
            capture: { x: 0, y: 0, vectorTarget: { tagName: "" } },
          },
        ],
      }),
    ).toBeNull();
  });
});
