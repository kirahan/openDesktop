import { parseReplayEnvelope } from "../session-replay/schema.js";
import type { ReplayEnvelope } from "../session-replay/schema.js";
import {
  TEST_RECORDING_KIND,
  TEST_RECORDING_SCHEMA_VERSION,
  type TestRecordingArtifact,
  type TestRecordingPageContext,
  type TestRecordingStep,
} from "./artifactSchema.js";

export type BuildArtifactFromReplayLinesInput = {
  replayLines: string[];
  appId: string;
  sessionId: string;
  targetId: string;
  recordedAt?: string;
  notes?: string;
  pageContext?: TestRecordingPageContext;
};

/**
 * 将矢量录制 NDJSON 行归并为测试录制制品（每条约一行 JSON，与 SSE data 帧一致）。
 */
export function buildTestRecordingArtifactFromReplayLines(
  input: BuildArtifactFromReplayLinesInput,
): { ok: true; artifact: TestRecordingArtifact } | { ok: false; error: string } {
  const { replayLines, appId, sessionId, targetId, notes } = input;
  const recordedAt = input.recordedAt ?? new Date().toISOString();

  const envelopes: ReplayEnvelope[] = [];
  for (let i = 0; i < replayLines.length; i++) {
    const line = replayLines[i]?.trim();
    if (!line) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      return { ok: false, error: `replayLines[${String(i)}]: invalid JSON` };
    }
    const env = parseReplayEnvelope(raw);
    if (!env) {
      return { ok: false, error: `replayLines[${String(i)}]: not a valid replay envelope` };
    }
    envelopes.push(env);
  }

  let lastStructureText = "";
  let lastViewport: { w: number; h: number } | undefined;
  const steps: TestRecordingStep[] = [];

  for (const env of envelopes) {
    if (env.type === "structure_snapshot") {
      lastStructureText = env.text;
      continue;
    }
    if (env.type === "pointermove" || env.type === "pointerdown" || env.type === "click") {
      lastViewport = { w: env.viewportWidth, h: env.viewportHeight };
    }
    if (env.type !== "click") continue;

    const anchor =
      lastStructureText.length > 4000 ? lastStructureText.slice(0, 4000) : lastStructureText;
    const step: TestRecordingStep = {
      ts: env.ts,
      action: "click",
      capture: {
        x: env.x,
        y: env.y,
        vectorTarget: env.target,
        ...(anchor ? { structureAnchor: anchor } : {}),
      },
    };
    steps.push(step);
  }

  const pageContext: TestRecordingPageContext | undefined =
    input.pageContext ??
    (lastViewport
      ? { viewportWidth: lastViewport.w, viewportHeight: lastViewport.h }
      : undefined);

  const artifact: TestRecordingArtifact = {
    schemaVersion: TEST_RECORDING_SCHEMA_VERSION,
    kind: TEST_RECORDING_KIND,
    recordedAt,
    appId,
    sessionId,
    targetId,
    steps,
    ...(pageContext ? { pageContext } : {}),
    ...(typeof notes === "string" && notes.length > 0 ? { notes } : {}),
  };

  return { ok: true, artifact };
}
