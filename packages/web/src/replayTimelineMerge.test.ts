import { describe, expect, it } from "vitest";
import { compareReplayMergeOrder, sortReplayNdjsonLinesByMergeOrder } from "./replayTimelineMerge.js";

describe("sortReplayNdjsonLinesByMergeOrder", () => {
  it("orders by mergeTs, targetId, seq", () => {
    const lines = [
      JSON.stringify({ mergeTs: 2, targetId: "B", seq: 1, x: 1 }),
      JSON.stringify({ mergeTs: 1, targetId: "A", seq: 9, x: 2 }),
      JSON.stringify({ mergeTs: 2, targetId: "A", seq: 1, x: 3 }),
    ];
    const sorted = sortReplayNdjsonLinesByMergeOrder(lines);
    expect(JSON.parse(sorted[0]!).x).toBe(2);
    expect(JSON.parse(sorted[1]!).x).toBe(3);
    expect(JSON.parse(sorted[2]!).x).toBe(1);
  });
});

describe("compareReplayMergeOrder", () => {
  it("matches core tie-break", () => {
    expect(
      compareReplayMergeOrder(
        { mergeTs: 1, targetId: "a", seq: 1 },
        { mergeTs: 1, targetId: "b", seq: 1 },
      ),
    ).toBeLessThan(0);
  });
});
