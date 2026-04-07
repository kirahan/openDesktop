import { collectTopologySnapshot } from "../topology/fetchTopology.js";
import type { TopologySnapshot } from "../topology/types.js";
import { sampleProcessMetrics } from "../metrics/sampleProcess.js";
import type { SessionManager } from "../session/manager.js";
import type { LogLine } from "../session/types.js";

export interface OodaSnapshot {
  sessionId: string;
  state: string;
  topologySummary: { nodeCount: number; partial: boolean };
  recentErrors: { count: number; last?: string };
  metrics: { cpuPercent?: number; memoryBytes?: number } | null;
  metricsReason?: string;
  suggestedNextSteps: string[];
}

function countRecentErrors(logs: LogLine[]): { count: number; last?: string } {
  const errs = logs.filter((l) => l.level === "error" || l.stream === "stderr");
  const last = errs.length ? errs[errs.length - 1]?.line : undefined;
  return { count: errs.length, last };
}

export async function buildOodaSnapshot(
  manager: SessionManager,
  sessionId: string,
): Promise<
  | { ok: true; snapshot: OodaSnapshot; topology: TopologySnapshot }
  | { ok: false; code: "NOT_FOUND" | "NOT_READY"; message: string }
> {
  const ctx = manager.getOpsContext(sessionId);
  if (!ctx) {
    return { ok: false, code: "NOT_FOUND", message: "Session not found" };
  }
  if (ctx.state !== "running" || !ctx.cdpPort) {
    return { ok: false, code: "NOT_READY", message: "Session not running or CDP unavailable" };
  }

  const topology = await collectTopologySnapshot(sessionId, ctx.cdpPort);
  const metricsResult = await sampleProcessMetrics(ctx.pid);
  const logs = manager.getLogs(sessionId);
  const err = countRecentErrors(logs);

  const snapshot: OodaSnapshot = {
    sessionId,
    state: ctx.state,
    topologySummary: {
      nodeCount: topology.nodes.length,
      partial: topology.partial,
    },
    recentErrors: err,
    metrics: metricsResult.metrics
      ? {
          cpuPercent: metricsResult.metrics.cpuPercent,
          memoryBytes: metricsResult.metrics.memoryBytes,
        }
      : null,
    metricsReason: metricsResult.reason,
    suggestedNextSteps: [],
  };

  return { ok: true, snapshot, topology };
}
