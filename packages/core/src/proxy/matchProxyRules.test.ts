import { describe, expect, it } from "vitest";
import { matchProxyRules } from "./matchProxyRules.js";

describe("matchProxyRules", () => {
  it("matches host suffix and collects tags", () => {
    const tags = matchProxyRules("api.example.com", "/v1/x", [
      { hostSuffix: "example.com", pathPrefix: "/v1", tags: ["t1"] },
      { hostSuffix: "other.com", tags: ["bad"] },
    ]);
    expect(tags).toEqual(["t1"]);
  });

  it("CONNECT-style empty path still matches suffix-only rules", () => {
    const tags = matchProxyRules("api.example.com", "", [
      { hostSuffix: "example.com", tags: ["tunnel"] },
      { hostSuffix: "example.com", pathPrefix: "/api", tags: ["no"] },
    ]);
    expect(tags).toEqual(["tunnel"]);
  });
});
