import { describe, expect, it } from "vitest";
import { parseReplayEnvelope, parseReplayEnvelopeJsonString, REPLAY_SCHEMA_VERSION } from "./schema.js";

describe("parseReplayEnvelope", () => {
  it("accepts pointermove with viewport", () => {
    const v = parseReplayEnvelope({
      schemaVersion: REPLAY_SCHEMA_VERSION,
      type: "pointermove",
      ts: 1,
      x: 10,
      y: 20,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(v).not.toBeNull();
    expect(v?.type).toBe("pointermove");
    if (v?.type === "pointermove") {
      expect(v.x).toBe(10);
      expect(v.y).toBe(20);
      expect(v.viewportWidth).toBe(800);
      expect(v.viewportHeight).toBe(600);
    }
  });

  it("rejects missing viewport dimensions", () => {
    expect(
      parseReplayEnvelope({
        schemaVersion: REPLAY_SCHEMA_VERSION,
        type: "pointermove",
        ts: 1,
        x: 0,
        y: 0,
      }),
    ).toBeNull();
  });

  it("rejects non-finite coordinates", () => {
    expect(
      parseReplayEnvelope({
        schemaVersion: REPLAY_SCHEMA_VERSION,
        type: "click",
        ts: 1,
        x: NaN,
        y: 0,
        viewportWidth: 1,
        viewportHeight: 1,
      }),
    ).toBeNull();
  });

  it("accepts structure_snapshot", () => {
    const v = parseReplayEnvelope({
      schemaVersion: REPLAY_SCHEMA_VERSION,
      type: "structure_snapshot",
      ts: 2,
      format: "text_digest",
      text: "hello",
    });
    expect(v?.type).toBe("structure_snapshot");
  });

  it("rejects wrong schema version", () => {
    expect(parseReplayEnvelope({ schemaVersion: 99, type: "click", ts: 1, x: 0, y: 0, viewportWidth: 1, viewportHeight: 1 })).toBeNull();
  });
});

describe("parseReplayEnvelopeJsonString", () => {
  it("parses valid JSON string", () => {
    const s = JSON.stringify({
      schemaVersion: REPLAY_SCHEMA_VERSION,
      type: "click",
      ts: 3,
      x: 4,
      y: 5,
      viewportWidth: 100,
      viewportHeight: 200,
    });
    const v = parseReplayEnvelopeJsonString(s);
    expect(v?.type).toBe("click");
  });

  it("returns null on invalid JSON", () => {
    expect(parseReplayEnvelopeJsonString("{")).toBeNull();
  });

  it("accepts docs API.md pointermove example", () => {
    const raw = `{
  "schemaVersion": 1,
  "type": "pointermove",
  "ts": 1712812800000,
  "x": 120.5,
  "y": 64,
  "viewportWidth": 1280,
  "viewportHeight": 720
}`;
    const v = parseReplayEnvelopeJsonString(raw);
    expect(v?.type).toBe("pointermove");
  });
});
