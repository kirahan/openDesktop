import { describe, expect, it } from "vitest";
import { requestCompleteToRow } from "./sseToRow.js";

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
  });

  it("falls back id when requestId missing", () => {
    const r = requestCompleteToRow({ kind: "requestComplete", url: "https://a.com/", method: "POST" });
    expect(r.id.length).toBeGreaterThan(4);
  });
});
