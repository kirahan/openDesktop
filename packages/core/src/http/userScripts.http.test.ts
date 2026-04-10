import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { createApp } from "./createApp.js";
import { SessionManager } from "../session/manager.js";
import { JsonFileStore } from "../store/jsonStore.js";

const HEADER = `// ==UserScript==
// @name         Multi
// @namespace    http://n/
// @version      1.0
// @match        https://a.example.com/*
// @match        https://b.example.com/*
// @grant        none
// ==/UserScript==
void 0;
`;

describe("user-scripts HTTP", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });

  async function setupApp() {
    dir = await mkdtemp(path.join(tmpdir(), "od-us-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    const reg = await request(app)
      .post("/v1/apps")
      .set("Authorization", "Bearer tok")
      .send({ id: "my-app", executable: "/bin/sh", cwd: "/", args: [] });
    expect(reg.status).toBe(201);
    return { app };
  }

  it("POST creates script with matches; GET lists", async () => {
    const { app } = await setupApp();
    const post = await request(app)
      .post("/v1/apps/my-app/user-scripts")
      .set("Authorization", "Bearer tok")
      .send({ source: HEADER });
    expect(post.status).toBe(201);
    expect(post.body.script.metadata.matches).toEqual([
      "https://a.example.com/*",
      "https://b.example.com/*",
    ]);
    expect(post.body.script.metadata.name).toBe("Multi");
    const id = post.body.script.id as string;

    const list = await request(app)
      .get("/v1/apps/my-app/user-scripts")
      .set("Authorization", "Bearer tok");
    expect(list.status).toBe(200);
    expect(list.body.scripts).toHaveLength(1);
    expect(list.body.scripts[0].id).toBe(id);

    const one = await request(app)
      .get(`/v1/apps/my-app/user-scripts/${id}`)
      .set("Authorization", "Bearer tok");
    expect(one.status).toBe(200);
    expect(one.body.script.source).toContain("@match");
  });

  it("rejects bad grant", async () => {
    const { app } = await setupApp();
    const bad = `// ==UserScript==
// @name x
// @grant GM_getValue
// ==/UserScript==
`;
    const post = await request(app)
      .post("/v1/apps/my-app/user-scripts")
      .set("Authorization", "Bearer tok")
      .send({ source: bad });
    expect(post.status).toBe(400);
    expect(post.body.error.code).toBe("USER_SCRIPT_GRANT_NOT_SUPPORTED");
  });

  it("404 when app missing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-us-"));
    const store = new JsonFileStore(dir);
    const manager = new SessionManager(store, dir);
    const config = loadConfig({ dataDir: dir });
    const { app } = createApp({ config, token: "tok", store, manager });
    const res = await request(app)
      .post("/v1/apps/nope/user-scripts")
      .set("Authorization", "Bearer tok")
      .send({ source: HEADER });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("APP_NOT_FOUND");
  });

  it("DELETE removes script", async () => {
    const { app } = await setupApp();
    const post = await request(app)
      .post("/v1/apps/my-app/user-scripts")
      .set("Authorization", "Bearer tok")
      .send({ source: HEADER });
    const id = post.body.script.id as string;
    const del = await request(app)
      .delete(`/v1/apps/my-app/user-scripts/${id}`)
      .set("Authorization", "Bearer tok");
    expect(del.status).toBe(204);
    const list = await request(app)
      .get("/v1/apps/my-app/user-scripts")
      .set("Authorization", "Bearer tok");
    expect(list.body.scripts).toHaveLength(0);
  });
});
