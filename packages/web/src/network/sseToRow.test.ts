import { describe, expect, it } from "vitest";
import { proxyRequestCompleteToRow, requestCompleteToRow } from "./sseToRow.js";

describe("requestCompleteToRow", () => {
  it("parses absolute https URL", () => {
    const r = requestCompleteToRow({
      kind: "requestComplete",
      requestId: "abc",
      method: "get",
      url: "https://api.example.com/v1/x?y=1",
      status: 200,
      durationMs: 12,
    });
    expect(r.id).toBe("abc");
    expect(r.method).toBe("GET");
    expect(r.host).toBe("api.example.com");
    expect(r.url).toContain("/v1/x");
    expect(r.status).toBe(200);
    expect(r.source).toBe("cdp");
  });

  it("falls back id when requestId missing", () => {
    const r = requestCompleteToRow({ kind: "requestComplete", url: "https://a.com/", method: "POST" });
    expect(r.id.length).toBeGreaterThan(4);
  });
});

describe("proxyRequestCompleteToRow", () => {
  it("marks tls tunnel and proxy source", () => {
    const r = proxyRequestCompleteToRow({
      kind: "proxyRequestComplete",
      requestId: "p1",
      method: "CONNECT",
      url: "https://example.com:443/",
      durationMs: 5,
      tlsTunnel: true,
    });
    expect(r.source).toBe("proxy");
    expect(r.tlsTunnel).toBe(true);
    expect(r.type).toBe("tunnel");
  });
});
