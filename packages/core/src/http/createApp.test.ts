import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConsoleStreamCountForTest, tryAcquireConsoleStream } from "../cdp/consoleStreamLimiter.js";
import { loadConfig } from "../config.js";
import { createApp } from "./createApp.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";

describe("createApp HTTP", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });

  it("GET /v1/health and /v1/version without auth", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "test-token", store, manager });
    const h = await request(app).get("/v1/health");
    expect(h.status).toBe(200);
    expect(h.body).toEqual({ status: "ok" });
    const v = await request(app).get("/v1/version");
    expect(v.status).toBe(200);
    expect(v.body.api).toBe("v1");
    expect(v.body.core).toBeDefined();
    expect(Array.isArray(v.body.capabilities)).toBe(true);
    expect(v.body.capabilities).toContain("list-window");
    expect(v.body.capabilities).toContain("topology");
    expect(v.body.capabilities).toContain("live_console");
    expect(Array.isArray(v.body.agentActions)).toBe(true);
    expect(v.body.agentActions).toContain("state");
    expect(v.body.agentActions).toContain("get");
    expect(v.body.agentActions).toContain("topology");
    expect(v.body.agentActions).toContain("dom");
    expect(v.body.agentActions).toContain("console-messages");
    expect(v.body.agentActions).toContain("renderer-globals");
    expect(v.body.agentActions).toContain("explore");
  });

  it("GET /v1/apps requires Bearer token", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "secret", store, manager });
    const u = await request(app).get("/v1/apps");
    expect(u.status).toBe(401);
    expect(u.body.error.code).toBe("UNAUTHORIZED");
    const ok = await request(app).get("/v1/apps").set("Authorization", "Bearer secret");
    expect(ok.status).toBe(200);
    expect(ok.body.apps).toEqual([]);
  });

  it("GET /v1/sessions/:id/list-window returns 404 when session missing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/nope/list-window")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("GET /v1/sessions/:id/topology (deprecated alias) returns 404 when session missing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/nope/topology")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("when OPENDESKTOP_AGENT_API=0, agent routes are not mounted", async () => {
    vi.stubEnv("OPENDESKTOP_AGENT_API", "0");
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    expect(config.enableAgentApi).toBe(false);
    const { app } = createApp({ config, token: "tok", store, manager });
    const res = await request(app)
      .get("/v1/agent/sessions/nope/snapshot")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(404);
    const ver = await request(app).get("/v1/version");
    expect(ver.body.agentActions).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it("GET /v1/agent/sessions/:id/snapshot requires auth", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    const res = await request(app).get("/v1/agent/sessions/nope/snapshot");
    expect(res.status).toBe(401);
  });

  it("GET /v1/sessions/:id/console/stream returns 404 when session missing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/missing-id/console/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("GET /v1/sessions/:id/console/stream requires targetId", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/any/console/stream")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /v1/sessions/:id/console/stream returns 503 when CDP not ready", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const spy = vi.spyOn(manager, "getOpsContext");
    spy.mockReturnValue({
      state: "running",
      cdpPort: undefined,
      pid: 1,
      allowScriptExecution: false,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/console/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CDP_NOT_READY");
    spy.mockRestore();
  });

  it("GET /v1/sessions/:id/console/stream returns 429 when stream limit exceeded", async () => {
    resetConsoleStreamCountForTest();
    for (let i = 0; i < 8; i++) {
      expect(tryAcquireConsoleStream()).toBe(true);
    }
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const spy = vi.spyOn(manager, "getOpsContext");
    spy.mockReturnValue({
      state: "running",
      cdpPort: 9222,
      pid: 1,
      allowScriptExecution: false,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/console/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("CONSOLE_STREAM_LIMIT");
    spy.mockRestore();
    resetConsoleStreamCountForTest();
  });

  it("GET /v1/sessions/:id/logs/stream returns 404 when session missing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/does-not-exist/logs/stream")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("agent routes are rate limited", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir, agentRateLimitPerMinute: 1 });
    const { app } = createApp({ config, token: "rl", store, manager });
    const auth = { Authorization: "Bearer rl" };
    const url = "/v1/agent/sessions/any/snapshot";
    const first = await request(app).get(url).set(auth);
    expect([404, 503]).toContain(first.status);
    const second = await request(app).get(url).set(auth);
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBe("60");
  });

  it("GET /v1/health and GET / are independent when webDist set", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const webDir = path.join(dir, "web");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(webDir, { recursive: true });
    await writeFile(path.join(webDir, "index.html"), "<!doctype html><html><body>x</body></html>", "utf8");
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir, webDist: webDir });
    const { app } = createApp({ config, token: "t", store, manager });
    const h = await request(app).get("/v1/health");
    expect(h.status).toBe(200);
    const idx = await request(app).get("/");
    expect(idx.status).toBe(200);
    expect(idx.text).toContain("x");
  });
});
