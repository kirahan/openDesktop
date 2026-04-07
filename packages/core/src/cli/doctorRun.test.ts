import { afterEach, describe, expect, it, vi } from "vitest";
import { EX_UNAVAILABLE } from "./exitCodes.js";
import { runDoctor } from "./doctorRun.js";

describe("runDoctor", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("returns EX_UNAVAILABLE when Core is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const code = await runDoctor({ format: "table" }, () => undefined, () => undefined);
    expect(code).toBe(EX_UNAVAILABLE);
  });
});
