import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";
import { createApp } from "./createApp.js";

const { openMock, cookiesMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock("../cdp/browserClient.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../cdp/browserClient.js")>();
  return {
    ...mod,
    openTargetUrl: (...args: unknown[]) => openMock(...args) as ReturnType<typeof mod.openTargetUrl>,
    getNetworkCookiesForTarget: (...args: unknown[]) =>
      cookiesMock(...args) as ReturnType<typeof mod.getNetworkCookiesForTarget>,
  };
});

describe("POST /v1/agent/.../actions open & network (mocked CDP)", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });
  beforeEach(() => {
    openMock.mockReset();
    cookiesMock.mockReset();
    openMock.mockResolvedValue({ ok: true });
    cookiesMock.mockResolvedValue({ cookies: [{ name: "sid", value: "1" }] });
  });

  it("open invokes openTargetUrl when session allows script", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-ag-"));
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
      .post("/v1/agent/sessions/any/actions")
      .set("Authorization", "Bearer tok")
      .send({ action: "open", targetId: "tid", url: "https://a.example" });

    expect(res.status).toBe(200);
    expect(openMock).toHaveBeenCalledWith(9123, "tid", "https://a.example");
  });

  it("open returns 403 when allowScriptExecution is false", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-ag-"));
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
      .post("/v1/agent/sessions/any/actions")
      .set("Authorization", "Bearer tok")
      .send({ action: "open", targetId: "tid", url: "https://a.example" });

    expect(res.status).toBe(403);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("network returns cookies from getNetworkCookiesForTarget", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-ag-"));
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
      .post("/v1/agent/sessions/any/actions")
      .set("Authorization", "Bearer tok")
      .send({ action: "network", targetId: "tid", urls: ["https://a.example"] });

    expect(res.status).toBe(200);
    expect(res.body.cookies).toEqual([{ name: "sid", value: "1" }]);
    expect(cookiesMock).toHaveBeenCalledWith(9123, "tid", ["https://a.example"]);
  });
});
