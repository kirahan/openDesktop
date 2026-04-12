/**
 * LLM 用测试录制制品 schema（与 openspec test-recording-llm-capture 对齐）。
 */

import { parseReplayClickTarget, type ReplayClickTarget } from "../session-replay/schema.js";

export const TEST_RECORDING_SCHEMA_VERSION = 1 as const;
export const TEST_RECORDING_KIND = "opendesktop.test_recording" as const;

export type TestRecordingPageContext = {
  viewportWidth: number;
  viewportHeight: number;
  pageUrl?: string;
  documentTitle?: string;
};

export type TestRecordingStepCapture = {
  x: number;
  y: number;
  vectorTarget?: ReplayClickTarget;
  domPick?: unknown;
  structureAnchor?: string;
};

export type TestRecordingStepHuman = {
  actionDescription?: string;
  expectedDescription?: string;
};

export type TestRecordingStep = {
  ts: number;
  action: string;
  capture: TestRecordingStepCapture;
  human?: TestRecordingStepHuman;
};

export type TestRecordingArtifact = {
  schemaVersion: typeof TEST_RECORDING_SCHEMA_VERSION;
  kind: typeof TEST_RECORDING_KIND;
  recordedAt: string;
  appId: string;
  sessionId: string;
  targetId: string;
  pageContext?: TestRecordingPageContext;
  notes?: string;
  steps: TestRecordingStep[];
};

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function parsePageContext(raw: unknown): TestRecordingPageContext | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNum(o.viewportWidth) || !isFiniteNum(o.viewportHeight)) return undefined;
  const out: TestRecordingPageContext = {
    viewportWidth: o.viewportWidth,
    viewportHeight: o.viewportHeight,
  };
  if (typeof o.pageUrl === "string") out.pageUrl = o.pageUrl;
  if (typeof o.documentTitle === "string") out.documentTitle = o.documentTitle;
  return out;
}

function parseStepHuman(raw: unknown): TestRecordingStepHuman | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: TestRecordingStepHuman = {};
  if (typeof o.actionDescription === "string") out.actionDescription = o.actionDescription;
  if (typeof o.expectedDescription === "string") out.expectedDescription = o.expectedDescription;
  return Object.keys(out).length ? out : undefined;
}

function parseCapture(raw: unknown): TestRecordingStepCapture | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNum(o.x) || !isFiniteNum(o.y)) return null;
  const cap: TestRecordingStepCapture = { x: o.x, y: o.y };
  if (o.vectorTarget !== undefined) {
    const vt = parseReplayClickTarget(o.vectorTarget);
    if (!vt) return null;
    cap.vectorTarget = vt;
  }
  if (o.domPick !== undefined) cap.domPick = o.domPick;
  if (typeof o.structureAnchor === "string") cap.structureAnchor = o.structureAnchor;
  return cap;
}

function parseStep(raw: unknown): TestRecordingStep | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNum(o.ts)) return null;
  if (typeof o.action !== "string" || o.action.length === 0) return null;
  const capture = parseCapture(o.capture);
  if (!capture) return null;
  const human = parseStepHuman(o.human);
  const step: TestRecordingStep = { ts: o.ts, action: o.action, capture };
  if (human) step.human = human;
  return step;
}

/**
 * 校验并解析制品 JSON；非法返回 null。
 */
export function parseTestRecordingArtifact(raw: unknown): TestRecordingArtifact | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== TEST_RECORDING_SCHEMA_VERSION) return null;
  if (o.kind !== TEST_RECORDING_KIND) return null;
  if (typeof o.appId !== "string" || o.appId.length === 0) return null;
  if (typeof o.sessionId !== "string" || o.sessionId.length === 0) return null;
  if (typeof o.targetId !== "string" || o.targetId.length === 0) return null;
  if (typeof o.recordedAt !== "string" || o.recordedAt.length === 0) return null;
  if (!Array.isArray(o.steps)) return null;

  const steps: TestRecordingStep[] = [];
  for (const s of o.steps) {
    const step = parseStep(s);
    if (!step) return null;
    steps.push(step);
  }

  const out: TestRecordingArtifact = {
    schemaVersion: TEST_RECORDING_SCHEMA_VERSION,
    kind: TEST_RECORDING_KIND,
    recordedAt: o.recordedAt,
    appId: o.appId,
    sessionId: o.sessionId,
    targetId: o.targetId,
    steps,
  };
  const pc = parsePageContext(o.pageContext);
  if (pc) out.pageContext = pc;
  if (typeof o.notes === "string") out.notes = o.notes;
  return out;
}
