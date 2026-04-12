import { describe, expect, it } from "vitest";
import { summarizeRrwebEventsForUi } from "./rrwebEventSummary.js";

describe("summarizeRrwebEventsForUi", () => {
  it("空列表时计数为 0 且无 Meta 与 FullSnapshot", () => {
    const s = summarizeRrwebEventsForUi([]);
    expect(s.count).toBe(0);
    expect(s.hasMeta).toBe(false);
    expect(s.hasFullSnapshot).toBe(false);
    expect(s.lastEventJsonPreview).toBe("");
  });

  it("识别 Meta 与 FullSnapshot", () => {
    const s = summarizeRrwebEventsForUi([
      { type: 4, data: { width: 800, height: 600 }, timestamp: 1 },
      { type: 2, data: {}, timestamp: 2 },
    ]);
    expect(s.count).toBe(2);
    expect(s.hasMeta).toBe(true);
    expect(s.hasFullSnapshot).toBe(true);
    expect(s.typeSequenceLabel).toContain("4:Meta");
    expect(s.typeSequenceLabel).toContain("2:FullSnapshot");
    expect(s.lastEventJsonPreview.length).toBeGreaterThan(0);
  });
});
