import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileStore } from "../store/jsonStore.js";
import { collectScriptBodiesForApp } from "./collectScriptBodiesForApp.js";

const HEADER = (name: string) => `// ==UserScript==
// @name         ${name}
// @grant        none
// ==/UserScript==
console.log('${name}');
`;

describe("collectScriptBodiesForApp", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });

  it("returns bodies sorted by id with non-empty body only", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-csb-"));
    const store = new JsonFileStore(dir);
    const now = new Date().toISOString();
    await store.writeUserScripts([
      {
        id: "b",
        appId: "app1",
        source: HEADER("B"),
        metadata: { name: "B", matches: [], grant: "none" },
        updatedAt: now,
      },
      {
        id: "a",
        appId: "app1",
        source: HEADER("A"),
        metadata: { name: "A", matches: [], grant: "none" },
        updatedAt: now,
      },
      {
        id: "c",
        appId: "app2",
        source: HEADER("C"),
        metadata: { name: "C", matches: [], grant: "none" },
        updatedAt: now,
      },
    ]);

    const rows = await collectScriptBodiesForApp(store, "app1");
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0]?.body).toContain("console.log");
  });
});
