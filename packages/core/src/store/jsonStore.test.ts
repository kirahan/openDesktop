import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileStore } from "./jsonStore.js";

describe("JsonFileStore", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });

  it("atomicWriteJson produces readable apps.json with schemaVersion", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-json-"));
    const store = new JsonFileStore(dir);
    await store.writeApps([
      {
        id: "a1",
        name: "a",
        executable: "/bin/node",
        cwd: dir,
        env: {},
        args: [],
        injectElectronDebugPort: false,
      },
    ]);
    const raw = await readFile(path.join(dir, "apps.json"), "utf8");
    const parsed = JSON.parse(raw) as { schemaVersion: number; apps: unknown[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.apps).toHaveLength(1);
  });

  it("readApps throws on corrupt JSON", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-json-"));
    const store = new JsonFileStore(dir);
    await store.writeCorruptApps();
    await expect(store.readApps()).rejects.toThrow();
  });
});
