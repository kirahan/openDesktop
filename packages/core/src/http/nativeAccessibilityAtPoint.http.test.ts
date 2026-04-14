import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { dumpMacAccessibilityAtPoint } from "../nativeAccessibility/macAxTreeAtPoint.js";
import { dumpWinAccessibilityAtPoint } from "../nativeAccessibility/winUiaTreeAtPoint.js";
import { getGlobalMousePosition } from "../nativeAccessibility/getGlobalMousePosition.js";
import { createApp } from "./createApp.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";

vi.mock("../nativeAccessibility/macAxTreeAtPoint.js", () => ({
  dumpMacAccessibilityAtPoint: vi.fn(),
}));

vi.mock("../nativeAccessibility/winUiaTreeAtPoint.js", () => ({
  dumpWinAccessibilityAtPoint: vi.fn(),
  dumpWinAccessibilityTree: vi.fn(),
}));

vi.mock("../nativeAccessibility/getGlobalMousePosition.js", () => ({
  getGlobalMousePosition: vi.fn(),
}));

const dumpMock = dumpMacAccessibilityAtPoint as ReturnType<typeof vi.fn>;
const dumpWinMock = dumpWinAccessibilityAtPoint as ReturnType<typeof vi.fn>;
const mouseMock = getGlobalMousePosition as ReturnType<typeof vi.fn>;

describe("GET /v1/sessions/:sessionId/native-accessibility-at-point", () => {
  let dir: string;
  let platformBackup: PropertyDescriptor | undefined;

  beforeEach(() => {
    platformBackup = Object.getOwnPropertyDescriptor(process, "platform");
    dumpMock.mockReset();
    dumpWinMock.mockReset();
    mouseMock.mockReset();
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
    if (platformBackup) Object.defineProperty(process, "platform", platformBackup);
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  it("returns 400 PLATFORM_UNSUPPORTED when not darwin or win32", async () => {
    setPlatform("linux");
    dir = await mkdtemp(path.join(tmpdir(), "od-axpt-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/x/native-accessibility-at-point")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PLATFORM_UNSUPPORTED");
    expect(dumpMock).not.toHaveBeenCalled();
    expect(dumpWinMock).not.toHaveBeenCalled();
  });

  it("on win32 uses dumpWinAccessibilityAtPoint with explicit x,y", async () => {
    setPlatform("win32");
    dir = await mkdtemp(path.join(tmpdir(), "od-axpt-win-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpWinMock.mockResolvedValue({
      ok: true,
      truncated: false,
      screenX: 10,
      screenY: 20,
      ancestors: [],
      at: { role: "button", title: "OK" },
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 42,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-at-point?x=10&y=20")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.at.role).toBe("button");
    expect(dumpWinMock).toHaveBeenCalledWith(42, {
      screenX: 10,
      screenY: 20,
      maxAncestorDepth: 8,
      maxLocalDepth: 4,
      maxNodes: 5000,
    });
    expect(dumpMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns 422 when no x,y and mouse fails", async () => {
    setPlatform("darwin");
    dir = await mkdtemp(path.join(tmpdir(), "od-axpt-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    mouseMock.mockResolvedValue({
      ok: false,
      code: "MOUSE_POSITION_UNAVAILABLE",
      message: "fail",
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 1,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-at-point")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("MOUSE_POSITION_UNAVAILABLE");
    expect(dumpMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("uses explicit x,y and returns 200", async () => {
    setPlatform("darwin");
    dir = await mkdtemp(path.join(tmpdir(), "od-axpt-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpMock.mockResolvedValue({
      ok: true,
      truncated: false,
      screenX: 5,
      screenY: 6,
      ancestors: [],
      at: { role: "AXButton", title: "x" },
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 99,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-at-point?x=10&y=20")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.at.role).toBe("AXButton");
    expect(dumpMock).toHaveBeenCalledWith(99, {
      screenX: 10,
      screenY: 20,
      maxAncestorDepth: 8,
      maxLocalDepth: 4,
      maxNodes: 5000,
    });
    expect(mouseMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns 403 ACCESSIBILITY_DISABLED from dump", async () => {
    setPlatform("darwin");
    dir = await mkdtemp(path.join(tmpdir(), "od-axpt-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpMock.mockResolvedValue({
      ok: false,
      code: "ACCESSIBILITY_DISABLED",
      message: "no",
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 1,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-at-point?x=1&y=2")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCESSIBILITY_DISABLED");
    spy.mockRestore();
  });

  it("on win32 returns 400 HIT_OUTSIDE_SESSION when dump reports mismatch", async () => {
    setPlatform("win32");
    dir = await mkdtemp(path.join(tmpdir(), "od-axpt-win-hit-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpWinMock.mockResolvedValue({
      ok: false,
      code: "HIT_OUTSIDE_SESSION",
      message: "hit process 9 does not match session pid 42",
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 42,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-at-point?x=1&y=2")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("HIT_OUTSIDE_SESSION");
    expect(dumpWinMock).toHaveBeenCalled();
    expect(dumpMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("on win32 returns 422 when no x,y and mouse fails", async () => {
    setPlatform("win32");
    dir = await mkdtemp(path.join(tmpdir(), "od-axpt-win-mouse-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    mouseMock.mockResolvedValue({
      ok: false,
      code: "MOUSE_POSITION_UNAVAILABLE",
      message: "GetCursorPos failed",
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 1,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-at-point")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("MOUSE_POSITION_UNAVAILABLE");
    expect(dumpWinMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("on win32 returns 403 when dump reports ACCESSIBILITY_DISABLED", async () => {
    setPlatform("win32");
    dir = await mkdtemp(path.join(tmpdir(), "od-axpt-win-a11y-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpWinMock.mockResolvedValue({
      ok: false,
      code: "ACCESSIBILITY_DISABLED",
      message: "UIA load failed",
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 1,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-at-point?x=0&y=0")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCESSIBILITY_DISABLED");
    spy.mockRestore();
  });

  it("on win32 returns hitFrame in 200 body when dump includes it", async () => {
    setPlatform("win32");
    dir = await mkdtemp(path.join(tmpdir(), "od-axpt-win-frame-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpWinMock.mockResolvedValue({
      ok: true,
      truncated: false,
      screenX: 10,
      screenY: 20,
      ancestors: [],
      at: { role: "button", title: "OK" },
      hitFrame: { x: 5, y: 6, width: 100, height: 24 },
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 42,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-accessibility-at-point?x=10&y=20")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.hitFrame).toEqual({ x: 5, y: 6, width: 100, height: 24 });
    spy.mockRestore();
  });
});
