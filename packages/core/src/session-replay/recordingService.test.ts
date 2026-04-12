import { describe, expect, it } from "vitest";
import {
  parseReplayUiCommand,
  REPLAY_UI_BINDING_NAME,
  testOnly_buildInjectExpression,
} from "./recordingService.js";

describe("parseReplayUiCommand", () => {
  it("parses segment_start and segment_end", () => {
    expect(parseReplayUiCommand(JSON.stringify({ cmd: "segment_start" }))).toEqual({
      kind: "segment_start",
      note: undefined,
    });
    expect(parseReplayUiCommand(JSON.stringify({ cmd: "segment_end", note: "a" }))).toEqual({
      kind: "segment_end",
      note: "a",
    });
  });

  it("parses checkpoint without note", () => {
    expect(parseReplayUiCommand(JSON.stringify({ cmd: "checkpoint" }))).toEqual({
      kind: "checkpoint",
      note: undefined,
    });
  });

  it("parses checkpoint with note and truncates long note", () => {
    const long = "x".repeat(600);
    const r = parseReplayUiCommand(JSON.stringify({ cmd: "checkpoint", note: long }));
    expect(r?.kind).toBe("checkpoint");
    if (r?.kind === "checkpoint") {
      expect(r.note?.length).toBe(500);
    }
  });

  it("rejects invalid note type", () => {
    expect(parseReplayUiCommand(JSON.stringify({ cmd: "checkpoint", note: 1 }))).toBeNull();
  });

  it("rejects unknown cmd", () => {
    expect(parseReplayUiCommand(JSON.stringify({ cmd: "nope" }))).toBeNull();
  });

  it("rejects invalid JSON", () => {
    expect(parseReplayUiCommand("{")).toBeNull();
  });
});

describe("testOnly_buildInjectExpression", () => {
  it("when injectControls false omits control bar and UI binding name in inject script is absent or minimal", () => {
    const s = testOnly_buildInjectExpression(50, 12_000, false);
    expect(s).not.toContain("__odReplayControlBar");
    expect(s).toContain("var controlRoot = null");
  });

  it("when injectControls true includes control bar root and UI binding calls", () => {
    const s = testOnly_buildInjectExpression(50, 12_000, true);
    expect(s).toContain("__odReplayControlBar");
    expect(s).toContain("odFromControlBar");
    expect(s).toContain(REPLAY_UI_BINDING_NAME);
    expect(s).toContain('"segment_start"');
  });
});
