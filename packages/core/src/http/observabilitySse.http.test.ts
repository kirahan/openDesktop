import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/networkObserveStream.js", () => ({
  NETWORK_SSE_MAX_EVENTS_PER_SECOND: 40,
  runNetworkObservationStream: vi.fn(async (_a: number, _b: string, opts: { onDropped: (n: number) => void }) => {
    for (let i = 0; i < 5; i++) opts.onDropped(1);
    return {};
  }),
}));

vi.mock("../cdp/runtimeExceptionStream.js", () => ({
  MAX_RUNTIME_EXCEPTION_SSE_PER_MINUTE: 120,
  runRuntimeExceptionStream: vi.fn(async () => ({})),
}));

import { loadConfig } from "../config.js";
import { createApp } from "./createApp.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";

describe("observability SSE (mocked CDP streams)", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });

  it("network stream emits warning when drops are reported", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-sse-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    const spy = vi.spyOn(manager, "getOpsContext");
    spy.mockReturnValue({
      state: "running",
      cdpPort: 9222,
      pid: 1,
      allowScriptExecution: true,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/network/stream?targetId=T1")
      .set("Authorization", "Bearer tok")
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const text = res.body?.toString?.() ?? String(res.text ?? "");
    expect(text).toContain("event: ready");
    expect(text).toContain("event: warning");
    expect(text).toContain("NETWORK_SSE_RATE_LIMIT");
    expect(text).toContain("droppedEvents");
    spy.mockRestore();
  });

  it("runtime-exception stream sends ready when mocked stream resolves", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-sse-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    const spy = vi.spyOn(manager, "getOpsContext");
    spy.mockReturnValue({
      state: "running",
      cdpPort: 9222,
      pid: 1,
      allowScriptExecution: true,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/runtime-exception/stream?targetId=T1")
      .set("Authorization", "Bearer tok")
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const text = res.body?.toString?.() ?? String(res.text ?? "");
    expect(text).toContain("event: ready");
    expect(text).toContain("Runtime.exceptionThrown");
    spy.mockRestore();
  });
});
