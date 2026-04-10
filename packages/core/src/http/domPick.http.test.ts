import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { createApp } from "./createApp.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";

vi.mock("../cdp/domPick.js", () => ({
  domPickArm: vi.fn(),
  domPickResolve: vi.fn(),
  domPickCancel: vi.fn(),
}));

import { domPickArm, domPickCancel, domPickResolve } from "../cdp/domPick.js";

const mockArm = vi.mocked(domPickArm);
const mockResolve = vi.mocked(domPickResolve);
const mockCancel = vi.mocked(domPickCancel);

describe("dom-pick HTTP", () => {
  let dir: string;

  afterEach(async () => {
    vi.clearAllMocks();
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });

  async function setup() {
    dir = await mkdtemp(path.join(tmpdir(), "od-dp-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    return { app, manager };
  }

  it("arm returns 403 when allowScriptExecution is false", async () => {
    const { app, manager } = await setup();
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9222,
      allowScriptExecution: false,
    });
    const res = await request(app)
      .post("/v1/sessions/s1/targets/t1/dom-pick/arm")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SCRIPT_NOT_ALLOWED");
    expect(mockArm).not.toHaveBeenCalled();
  });

  it("resolve returns 400 DOM_PICK_EMPTY when mock says empty", async () => {
    const { app, manager } = await setup();
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9222,
      allowScriptExecution: true,
    });
    mockResolve.mockResolvedValue({
      ok: false,
      code: "DOM_PICK_EMPTY",
      message: "no pick",
    });
    const res = await request(app)
      .post("/v1/sessions/s1/targets/t1/dom-pick/resolve")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("DOM_PICK_EMPTY");
  });

  it("arm returns 200 when CDP succeeds", async () => {
    const { app, manager } = await setup();
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9222,
      allowScriptExecution: true,
    });
    mockArm.mockResolvedValue({ armed: true });
    const res = await request(app)
      .post("/v1/sessions/s1/targets/t1/dom-pick/arm")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ armed: true });
    expect(mockArm).toHaveBeenCalledWith(9222, "t1");
  });

  it("resolve returns 200 with pick and node", async () => {
    const { app, manager } = await setup();
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9222,
      allowScriptExecution: true,
    });
    mockResolve.mockResolvedValue({
      ok: true,
      pick: { x: 10, y: 20, ts: 1 },
      node: {
        nodeName: "DIV",
        localName: "div",
        nodeType: 1,
        nodeId: 5,
        backendNodeId: 42,
        selectorHint: "div",
      },
      highlightApplied: true,
      highlightMethod: "page-inject",
      highlightPersistNote: "test",
    });
    const res = await request(app)
      .post("/v1/sessions/s1/targets/t1/dom-pick/resolve")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(200);
    expect(res.body.pick).toEqual({ x: 10, y: 20, ts: 1 });
    expect(res.body.node.nodeName).toBe("DIV");
    expect(res.body.highlightApplied).toBe(true);
    expect(res.body.highlightMethod).toBe("page-inject");
  });

  it("cancel returns 200 when CDP succeeds", async () => {
    const { app, manager } = await setup();
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9222,
      allowScriptExecution: true,
    });
    mockCancel.mockResolvedValue({ cleared: true });
    const res = await request(app)
      .post("/v1/sessions/s1/targets/t1/dom-pick/cancel")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cleared: true });
    expect(mockCancel).toHaveBeenCalledWith(9222, "t1");
  });
});
