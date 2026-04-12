import { describe, expect, it } from "vitest";
import {
  filterNonStructureReplayLines,
  parseStructureSnapshotsFromReplayLines,
} from "./structureSnapshotTree.js";

describe("parseStructureSnapshotsFromReplayLines", () => {
  it("extracts text_digest snapshots", () => {
    const snapLine = JSON.stringify({
      schemaVersion: 1,
      type: "structure_snapshot",
      ts: 99,
      format: "text_digest",
      text: "a\nb",
    });
    const lines = [
      '{"schemaVersion":1,"type":"pointermove","ts":1,"x":0,"y":0,"viewportWidth":100,"viewportHeight":100}',
      snapLine,
    ];
    const snaps = parseStructureSnapshotsFromReplayLines(lines);
    expect(snaps.length).toBe(1);
    expect(snaps[0]?.ts).toBe(99);
    expect(snaps[0]?.text).toBe("a\nb");
  });
});

describe("filterNonStructureReplayLines", () => {
  it("drops structure_snapshot lines", () => {
    const lines = [
      '{"type":"click","ts":1}',
      '{"type":"structure_snapshot","format":"text_digest","text":"x"}',
    ];
    expect(filterNonStructureReplayLines(lines).length).toBe(1);
    expect(filterNonStructureReplayLines(lines)[0]).toContain("click");
  });
});
