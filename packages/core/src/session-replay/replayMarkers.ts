/**
 * 会话级录制标记（入点/出点/检查点）载荷校验，供 HTTP 持久化 API 使用。
 *
 * @see openspec/changes/session-replay-multi-target-parallel/design.md D4
 */

export type ReplayMarkerScope = "session" | "target";

export type ValidatedReplayMarker = {
  mergedTs: number;
  scope: ReplayMarkerScope;
  /** `scope === "target"` 时必填 */
  targetId?: string;
  /** 可选：与 ui-marker cmd 对齐的语义标签 */
  kind?: "segment_in" | "segment_out" | "checkpoint";
};

export type ValidateReplayMarkerResult =
  | { ok: true; value: ValidatedReplayMarker }
  | { ok: false; error: string; code: string };

/**
 * 校验 POST body：`mergedTs` 必填；`scope` 为 `target` 时必须含非空 `targetId`。
 */
export function validateReplayMarkerPayload(raw: unknown): ValidateReplayMarkerResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be object", code: "VALIDATION_ERROR" };
  }
  const o = raw as Record<string, unknown>;
  const mergedTs = o.mergedTs;
  if (typeof mergedTs !== "number" || !Number.isFinite(mergedTs)) {
    return { ok: false, error: "mergedTs must be a finite number", code: "VALIDATION_ERROR" };
  }
  const scopeRaw = o.scope;
  if (scopeRaw !== "session" && scopeRaw !== "target") {
    return { ok: false, error: "scope must be session | target", code: "VALIDATION_ERROR" };
  }
  const scope = scopeRaw as ReplayMarkerScope;
  let targetId: string | undefined;
  if (scope === "target") {
    const tid = o.targetId;
    if (typeof tid !== "string" || !tid.trim()) {
      return {
        ok: false,
        error: "targetId required when scope is target",
        code: "VALIDATION_ERROR",
      };
    }
    targetId = tid.trim();
  } else if (o.targetId !== undefined) {
    if (typeof o.targetId === "string" && o.targetId.trim().length > 0) {
      targetId = o.targetId.trim();
    }
  }

  let kind: ValidatedReplayMarker["kind"];
  const k = o.kind;
  if (k === "segment_in" || k === "segment_out" || k === "checkpoint") {
    kind = k;
  } else if (k !== undefined) {
    return { ok: false, error: "kind must be segment_in | segment_out | checkpoint if set", code: "VALIDATION_ERROR" };
  }

  return {
    ok: true,
    value: {
      mergedTs,
      scope,
      ...(targetId !== undefined ? { targetId } : {}),
      ...(kind !== undefined ? { kind } : {}),
    },
  };
}

/** 进程内会话标记队列（首期 MVP；后续可换持久化存储）。 */
const replayMarkersBySession = new Map<string, ValidatedReplayMarker[]>();

export function appendReplaySessionMarker(sessionId: string, marker: ValidatedReplayMarker): void {
  const list = replayMarkersBySession.get(sessionId) ?? [];
  list.push(marker);
  replayMarkersBySession.set(sessionId, list);
}

export function listReplaySessionMarkers(sessionId: string): readonly ValidatedReplayMarker[] {
  return replayMarkersBySession.get(sessionId) ?? [];
}

/** @internal */
export function resetReplayMarkersForTest(): void {
  replayMarkersBySession.clear();
}
