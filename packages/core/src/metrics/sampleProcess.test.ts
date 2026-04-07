import { describe, expect, it } from "vitest";
import { sampleProcessMetrics } from "./sampleProcess.js";

describe("sampleProcessMetrics", () => {
  it("returns invalid_pid when pid missing", async () => {
    const r = await sampleProcessMetrics(undefined);
    expect(r.metrics).toBeNull();
    expect(r.reason).toBe("invalid_pid");
  });

  it("returns metrics for current process", async () => {
    const r = await sampleProcessMetrics(process.pid);
    expect(r.metrics).not.toBeNull();
    expect(r.metrics!.memoryBytes).toBeGreaterThan(0);
  });
});
