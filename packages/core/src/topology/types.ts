export const TOPOLOGY_SCHEMA_VERSION = 1 as const;

export interface TopologyNode {
  /** 稳定 ID（由 sessionId + target 主键派生） */
  nodeId: string;
  /** CDP 返回的 target id */
  targetId: string;
  type: string;
  title: string;
  url: string;
}

export interface TopologySnapshot {
  schemaVersion: typeof TOPOLOGY_SCHEMA_VERSION;
  sessionId: string;
  partial: boolean;
  warnings: string[];
  nodes: TopologyNode[];
}
