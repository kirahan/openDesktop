import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "./atomicWrite.js";

describe("writeJsonAtomic", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });

  it("writes readable JSON", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-at-"));
    const fp = path.join(dir, "sub", "x.json");
    await writeJsonAtomic(fp, { a: 1 });
    const raw = await readFile(fp, "utf8");
    expect(JSON.parse(raw)).toEqual({ a: 1 });
  });
});
