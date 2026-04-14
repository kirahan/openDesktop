import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { dumpWin32HwndAtPoint } from "../nativeAccessibility/winHwndAtPoint.js";
import { getGlobalMousePosition } from "../nativeAccessibility/getGlobalMousePosition.js";
import { createApp } from "./createApp.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";

vi.mock("../nativeAccessibility/winHwndAtPoint.js", () => ({
  dumpWin32HwndAtPoint: vi.fn(),
}));

vi.mock("../nativeAccessibility/getGlobalMousePosition.js", () => ({
  getGlobalMousePosition: vi.fn(),
}));

const dumpHwndMock = dumpWin32HwndAtPoint as ReturnType<typeof vi.fn>;
const mouseMock = getGlobalMousePosition as ReturnType<typeof vi.fn>;

describe("GET /v1/sessions/:sessionId/native-win32-hwnd-at-point", () => {
  let dir: string;
  let platformBackup: PropertyDescriptor | undefined;

  beforeEach(() => {
    platformBackup = Object.getOwnPropertyDescriptor(process, "platform");
    dumpHwndMock.mockReset();
    mouseMock.mockReset();
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
    if (platformBackup) Object.defineProperty(process, "platform", platformBackup);
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  it("returns 400 PLATFORM_UNSUPPORTED when not win32", async () => {
    setPlatform("linux");
    dir = await mkdtemp(path.join(tmpdir(), "od-hwnd-pt-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    const res = await request(app)
      .get("/v1/sessions/x/native-win32-hwnd-at-point")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PLATFORM_UNSUPPORTED");
    expect(dumpHwndMock).not.toHaveBeenCalled();
  });

  it("on win32 uses dumpWin32HwndAtPoint with explicit x,y", async () => {
    setPlatform("win32");
    dir = await mkdtemp(path.join(tmpdir(), "od-hwnd-pt-win-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpHwndMock.mockResolvedValue({
      ok: true,
      screenX: 10,
      screenY: 20,
      topLevel: {
        hwnd: 1,
        title: "t",
        className: "c",
        rect: { x: 0, y: 0, width: 100, height: 100 },
      },
      leafAtPoint: null,
      realChildOfRoot: null,
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 42,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-win32-hwnd-at-point?x=10&y=20")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.topLevel?.title).toBe("t");
    expect(dumpHwndMock).toHaveBeenCalledWith(42, { screenX: 10, screenY: 20 });
    spy.mockRestore();
  });

  it("on win32 returns 422 when no x,y and mouse fails", async () => {
    setPlatform("win32");
    dir = await mkdtemp(path.join(tmpdir(), "od-hwnd-mouse-"));
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
      .get("/v1/sessions/sid/native-win32-hwnd-at-point")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("MOUSE_POSITION_UNAVAILABLE");
    expect(dumpHwndMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("on win32 returns 400 HIT_OUTSIDE_SESSION when dump reports mismatch", async () => {
    setPlatform("win32");
    dir = await mkdtemp(path.join(tmpdir(), "od-hwnd-hit-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpHwndMock.mockResolvedValue({
      ok: false,
      code: "HIT_OUTSIDE_SESSION",
      message: "outside",
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 42,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-win32-hwnd-at-point?x=1&y=2")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("HIT_OUTSIDE_SESSION");
    expect(dumpHwndMock).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("on win32 returns 422 when dump reports NO_HWND_AT_POINT", async () => {
    setPlatform("win32");
    dir = await mkdtemp(path.join(tmpdir(), "od-hwnd-none-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "t", store, manager });
    dumpHwndMock.mockResolvedValue({
      ok: false,
      code: "NO_HWND_AT_POINT",
      message: "no window",
    });
    const spy = vi.spyOn(manager, "get").mockReturnValue({
      id: "sid",
      profileId: "p",
      state: "running",
      createdAt: new Date().toISOString(),
      pid: 1,
    });
    const res = await request(app)
      .get("/v1/sessions/sid/native-win32-hwnd-at-point?x=0&y=0")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NO_HWND_AT_POINT");
    spy.mockRestore();
  });
});
