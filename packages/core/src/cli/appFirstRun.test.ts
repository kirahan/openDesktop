import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppFirst } from "./appFirstRun.js";
import * as httpClient from "./httpClient.js";

describe("runAppFirst", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(httpClient, "buildCliHttpContext").mockResolvedValue({
      baseUrl: "http://127.0.0.1:9",
      token: "test-bearer-token",
      tokenFile: "/mock/token.txt",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/v1/sessions") && !/\/v1\/sessions\/[^/]+\/list-window/.test(u) && !u.endsWith("/snapshot")) {
          return new Response(
            JSON.stringify({
              sessions: [
                {
                  id: "s-new",
                  profileId: "p1",
                  state: "running",
                  createdAt: "2026-01-03T00:00:00.000Z",
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (u.includes("/v1/profiles")) {
          return new Response(JSON.stringify({ profiles: [{ id: "p1", appId: "demo-mock" }] }), {
            status: 200,
          });
        }
        if (u.includes("/list-window")) {
          return new Response(JSON.stringify({ nodes: [] }), { status: 200 });
        }
        if (u.includes("/v1/agent/sessions/") && u.includes("/snapshot")) {
          return new Response(JSON.stringify({ sessionId: "s-new" }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("resolves latest session and fetches list-window", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAppFirst(
      {
        appId: "demo-mock",
        command: "list-window",
        format: "json",
        apiUrl: "http://127.0.0.1:9",
        tokenFile: "/tmp/opendesktop-test-token.txt",
      },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    expect(code).toBe(0);
    expect(out.join("")).toContain("nodes");
    expect(err).toEqual([]);
  });
});
