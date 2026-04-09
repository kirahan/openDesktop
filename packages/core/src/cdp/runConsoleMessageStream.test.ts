import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runConsoleMessageStream } from "./browserClient.js";

describe("runConsoleMessageStream", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns no_browser_ws when /json/version is unavailable", async () => {
    const ac = new AbortController();
    const got: unknown[] = [];
    const r = await runConsoleMessageStream(59999, "T1", (e) => {
      got.push(e);
    }, ac.signal);
    expect(r.error).toBe("no_browser_ws");
    expect(got.length).toBe(0);
  });
});
