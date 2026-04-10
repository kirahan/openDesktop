import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { createApp } from "./createApp.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";

vi.mock("../userScripts/collectScriptBodiesForApp.js", () => ({
  collectScriptBodiesForApp: vi.fn(),
}));

vi.mock("../cdp/injectUserScripts.js", () => ({
  injectUserScriptsIntoPageTargets: vi.fn(),
}));

import { collectScriptBodiesForApp } from "../userScripts/collectScriptBodiesForApp.js";
import { injectUserScriptsIntoPageTargets } from "../cdp/injectUserScripts.js";

const mockCollect = vi.mocked(collectScriptBodiesForApp);
const mockInject = vi.mocked(injectUserScriptsIntoPageTargets);

describe("POST /v1/sessions/:sessionId/user-scripts/inject", () => {
  let dir: string;
  let store: JsonFileStore;
  let manager: SessionManager;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function seedAppAndProfile() {
    dir = await mkdtemp(path.join(tmpdir(), "od-inj-"));
    store = new JsonFileStore(dir);
    manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    await request(app)
      .post("/v1/apps")
      .set("Authorization", "Bearer tok")
      .send({ id: "a1", executable: "/bin/sh", cwd: "/", args: [] });
    await request(app)
      .post("/v1/profiles")
      .set("Authorization", "Bearer tok")
      .send({ id: "prof1", appId: "a1" });
    return app;
  }

  it("returns 404 when session missing", async () => {
    const app = await seedAppAndProfile();
    const res = await request(app)
      .post("/v1/sessions/nope/user-scripts/inject")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns 403 when allowScriptExecution is false", async () => {
    const app = await seedAppAndProfile();
    vi.spyOn(manager, "get").mockReturnValue({
      id: "s1",
      profileId: "prof1",
      state: "running",
      createdAt: new Date().toISOString(),
      allowScriptExecution: false,
    });
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9222,
      allowScriptExecution: false,
    });
    const res = await request(app)
      .post("/v1/sessions/s1/user-scripts/inject")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SCRIPT_NOT_ALLOWED");
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it("returns 503 when session not running", async () => {
    const app = await seedAppAndProfile();
    vi.spyOn(manager, "get").mockReturnValue({
      id: "s1",
      profileId: "prof1",
      state: "starting",
      createdAt: new Date().toISOString(),
      allowScriptExecution: true,
    });
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "starting",
      cdpPort: 9222,
      allowScriptExecution: true,
    });
    const res = await request(app)
      .post("/v1/sessions/s1/user-scripts/inject")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CDP_NOT_READY");
  });

  it("returns 200 with zeros when no script bodies", async () => {
    const app = await seedAppAndProfile();
    vi.spyOn(manager, "get").mockReturnValue({
      id: "s1",
      profileId: "prof1",
      state: "running",
      createdAt: new Date().toISOString(),
      allowScriptExecution: true,
    });
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9222,
      allowScriptExecution: true,
    });
    mockCollect.mockResolvedValue([]);
    const res = await request(app)
      .post("/v1/sessions/s1/user-scripts/inject")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ injectedScripts: 0, targets: 0, errors: [] });
    expect(mockInject).not.toHaveBeenCalled();
  });

  it("returns 503 when CDP inject fails", async () => {
    const app = await seedAppAndProfile();
    vi.spyOn(manager, "get").mockReturnValue({
      id: "s1",
      profileId: "prof1",
      state: "running",
      createdAt: new Date().toISOString(),
      allowScriptExecution: true,
    });
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9222,
      allowScriptExecution: true,
    });
    mockCollect.mockResolvedValue([{ id: "sc1", body: "void 0" }]);
    mockInject.mockResolvedValue({ error: "no_browser_ws" });
    const res = await request(app)
      .post("/v1/sessions/s1/user-scripts/inject")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CDP_NOT_READY");
  });

  it("returns 200 with inject summary on success", async () => {
    const app = await seedAppAndProfile();
    vi.spyOn(manager, "get").mockReturnValue({
      id: "s1",
      profileId: "prof1",
      state: "running",
      createdAt: new Date().toISOString(),
      allowScriptExecution: true,
    });
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9222,
      allowScriptExecution: true,
    });
    mockCollect.mockResolvedValue([{ id: "sc1", body: "void 0" }]);
    mockInject.mockResolvedValue({
      injectedScripts: 2,
      targets: 1,
      errors: [],
    });
    const res = await request(app)
      .post("/v1/sessions/s1/user-scripts/inject")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      injectedScripts: 2,
      targets: 1,
      errors: [],
    });
    expect(mockInject).toHaveBeenCalledWith(9222, [{ id: "sc1", body: "void 0" }]);
  });
});
