import { describe, expect, it } from "vitest";
import {
  applyLoadingFailed,
  applyLoadingFinished,
  applyRequestWillBeSent,
  applyResponseReceived,
  createNetworkObserveAccumulator,
  finalizeNetworkObserveResult,
  formatUrlForObserve,
  MAX_TRACKED_REQUESTS,
} from "./networkObserve.js";

describe("networkObserve reducer", () => {
  it("tracks maxConcurrent and completed duration", () => {
    const acc = createNetworkObserveAccumulator();
    const strip = { stripQuery: true, maxTracked: MAX_TRACKED_REQUESTS };
    applyRequestWillBeSent(
      acc,
      {
        requestId: "a",
        timestamp: 100,
        request: { url: "https://x.com/a?q=1", method: "GET" },
      },
      strip,
    );
    applyRequestWillBeSent(
      acc,
      {
        requestId: "b",
        timestamp: 100.01,
        request: { url: "https://x.com/b", method: "GET" },
      },
      strip,
    );
    expect(acc.maxConcurrent).toBe(2);
    applyResponseReceived(acc, { requestId: "a", response: { status: 200 } });
    applyLoadingFinished(acc, { requestId: "a", timestamp: 100.1 });
    expect(acc.inflight).toBe(1);
    applyLoadingFinished(acc, { requestId: "b", timestamp: 100.2 });
    expect(acc.inflight).toBe(0);
    expect(acc.completed.length).toBe(2);
    expect(acc.completed[0].durationMs).toBeCloseTo(100, -1);
  });

  it("slowRequests only includes requests above threshold", () => {
    const acc = createNetworkObserveAccumulator();
    const strip = { stripQuery: true, maxTracked: MAX_TRACKED_REQUESTS };
    applyRequestWillBeSent(
      acc,
      { requestId: "s", timestamp: 0, request: { url: "https://slow.io/x", method: "GET" } },
      strip,
    );
    applyLoadingFinished(acc, { requestId: "s", timestamp: 2 });
    const r = finalizeNetworkObserveResult(acc, {
      windowMs: 3000,
      slowThresholdMs: 1500,
      maxSlowRequests: 10,
      stripQuery: true,
    });
    expect(r.completedRequests).toBe(1);
    expect(r.slowRequests.length).toBe(1);
    expect(r.slowRequests[0].durationMs).toBeGreaterThanOrEqual(2000);
  });

  it("sets truncated when exceeding maxTracked", () => {
    const acc = createNetworkObserveAccumulator();
    const strip = { stripQuery: true, maxTracked: 2 };
    applyRequestWillBeSent(
      acc,
      { requestId: "1", timestamp: 0, request: { url: "https://a/1", method: "GET" } },
      strip,
    );
    applyRequestWillBeSent(
      acc,
      { requestId: "2", timestamp: 0, request: { url: "https://a/2", method: "GET" } },
      strip,
    );
    applyRequestWillBeSent(
      acc,
      { requestId: "3", timestamp: 0, request: { url: "https://a/3", method: "GET" } },
      strip,
    );
    expect(acc.truncated).toBe(true);
    expect(acc.initiated).toBe(2);
  });

  it("formatUrlForObserve strips query by default", () => {
    expect(formatUrlForObserve("https://a.com/p?x=1#h", true, 500)).toBe("https://a.com/p");
  });
});
