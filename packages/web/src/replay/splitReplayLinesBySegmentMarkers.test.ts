import { describe, expect, it } from "vitest";
import { splitReplayLinesBySegmentMarkers } from "./splitReplayLinesBySegmentMarkers.js";

const line = (type: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ schemaVersion: 1, type, ...extra });

describe("splitReplayLinesBySegmentMarkers", () => {
  it("无 segment_start 时整份为一段", () => {
    const lines = [line("click"), line("pointermove")];
    expect(splitReplayLinesBySegmentMarkers(lines)).toEqual([lines]);
  });

  it("有 segment 时仅闭合区间成段，段外与段间行不落盘为单独制品", () => {
    const pre = line("click", { n: "pre" });
    const s1 = line("segment_start");
    const mid1 = line("click", { n: "a" });
    const e1 = line("segment_end");
    const between = line("click", { n: "gap" });
    const s2 = line("segment_start");
    const mid2 = line("click", { n: "b" });
    const e2 = line("segment_end");
    const post = line("click", { n: "post" });
    const all = [pre, s1, mid1, e1, between, s2, mid2, e2, post];
    expect(splitReplayLinesBySegmentMarkers(all)).toEqual([
      [s1, mid1, e1],
      [s2, mid2, e2],
    ]);
  });

  it("仅有成对 segment 时无首尾间隙则两段", () => {
    const s1 = line("segment_start");
    const e1 = line("segment_end");
    const s2 = line("segment_start");
    const e2 = line("segment_end");
    expect(splitReplayLinesBySegmentMarkers([s1, e1, s2, e2])).toEqual([
      [s1, e1],
      [s2, e2],
    ]);
  });

  it("末尾缺少 segment_end 时末段包含到文件尾", () => {
    const s1 = line("segment_start");
    const c = line("click");
    expect(splitReplayLinesBySegmentMarkers([s1, c])).toEqual([[s1, c]]);
  });
});
