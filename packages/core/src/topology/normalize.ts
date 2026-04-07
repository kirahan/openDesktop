import { createHash } from "node:crypto";
import type { TopologyNode, TopologySnapshot } from "./types.js";
import { TOPOLOGY_SCHEMA_VERSION } from "./types.js";

/** CDP /json/list 单条（子集） */
export interface RawCdpListItem {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
}

export function stableNodeId(sessionId: string, raw: RawCdpListItem): string {
  const key = `${raw.id ?? ""}\0${raw.url ?? ""}\0${raw.type ?? ""}`;
  return createHash("sha256").update(sessionId, "utf8").update(key, "utf8").digest("hex").slice(0, 16);
}

export function normalizeTargets(
  sessionId: string,
  items: unknown[],
  warnings: string[],
): TopologyNode[] {
  const nodes: TopologyNode[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      warnings.push("skip_non_object_entry");
      continue;
    }
    const r = item as RawCdpListItem;
    const targetId = r.id ?? "";
    if (!targetId) {
      warnings.push("missing_target_id");
      continue;
    }
    nodes.push({
      nodeId: stableNodeId(sessionId, r),
      targetId,
      type: r.type ?? "unknown",
      title: r.title ?? "",
      url: r.url ?? "",
    });
  }
  return nodes;
}

export function buildTopologySnapshot(
  sessionId: string,
  items: unknown[],
  fetchWarnings: string[],
): TopologySnapshot {
  const warnings = [...fetchWarnings];
  const nodes = normalizeTargets(sessionId, items, warnings);
  return {
    schemaVersion: TOPOLOGY_SCHEMA_VERSION,
    sessionId,
    partial: warnings.length > 0,
    warnings,
    nodes,
  };
}
