/**
 * 全局快捷键闭集动作的控制面：由 Electron 主进程或任意客户端直接 POST，业务仅在 Core 内编排。
 *
 * **targetIds 省略时**：拉取 CDP `/json/list`，取 `type === "page"` 的 target（与矢量录制 page target 一致）。
 */
import type { SessionManager } from "../session/manager.js";
import { collectTopologySnapshot } from "../topology/fetchTopology.js";
import {
  emitPageRecordingStudioUiMarker,
  isPageRecordingActive,
  startPageRecording,
  stopPageRecording,
  sweepStalePageRecordings,
  type ReplayUiCommand,
} from "../session-replay/recordingService.js";

export const GLOBAL_SHORTCUT_ACTION_IDS = [
  "vector-record-toggle",
  "segment-start",
  "segment-end",
  "checkpoint",
] as const;

export type GlobalShortcutActionId = (typeof GLOBAL_SHORTCUT_ACTION_IDS)[number];

export type GlobalShortcutControlBody = {
  actionId?: string;
  /** 显式指定 target；省略时由 CDP 拓扑解析 page 型 target */
  targetIds?: string[];
  /** segment / checkpoint 单 target；多 page 时必填 */
  targetId?: string;
  injectPageControls?: boolean;
};

export type ShortcutTargetResult = {
  targetId: string;
  ok: boolean;
  code?: string;
  message?: string;
};

function isClosedActionId(id: string): id is GlobalShortcutActionId {
  return (GLOBAL_SHORTCUT_ACTION_IDS as readonly string[]).includes(id);
}

/** 从拓扑中取适合矢量录制的 page target（CDP type 一般为 `page`）。 */
export function pageTargetIdsFromTopology(nodes: { targetId: string; type: string }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.type !== "page") continue;
    if (seen.has(n.targetId)) continue;
    seen.add(n.targetId);
    out.push(n.targetId);
  }
  return out;
}

/**
 * 解析本次动作涉及的 `targetId` 列表（矢量批量）或校验单 target。
 */
export async function resolveShortcutTargets(
  manager: SessionManager,
  sessionId: string,
  body: GlobalShortcutControlBody,
  mode: "vector-batch" | "single-ui",
): Promise<{ ok: true; targetIds: string[] } | { ok: false; code: string; message: string }> {
  const ctx = manager.getOpsContext(sessionId);
  if (!ctx) return { ok: false, code: "SESSION_NOT_FOUND", message: "Session not found" };
  if (ctx.state !== "running" || !ctx.cdpPort) {
    return { ok: false, code: "CDP_NOT_READY", message: "Session has no active CDP endpoint" };
  }

  const explicit = Array.isArray(body.targetIds)
    ? body.targetIds.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean)
    : [];
  if (explicit.length > 0) {
    return { ok: true, targetIds: [...new Set(explicit)] };
  }

  const snap = await collectTopologySnapshot(sessionId, ctx.cdpPort);
  const pages = pageTargetIdsFromTopology(snap.nodes);
  if (mode === "single-ui") {
    if (typeof body.targetId === "string" && body.targetId.trim()) {
      return { ok: true, targetIds: [body.targetId.trim()] };
    }
    if (pages.length === 1) return { ok: true, targetIds: [pages[0]!] };
    return {
      ok: false,
      code: "TARGET_ID_REQUIRED",
      message:
        "targetId required when multiple page targets exist (or pass targetIds / topology has 0 pages)",
    };
  }
  if (pages.length === 0) {
    return {
      ok: false,
      code: "NO_PAGE_TARGETS",
      message: "No page targets in CDP topology; pass targetIds explicitly",
    };
  }
  return { ok: true, targetIds: pages };
}

export async function executeGlobalShortcutControl(
  manager: SessionManager,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; actionId: GlobalShortcutActionId; results: ShortcutTargetResult[]; httpStatus: 200 | 207 }
  | { ok: false; code: string; message: string; httpStatus: number }
> {
  sweepStalePageRecordings(manager);
  const b = body as GlobalShortcutControlBody;

  const actionRaw = typeof b.actionId === "string" ? b.actionId.trim() : "";
  if (!actionRaw || !isClosedActionId(actionRaw)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `actionId must be one of: ${GLOBAL_SHORTCUT_ACTION_IDS.join(", ")}`,
      httpStatus: 400,
    };
  }
  const actionId = actionRaw;

  const ctx = manager.getOpsContext(sessionId);
  if (!ctx) {
    return { ok: false, code: "SESSION_NOT_FOUND", message: "Session not found", httpStatus: 404 };
  }
  if (ctx.state !== "running") {
    return { ok: false, code: "SESSION_NOT_ACTIVE", message: "Session is not running", httpStatus: 503 };
  }
  if (actionId !== "vector-record-toggle" && !ctx.allowScriptExecution) {
    return {
      ok: false,
      code: "SCRIPT_NOT_ALLOWED",
      message: "allowScriptExecution is false for this session",
      httpStatus: 403,
    };
  }

  if (actionId === "vector-record-toggle") {
    const resolved = await resolveShortcutTargets(manager, sessionId, b, "vector-batch");
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.code,
        message: resolved.message,
        httpStatus: resolved.code === "SESSION_NOT_FOUND" ? 404 : 400,
      };
    }
    const injectControls = b.injectPageControls !== false;
    const targetIds = resolved.targetIds;
    const anyRunning = targetIds.some((tid) => isPageRecordingActive(sessionId, tid));
    const results: ShortcutTargetResult[] = [];

    if (!anyRunning && !ctx.allowScriptExecution) {
      return {
        ok: false,
        code: "SCRIPT_NOT_ALLOWED",
        message: "allowScriptExecution is false for this session",
        httpStatus: 403,
      };
    }

    if (anyRunning) {
      for (const targetId of targetIds) {
        if (!isPageRecordingActive(sessionId, targetId)) {
          results.push({ targetId, ok: true, code: "SKIP", message: "not recording" });
          continue;
        }
        const r = await stopPageRecording(manager, sessionId, targetId);
        if ("error" in r) {
          results.push({ targetId, ok: false, code: r.code, message: r.error });
        } else {
          results.push({ targetId, ok: true });
        }
      }
    } else {
      for (const targetId of targetIds) {
        const r = await startPageRecording(manager, sessionId, targetId, {
          injectPageControls: injectControls,
        });
        if ("error" in r) {
          results.push({ targetId, ok: false, code: r.code, message: r.error });
        } else {
          results.push({ targetId, ok: true });
        }
      }
    }

    const allOk = results.every((x) => x.ok);
    const anyFail = results.some((x) => !x.ok);
    return {
      ok: true,
      actionId,
      results,
      httpStatus: allOk ? 200 : anyFail ? 207 : 200,
    };
  }

  /* segment / checkpoint */
  const resolved = await resolveShortcutTargets(manager, sessionId, b, "single-ui");
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      message: resolved.message,
      httpStatus:
        resolved.code === "SESSION_NOT_FOUND"
          ? 404
          : resolved.code === "CDP_NOT_READY"
            ? 503
            : 400,
    };
  }
  const targetId = resolved.targetIds[0]!;
  let ui: ReplayUiCommand | null = null;
  if (actionId === "segment-start") ui = { kind: "segment_start" };
  else if (actionId === "segment-end") ui = { kind: "segment_end" };
  else if (actionId === "checkpoint") ui = { kind: "checkpoint" };

  const result = emitPageRecordingStudioUiMarker(sessionId, targetId, ui!);
  if ("error" in result) {
    const code = result.code;
    const httpStatus = code === "RECORDER_NOT_ACTIVE" ? 409 : code === "RECORDER_NO_UI" ? 503 : 500;
    return { ok: false, code, message: result.error, httpStatus };
  }
  return {
    ok: true,
    actionId,
    results: [{ targetId, ok: true }],
    httpStatus: 200,
  };
}
