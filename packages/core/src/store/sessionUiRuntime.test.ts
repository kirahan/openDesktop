import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonFileStore } from "./jsonStore.js";
import { enrichSessionsWithUiRuntime } from "./sessionUiRuntime.js";
import type { SessionRecord } from "../session/types.js";

describe("enrichSessionsWithUiRuntime", () => {
  it("maps profile app uiRuntime onto sessions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "od-ur-"));
    try {
      await writeFile(
        path.join(dir, "apps.json"),
        JSON.stringify({
          schemaVersion: 1,
          apps: [
            {
              id: "myqt",
              name: "q",
              executable: "/q",
              cwd: "/",
              env: {},
              args: [],
              uiRuntime: "qt",
              injectElectronDebugPort: false,
            },
          ],
        }),
        "utf8",
      );
      await writeFile(
        path.join(dir, "profiles.json"),
        JSON.stringify({
          schemaVersion: 1,
          profiles: [{ id: "p1", appId: "myqt", name: "p", env: {}, extraArgs: [] }],
        }),
        "utf8",
      );
      const store = new JsonFileStore(dir);
      const sessions: SessionRecord[] = [
        {
          id: "s1",
          profileId: "p1",
          state: "running",
          createdAt: new Date().toISOString(),
        },
      ];
      const out = await enrichSessionsWithUiRuntime(store, sessions);
      expect(out[0]?.uiRuntime).toBe("qt");
    } finally {
      await rm(dir, { recursive: true }).catch(() => undefined);
    }
  });

  it("defaults to electron when app omits uiRuntime", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "od-ur-"));
    try {
      await writeFile(
        path.join(dir, "apps.json"),
        JSON.stringify({
          schemaVersion: 1,
          apps: [
            {
              id: "app1",
              name: "a",
              executable: "/a",
              cwd: "/",
              env: {},
              args: [],
              injectElectronDebugPort: true,
            },
          ],
        }),
        "utf8",
      );
      await writeFile(
        path.join(dir, "profiles.json"),
        JSON.stringify({
          schemaVersion: 1,
          profiles: [{ id: "p1", appId: "app1", name: "p", env: {}, extraArgs: [] }],
        }),
        "utf8",
      );
      const store = new JsonFileStore(dir);
      const sessions: SessionRecord[] = [
        {
          id: "s1",
          profileId: "p1",
          state: "running",
          createdAt: new Date().toISOString(),
        },
      ];
      const out = await enrichSessionsWithUiRuntime(store, sessions);
      expect(out[0]?.uiRuntime).toBe("electron");
    } finally {
      await rm(dir, { recursive: true }).catch(() => undefined);
    }
  });
});
