import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";
import { createApp } from "./createApp.js";

const { openMock, cookiesMock, globalsMock, getDomMock, observeMock, runtimeExceptionMock } = vi.hoisted(
  () => ({
    openMock: vi.fn(),
    cookiesMock: vi.fn(),
    globalsMock: vi.fn(),
    getDomMock: vi.fn(),
    observeMock: vi.fn(),
    runtimeExceptionMock: vi.fn(),
  }),
);

vi.mock("../cdp/browserClient.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../cdp/browserClient.js")>();
  return {
    ...mod,
    openTargetUrl: (...args: unknown[]) => openMock(...args) as ReturnType<typeof mod.openTargetUrl>,
    getNetworkCookiesForTarget: (...args: unknown[]) =>
      cookiesMock(...args) as ReturnType<typeof mod.getNetworkCookiesForTarget>,
    getTargetDocumentOuterHtml: (...args: unknown[]) =>
      getDomMock(...args) as ReturnType<typeof mod.getTargetDocumentOuterHtml>,
    collectRuntimeExceptionForTarget: (...args: unknown[]) =>
      runtimeExceptionMock(...args) as ReturnType<typeof mod.collectRuntimeExceptionForTarget>,
  };
});

vi.mock("../cdp/rendererGlobalSnapshot.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../cdp/rendererGlobalSnapshot.js")>();
  return {
    ...mod,
    collectRendererGlobalSnapshotOnTarget: (...args: unknown[]) =>
      globalsMock(...args) as ReturnType<typeof mod.collectRendererGlobalSnapshotOnTarget>,
  };
});

vi.mock("../cdp/networkObserve.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../cdp/networkObserve.js")>();
  return {
    ...mod,
    collectNetworkObservationForTarget: observeMock,
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
    globalsMock.mockReset();
    getDomMock.mockReset();
    runtimeExceptionMock.mockReset();
    observeMock.mockReset();
    openMock.mockResolvedValue({ ok: true });
    cookiesMock.mockResolvedValue({ cookies: [{ name: "sid", value: "1" }] });
    getDomMock.mockResolvedValue({
      html: '<!DOCTYPE html><html><body><button id="go">Go</button></body></html>',
      truncated: false,
    });
    globalsMock.mockResolvedValue({
      snapshot: {
        collectedAt: "t",
        locationHref: null,
        userAgent: null,
        globalNames: ["x"],
        entries: [{ name: "x", kind: "object" }],
        truncated: false,
      },
    });
    observeMock.mockResolvedValue({
      schemaVersion: 1,
      windowMs: 3000,
      totalRequests: 0,
      completedRequests: 0,
      maxConcurrent: 0,
      slowRequests: [],
      truncated: false,
      inflightAtEnd: 0,
      slowThresholdMs: 1000,
      stripQuery: true,
    });
    runtimeExceptionMock.mockResolvedValue({
      text: "err",
      textTruncated: false,
      frames: [{ functionName: "fn", url: "https://a/x.js", lineNumber: 1, columnNumber: 0 }],
      note: "n",
    });
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

  it("network-observe returns aggregated observation JSON", async () => {
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
      .send({
        action: "network-observe",
        targetId: "tid",
        windowMs: 500,
        slowThresholdMs: 800,
        maxSlowRequests: 5,
        stripQuery: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe(1);
    expect(res.body.totalRequests).toBe(0);
    expect(observeMock).toHaveBeenCalledWith(9123, "tid", {
      windowMs: 500,
      slowThresholdMs: 800,
      maxSlowRequests: 5,
      stripQuery: false,
    });
  });

  it("network-observe returns 502 when CDP observation fails", async () => {
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
    observeMock.mockResolvedValueOnce({ error: "no_browser_ws" });

    const res = await request(app)
      .post("/v1/agent/sessions/any/actions")
      .set("Authorization", "Bearer tok")
      .send({ action: "network-observe", targetId: "tid" });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("NETWORK_OBSERVE_FAILED");
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

  it("renderer-globals returns snapshot when allowScriptExecution is true", async () => {
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
      .send({ action: "renderer-globals", targetId: "tid", interestPattern: "^a" });

    expect(res.status).toBe(200);
    expect(res.body.globalNames).toEqual(["x"]);
    expect(globalsMock).toHaveBeenCalledWith(9123, "tid", { interestPattern: "^a", maxKeys: undefined });
  });

  it("runtime-exception returns frames when allowScriptExecution is true", async () => {
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
      .send({ action: "runtime-exception", targetId: "tid", waitMs: 500 });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe("err");
    expect(res.body.frames).toHaveLength(1);
    expect(res.body.waitMs).toBe(500);
    expect(runtimeExceptionMock).toHaveBeenCalledWith(9123, "tid", 500);
  });

  it("runtime-exception returns 403 when allowScriptExecution is false", async () => {
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
      .send({ action: "runtime-exception", targetId: "tid" });

    expect(res.status).toBe(403);
    expect(runtimeExceptionMock).not.toHaveBeenCalled();
  });

  it("runtime-exception returns 502 when CDP collection fails", async () => {
    runtimeExceptionMock.mockResolvedValueOnce({ error: "no_browser_ws" });
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
      .send({ action: "runtime-exception", targetId: "tid" });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("RUNTIME_EXCEPTION_FAILED");
  });

  it("runtime-exception returns empty frames when CDP reports no event in window", async () => {
    runtimeExceptionMock.mockResolvedValueOnce({
      text: "",
      textTruncated: false,
      frames: [],
      note: "quiet",
    });
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
      .send({ action: "runtime-exception", targetId: "tid" });

    expect(res.status).toBe(200);
    expect(res.body.frames).toEqual([]);
    expect(res.body.note).toBe("quiet");
  });

  it("renderer-globals returns 403 when allowScriptExecution is false", async () => {
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
      .send({ action: "renderer-globals", targetId: "tid" });

    expect(res.status).toBe(403);
    expect(globalsMock).not.toHaveBeenCalled();
  });

  it("explore returns candidates from HTML (same path as get)", async () => {
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
      .send({ action: "explore", targetId: "tid", maxCandidates: 10 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.candidates)).toBe(true);
    expect(res.body.candidates.some((c: { label?: string }) => c.label === "Go")).toBe(true);
    expect(res.body.htmlTruncated).toBe(false);
    expect(getDomMock).toHaveBeenCalledWith(9123, "tid");
  });

  it("explore returns DOM_FAILED when getTargetDocumentOuterHtml fails", async () => {
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
    getDomMock.mockResolvedValueOnce({ error: "cdp down" });

    const res = await request(app)
      .post("/v1/agent/sessions/any/actions")
      .set("Authorization", "Bearer tok")
      .send({ action: "explore", targetId: "tid" });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("DOM_FAILED");
  });

  it("renderer-globals returns 400 for invalid interestPattern without calling CDP", async () => {
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
      .send({ action: "renderer-globals", targetId: "tid", interestPattern: "[" });

    expect(res.status).toBe(400);
    expect(globalsMock).not.toHaveBeenCalled();
  });
});
