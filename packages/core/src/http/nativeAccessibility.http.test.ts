import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { dumpMacAccessibilityTree } from "../nativeAccessibility/macAxTree.js";
import { createApp } from "./createApp.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";

vi.mock("../nativeAccessibility/macAxTree.js", () => ({
  dumpMacAccessibilityTree: vi.fn(),
}));

const dumpMock = dumpMacAccessibilityTree as ReturnType<typeof vi.fn>;

describe("GET /v1/sessions/:sessionId/native-accessibility-tree", () => {
  let dir: string;
  let platformBackup: PropertyDescriptor | undefined;

  beforeEach(() => {
    platformBackup = Object.getOwnPropertyDescriptor(process, "platform");
    dumpMock.mockReset();
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
    if (platformBackup) Object.defineProperty(process, "platform", platformBackup);
    else delete (process as NodeJS.Process & { platform?: string }).platform;
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  it("returns 400 PLATFORM_UNSUPPORTED when not on darwin", async () => {
    setPlatform("linux");
    dir = await mkdtemp(path.join(tmpdir(), "od-ax-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/any/native-accessibility-tree")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PLATFORM_UNSUPPORTED");
    expect(dumpMock).not.toHaveBeenCalled();
  });

  it("returns 404 when session missing (darwin)", async () => {
    setPlatform("darwin");
    dir = await mkdtemp(path.join(tmpdir(), "od-ax-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/missing/native-accessibility-tree")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
    expect(dumpMock).not.toHaveBeenCalled();
  });

  it("returns 400 SESSION_NOT_READY when session not running", async () => {
    setPlatform("darwin");
    dir = await mkdtemp(path.join(tmpdir(), "od-ax-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "starting",
      createdAt: new Date().toISOString(),
      pid: 100,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-tree")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SESSION_NOT_READY");
    expect(dumpMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns 400 PID_UNAVAILABLE when pid missing", async () => {
    setPlatform("darwin");
    dir = await mkdtemp(path.join(tmpdir(), "od-ax-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-tree")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PID_UNAVAILABLE");
    expect(dumpMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns 200 with truncated and root when dump succeeds", async () => {
    setPlatform("darwin");
    dir = await mkdtemp(path.join(tmpdir(), "od-ax-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpMock.mockResolvedValue({
      ok: true,
      truncated: false,
      root: { role: "AXApplication", title: "App" },
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 4242,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-tree")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.root).toEqual({ role: "AXApplication", title: "App" });
    expect(dumpMock).toHaveBeenCalledWith(4242, { maxDepth: 12, maxNodes: 5000 });
    spy.mockRestore();
  });

  it("returns 403 ACCESSIBILITY_DISABLED when dump reports permission denied", async () => {
    setPlatform("darwin");
    dir = await mkdtemp(path.join(tmpdir(), "od-ax-http-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpMock.mockResolvedValue({
      ok: false,
      code: "ACCESSIBILITY_DISABLED",
      message: "Grant Accessibility in System Settings",
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 1,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-tree")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCESSIBILITY_DISABLED");
    spy.mockRestore();
  });
});
