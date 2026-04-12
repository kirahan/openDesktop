import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConsoleStreamCountForTest, tryAcquireConsoleStream } from "../cdp/consoleStreamLimiter.js";
import {
  resetObservabilitySseCountsForTest,
  tryAcquireNetworkSseStream,
} from "../cdp/observabilitySseLimiter.js";
import { resetReplaySseCountForTest, tryAcquireReplaySseStream } from "../session-replay/replaySseLimiter.js";
import {
  resetRrwebRecordingRegistryForTest,
  testOnly_registerStubRrwebRecording,
} from "../session-replay/rrwebRecordingService.js";
import {
  MAX_CONCURRENT_RRWEB_SSE_STREAMS,
  resetRrwebSseCountForTest,
  tryAcquireRrwebSseStream,
} from "../session-replay/rrwebSseLimiter.js";
import * as recordingService from "../session-replay/recordingService.js";
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
    expect(v.body.capabilities).toContain("page_session_replay");
    expect(v.body.capabilities).toContain("session_replay_rrweb");
    expect(Array.isArray(v.body.agentActions)).toBe(true);
    expect(v.body.agentActions).toContain("state");
    expect(v.body.agentActions).toContain("get");
    expect(v.body.agentActions).toContain("topology");
    expect(v.body.agentActions).toContain("dom");
    expect(v.body.agentActions).toContain("console-messages");
    expect(v.body.agentActions).toContain("renderer-globals");
    expect(v.body.agentActions).toContain("explore");
    expect(v.body.agentActions).toContain("network-observe");
    expect(v.body.agentActions).toContain("runtime-exception");
    expect(Array.isArray(v.body.sseObservabilityStreams)).toBe(true);
    expect(v.body.sseObservabilityStreams).toContain("network");
    expect(v.body.sseObservabilityStreams).toContain("runtime-exception");
    expect(v.body.sseObservabilityStreams).toContain("local-proxy");
    expect(v.body.sseObservabilityStreams).toContain("page-replay");
    expect(v.body.sseObservabilityStreams).toContain("rrweb");
    expect(v.body.sseObservabilityStreamPaths?.network).toContain("/network/stream");
    expect(v.body.sseObservabilityStreamPaths?.runtimeException).toContain("/runtime-exception/stream");
    expect(v.body.sseObservabilityStreamPaths?.localProxy).toContain("/proxy/stream");
    expect(v.body.sseObservabilityStreamPaths?.pageReplay).toContain("/replay/stream");
    expect(v.body.sseObservabilityStreamPaths?.rrweb).toContain("/rrweb/stream");
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

  it("GET /v1/sessions/:id/network/stream returns 404 when session missing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/missing-id/network/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("GET /v1/sessions/:id/network/stream requires targetId", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/any/network/stream")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /v1/sessions/:id/network/stream returns 503 when CDP not ready", async () => {
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
      .get("/v1/sessions/sid/network/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CDP_NOT_READY");
    spy.mockRestore();
  });

  it("GET /v1/sessions/:id/network/stream returns 429 when stream limit exceeded", async () => {
    resetObservabilitySseCountsForTest();
    for (let i = 0; i < 4; i++) {
      expect(tryAcquireNetworkSseStream()).toBe(true);
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
      .get("/v1/sessions/sid/network/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("NETWORK_SSE_STREAM_LIMIT");
    spy.mockRestore();
    resetObservabilitySseCountsForTest();
  });

  it("GET /v1/sessions/:id/runtime-exception/stream returns 403 when script execution disabled", async () => {
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
      .get("/v1/sessions/sid/runtime-exception/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SCRIPT_NOT_ALLOWED");
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

  it("POST /v1/sessions/:id/replay/recording/start passes injectPageControls to startPageRecording", async () => {
    recordingService.resetRecordingRegistryForTest();
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const spy = vi.spyOn(recordingService, "startPageRecording").mockResolvedValue({ ok: true });
    const on = await request(app)
      .post("/v1/sessions/sid/replay/recording/start")
      .set("Authorization", "Bearer t")
      .send({ targetId: "T1", injectPageControls: true });
    expect(on.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(manager, "sid", "T1", { injectPageControls: true });
    const off = await request(app)
      .post("/v1/sessions/sid2/replay/recording/start")
      .set("Authorization", "Bearer t")
      .send({ targetId: "T1" });
    expect(off.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(manager, "sid2", "T1", { injectPageControls: true });
    const noBar = await request(app)
      .post("/v1/sessions/sid3/replay/recording/start")
      .set("Authorization", "Bearer t")
      .send({ targetId: "T1", injectPageControls: false });
    expect(noBar.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(manager, "sid3", "T1", { injectPageControls: false });
    spy.mockRestore();
    recordingService.resetRecordingRegistryForTest();
  });

  it("GET /v1/sessions/:id/replay/stream returns 401 without Bearer", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app).get("/v1/sessions/sid/replay/stream?targetId=T1");
    expect(res.status).toBe(401);
  });

  it("GET /v1/sessions/:id/replay/stream returns 503 when recording not active", async () => {
    recordingService.resetRecordingRegistryForTest();
    resetReplaySseCountForTest();
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
      allowScriptExecution: true,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/replay/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("RECORDER_NOT_ACTIVE");
    spy.mockRestore();
  });

  it("GET /v1/sessions/:id/replay/stream returns 403 when script execution disabled", async () => {
    recordingService.resetRecordingRegistryForTest();
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
      .get("/v1/sessions/sid/replay/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SCRIPT_NOT_ALLOWED");
    spy.mockRestore();
  });

  it("GET /v1/sessions/:id/replay/stream returns 429 when replay SSE limit exceeded", async () => {
    recordingService.resetRecordingRegistryForTest();
    resetReplaySseCountForTest();
    for (let i = 0; i < 4; i++) {
      expect(tryAcquireReplaySseStream()).toBe(true);
    }
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    recordingService.testOnly_registerStubRecording("sid", "T1");
    const spy = vi.spyOn(manager, "getOpsContext");
    spy.mockReturnValue({
      state: "running",
      cdpPort: 9222,
      pid: 1,
      allowScriptExecution: true,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/replay/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("REPLAY_SSE_STREAM_LIMIT");
    spy.mockRestore();
    resetReplaySseCountForTest();
    recordingService.resetRecordingRegistryForTest();
  });

  it("GET /v1/sessions/:id/rrweb/stream returns 401 without Bearer", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app).get("/v1/sessions/sid/rrweb/stream?targetId=T1");
    expect(res.status).toBe(401);
  });

  it("GET /v1/sessions/:id/rrweb/stream returns 503 when recording not active", async () => {
    resetRrwebRecordingRegistryForTest();
    resetRrwebSseCountForTest();
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
      allowScriptExecution: true,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/rrweb/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("RRWEB_RECORDER_NOT_ACTIVE");
    spy.mockRestore();
  });

  it("GET /v1/sessions/:id/rrweb/stream returns 403 when script execution disabled", async () => {
    resetRrwebRecordingRegistryForTest();
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
      .get("/v1/sessions/sid/rrweb/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SCRIPT_NOT_ALLOWED");
    spy.mockRestore();
  });

  it("GET /v1/sessions/:id/rrweb/stream returns 429 when rrweb SSE limit exceeded", async () => {
    resetRrwebRecordingRegistryForTest();
    resetRrwebSseCountForTest();
    for (let i = 0; i < MAX_CONCURRENT_RRWEB_SSE_STREAMS; i++) {
      expect(tryAcquireRrwebSseStream()).toBe(true);
    }
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    testOnly_registerStubRrwebRecording("sid", "T1");
    const spy = vi.spyOn(manager, "getOpsContext");
    spy.mockReturnValue({
      state: "running",
      cdpPort: 9222,
      pid: 1,
      allowScriptExecution: true,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/rrweb/stream?targetId=T1")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RRWEB_SSE_STREAM_LIMIT");
    spy.mockRestore();
    resetRrwebSseCountForTest();
    resetRrwebRecordingRegistryForTest();
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

  it("DELETE /v1/apps/:id removes app, profiles, and user scripts for that app", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    const auth = { Authorization: "Bearer tok" };
    await request(app)
      .post("/v1/apps")
      .set(auth)
      .send({
        id: "rm-app",
        name: "n",
        executable: "/bin/true",
        cwd: "/",
        args: [],
        env: {},
        injectElectronDebugPort: false,
      });
    await request(app)
      .post("/v1/profiles")
      .set(auth)
      .send({
        id: "rm-prof",
        appId: "rm-app",
        name: "p",
        env: {},
        extraArgs: [],
      });
    const us = await store.readUserScripts();
    us.scripts.push({
      id: "s1",
      appId: "rm-app",
      source:
        "// ==UserScript==\n// @name x\n// @match *\n// @grant none\n// ==/UserScript==\n",
      metadata: { name: "x", matches: ["*"], grant: "none" },
      updatedAt: new Date().toISOString(),
    });
    await store.writeUserScripts(us.scripts);

    const del = await request(app).delete("/v1/apps/rm-app").set(auth);
    expect(del.status).toBe(204);

    const apps = await store.readApps();
    expect(apps.apps.some((a) => a.id === "rm-app")).toBe(false);
    const profs = await store.readProfiles();
    expect(profs.profiles.some((p) => p.appId === "rm-app")).toBe(false);
    const scripts = await store.readUserScripts();
    expect(scripts.scripts.some((s) => s.appId === "rm-app")).toBe(false);
  });

  it("DELETE /v1/apps/:id returns 404 when app missing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    const res = await request(app).delete("/v1/apps/nope").set({ Authorization: "Bearer tok" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("APP_NOT_FOUND");
  });

  it("POST /v1/sessions/:id/test-recording-artifacts returns 404 when session missing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .post("/v1/sessions/nope/test-recording-artifacts")
      .set("Authorization", "Bearer t")
      .send({ targetId: "t1", replayLines: [] });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("POST test-recording-artifacts persists replayLines and GET reads back", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-http-"));
    const store = new JsonFileStore(dir);
    await store.writeApps([
      {
        id: "tr-app",
        name: "n",
        executable: "/bin/true",
        cwd: "/",
        env: {},
        args: [],
        injectElectronDebugPort: false,
      },
    ]);
    await store.writeProfiles([
      { id: "tr-prof", appId: "tr-app", name: "p", env: {}, extraArgs: [] },
    ]);
    const manager = new SessionManager(store, dir);
    manager.testOnly_seedRunningSession("tr-sess", "tr-prof");
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const clickLine = JSON.stringify({
      schemaVersion: 1,
      type: "click",
      ts: 99,
      x: 3,
      y: 4,
      viewportWidth: 100,
      viewportHeight: 100,
    });
    const post = await request(app)
      .post("/v1/sessions/tr-sess/test-recording-artifacts")
      .set("Authorization", "Bearer t")
      .send({ targetId: "tg1", recordingId: "http-rec-1", replayLines: [clickLine] });
    expect(post.status).toBe(201);
    expect(post.body.recordingId).toBe("http-rec-1");
    expect(post.body.path).toContain("app-json");
    expect(post.body.path).toContain("tr-app");

    const list = await request(app)
      .get("/v1/apps/tr-app/test-recording-artifacts")
      .set("Authorization", "Bearer t");
    expect(list.status).toBe(200);
    expect(list.body.recordingIds).toContain("http-rec-1");

    const one = await request(app)
      .get("/v1/apps/tr-app/test-recording-artifacts/http-rec-1")
      .set("Authorization", "Bearer t");
    expect(one.status).toBe(200);
    expect(one.body.sessionId).toBe("tr-sess");
  });
});
