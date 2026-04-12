import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_RECORDING_KIND, TEST_RECORDING_SCHEMA_VERSION } from "./artifactSchema.js";
import {
  listTestRecordingIds,
  readTestRecordingArtifact,
  writeTestRecordingArtifact,
} from "./writeArtifact.js";

describe("writeTestRecordingArtifact", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true }).catch(() => undefined);
  });

  it("writes atomically and reads back", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-trec-"));
    const artifact = {
      schemaVersion: TEST_RECORDING_SCHEMA_VERSION,
      kind: TEST_RECORDING_KIND,
      recordedAt: "2026-01-01T00:00:00.000Z",
      appId: "appX",
      sessionId: "s",
      targetId: "t",
      steps: [{ ts: 1, action: "click", capture: { x: 0, y: 0 } }],
    };
    const { absolutePath } = await writeTestRecordingArtifact(dir, "appX", "rec1", artifact);
    expect(absolutePath).toContain("test-recording-rec1.json");
    const raw = await readFile(absolutePath, "utf8");
    expect(raw).toContain('"appId": "appX"');
    const again = await readTestRecordingArtifact(dir, "appX", "rec1");
    expect(again?.sessionId).toBe("s");
  });

  it("lists recording ids", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "od-trec-"));
    const artifact = {
      schemaVersion: TEST_RECORDING_SCHEMA_VERSION,
      kind: TEST_RECORDING_KIND,
      recordedAt: "2026-01-01T00:00:00.000Z",
      appId: "appX",
      sessionId: "s",
      targetId: "t",
      steps: [{ ts: 1, action: "click", capture: { x: 0, y: 0 } }],
    };
    await writeTestRecordingArtifact(dir, "appX", "a", artifact);
    await writeTestRecordingArtifact(dir, "appX", "b", artifact);
    const ids = await listTestRecordingIds(dir, "appX");
    expect(ids).toEqual(["a", "b"]);
  });
});
