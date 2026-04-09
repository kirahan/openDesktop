import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as atomicWrite from "../recipes/atomicWrite.js";
import { loadConfig } from "../config.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";
import { createApp } from "./createApp.js";

const clickMock = vi.fn();
const getHtmlMock = vi.fn();

vi.mock("../cdp/browserClient.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../cdp/browserClient.js")>();
  return {
    ...mod,
    clickOnTarget: (...args: unknown[]) => clickMock(...args) as ReturnType<typeof mod.clickOnTarget>,
    getTargetDocumentOuterHtml: (...args: unknown[]) =>
      getHtmlMock(...args) as ReturnType<typeof mod.getTargetDocumentOuterHtml>,
  };
});

describe("agent recipe HTTP", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });
  beforeEach(() => {
    clickMock.mockReset();
    getHtmlMock.mockReset();
  });

  it("POST run returns 403 when allowScriptExecution is false", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-rcp-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9123,
      pid: 99,
      allowScriptExecution: false,
    });

    const res = await request(app)
      .post("/v1/agent/sessions/s1/recipes/app1/r1/run")
      .set("Authorization", "Bearer tok")
      .send({ targetId: "tid" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SCRIPT_NOT_ALLOWED");
    expect(clickMock).not.toHaveBeenCalled();
  });

  it("POST run persists recipe on success", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-rcp-"));
    const recipesRoot = path.join(dir, "recipes");
    await mkdir(path.join(recipesRoot, "app1"), { recursive: true });
    const recipePath = path.join(recipesRoot, "app1", "r1.json");
    await writeFile(
      recipePath,
      JSON.stringify({
        schemaVersion: 1,
        id: "r1",
        name: "One",
        steps: [{ action: "click", selector: "#ok" }],
      }),
      "utf8",
    );

    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9123,
      pid: 99,
      allowScriptExecution: true,
    });
    clickMock.mockResolvedValue({ ok: true });

    const res = await request(app)
      .post("/v1/agent/sessions/s1/recipes/app1/r1/run")
      .set("Authorization", "Bearer tok")
      .send({ targetId: "tid", verifiedBuild: "9.9.9" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.persisted).toBe(true);
    expect(clickMock).toHaveBeenCalledWith(9123, "tid", "#ok");
    const disk = JSON.parse(await readFile(recipePath, "utf8")) as { updatedAt?: string; verifiedBuild?: string };
    expect(disk.verifiedBuild).toBe("9.9.9");
    expect(disk.updatedAt).toBeDefined();
  });

  it("POST run returns 500 with executionOk when persist fails", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-rcp-"));
    const recipesRoot = path.join(dir, "recipes");
    await mkdir(path.join(recipesRoot, "app1"), { recursive: true });
    const recipePath = path.join(recipesRoot, "app1", "r1.json");
    await writeFile(
      recipePath,
      JSON.stringify({
        schemaVersion: 1,
        id: "r1",
        name: "One",
        steps: [{ action: "click", selector: "#ok" }],
      }),
      "utf8",
    );

    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9123,
      pid: 99,
      allowScriptExecution: true,
    });
    clickMock.mockResolvedValue({ ok: true });
    const spy = vi.spyOn(atomicWrite, "writeJsonAtomic").mockRejectedValueOnce(new Error("eacces"));

    const res = await request(app)
      .post("/v1/agent/sessions/s1/recipes/app1/r1/run")
      .set("Authorization", "Bearer tok")
      .send({ targetId: "tid" });

    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("RECIPE_PERSIST_FAILED");
    expect(res.body.executionOk).toBe(true);
    expect(res.body.persisted).toBe(false);
  });

  it("GET list returns recipe id and name", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-rcp-"));
    const recipesRoot = path.join(dir, "recipes");
    await mkdir(path.join(recipesRoot, "app1"), { recursive: true });
    await writeFile(
      path.join(recipesRoot, "app1", "r1.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "r1",
        name: "Listed",
        steps: [{ action: "click", selector: "#x" }],
      }),
      "utf8",
    );

    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    vi.spyOn(manager, "getOpsContext").mockReturnValue({
      state: "running",
      cdpPort: 9123,
      pid: 99,
      allowScriptExecution: true,
    });

    const res = await request(app)
      .get("/v1/agent/sessions/s1/recipes?app=app1")
      .set("Authorization", "Bearer tok");

    expect(res.status).toBe(200);
    expect(res.body.recipes).toEqual([{ appSlug: "app1", id: "r1", name: "Listed" }]);
  });
});
