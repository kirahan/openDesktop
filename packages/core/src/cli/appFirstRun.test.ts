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

describe("runAppFirst network-observe & network-stream", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(httpClient, "buildCliHttpContext").mockResolvedValue({
      baseUrl: "http://127.0.0.1:9",
      token: "test-bearer-token",
      tokenFile: "/mock/token.txt",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
        const { pathname, searchParams } = new URL(u);

        if (pathname.endsWith("/network/stream")) {
          expect(searchParams.get("targetId")).toBe("tid-1");
          expect(searchParams.get("stripQuery")).toBe("false");
          expect(searchParams.get("maxEventsPerSecond")).toBe("42");
          const enc = new TextEncoder();
          const sse = `event: ready\ndata: {"x":1}\n\n`;
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(sse));
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        if (pathname === "/v1/profiles") {
          return new Response(JSON.stringify({ profiles: [{ id: "p1", appId: "demo-mock" }] }), {
            status: 200,
          });
        }

        if (pathname === "/v1/sessions") {
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

        if (pathname.endsWith("/actions") && init?.method === "POST") {
          const body = JSON.parse(init.body as string) as { action?: string; targetId?: string };
          expect(body.action).toBe("network-observe");
          expect(body.targetId).toBe("tid-1");
          return new Response(JSON.stringify({ schemaVersion: 1, windowMs: 3000, requests: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(`unexpected: ${pathname}`, { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("network-observe posts agent action and prints structured output", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAppFirst(
      {
        appId: "demo-mock",
        command: "network-observe",
        format: "json",
        targetId: "tid-1",
        apiUrl: "http://127.0.0.1:9",
        tokenFile: "/tmp/opendesktop-test-token.txt",
      },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    expect(code).toBe(0);
    expect(out.join("")).toContain("schemaVersion");
    expect(err).toEqual([]);
  });

  it("network-stream GETs SSE and writes chunks to stdout", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAppFirst(
      {
        appId: "demo-mock",
        command: "network-stream",
        format: "table",
        targetId: "tid-1",
        stripQuery: false,
        maxEventsPerSecond: 42,
        apiUrl: "http://127.0.0.1:9",
        tokenFile: "/tmp/opendesktop-test-token.txt",
      },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    expect(code).toBe(0);
    expect(out.join("")).toContain("event: ready");
    expect(out.join("")).toContain('"x":1');
    expect(err).toEqual([]);
  });
});

describe("runAppFirst console-observe, console-stream, stack-observe, stack-stream", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(httpClient, "buildCliHttpContext").mockResolvedValue({
      baseUrl: "http://127.0.0.1:9",
      token: "test-bearer-token",
      tokenFile: "/mock/token.txt",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
        const { pathname, searchParams } = new URL(u);

        if (pathname.endsWith("/console/stream")) {
          expect(searchParams.get("targetId")).toBe("tid-1");
          const enc = new TextEncoder();
          const sse = `event: ready\ndata: {"kind":"console"}\n\n`;
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(sse));
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        if (pathname.endsWith("/runtime-exception/stream")) {
          expect(searchParams.get("targetId")).toBe("tid-1");
          const enc = new TextEncoder();
          const sse = `event: ready\ndata: {"kind":"stack"}\n\n`;
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(sse));
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        if (pathname === "/v1/profiles") {
          return new Response(JSON.stringify({ profiles: [{ id: "p1", appId: "demo-mock" }] }), {
            status: 200,
          });
        }

        if (pathname === "/v1/sessions") {
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

        if (pathname.endsWith("/actions") && init?.method === "POST") {
          const body = JSON.parse(init.body as string) as { action?: string; targetId?: string; waitMs?: number };
          expect(body.targetId).toBe("tid-1");
          if (body.action === "console-messages") {
            expect(body.waitMs).toBe(800);
            return new Response(JSON.stringify({ entries: [], note: "n", waitMs: body.waitMs }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (body.action === "runtime-exception") {
            return new Response(JSON.stringify({ text: null, frames: [], note: "n", waitMs: 2000 }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        return new Response(`unexpected: ${pathname}`, { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("console-observe posts console-messages action", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAppFirst(
      {
        appId: "demo-mock",
        command: "console-observe",
        format: "json",
        targetId: "tid-1",
        waitMs: 800,
        apiUrl: "http://127.0.0.1:9",
        tokenFile: "/tmp/opendesktop-test-token.txt",
      },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    expect(code).toBe(0);
    expect(out.join("")).toContain("entries");
    expect(err).toEqual([]);
  });

  it("stack-observe posts runtime-exception action", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAppFirst(
      {
        appId: "demo-mock",
        command: "stack-observe",
        format: "json",
        targetId: "tid-1",
        apiUrl: "http://127.0.0.1:9",
        tokenFile: "/tmp/opendesktop-test-token.txt",
      },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    expect(code).toBe(0);
    expect(out.join("")).toContain("frames");
    expect(err).toEqual([]);
  });

  it("console-stream GETs SSE", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAppFirst(
      {
        appId: "demo-mock",
        command: "console-stream",
        format: "table",
        targetId: "tid-1",
        apiUrl: "http://127.0.0.1:9",
        tokenFile: "/tmp/opendesktop-test-token.txt",
      },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    expect(code).toBe(0);
    expect(out.join("")).toContain("event: ready");
    expect(out.join("")).toContain("console");
    expect(err).toEqual([]);
  });

  it("stack-stream GETs SSE", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAppFirst(
      {
        appId: "demo-mock",
        command: "stack-stream",
        format: "table",
        targetId: "tid-1",
        apiUrl: "http://127.0.0.1:9",
        tokenFile: "/tmp/opendesktop-test-token.txt",
      },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    expect(code).toBe(0);
    expect(out.join("")).toContain("event: ready");
    expect(out.join("")).toContain("stack");
    expect(err).toEqual([]);
  });
});
