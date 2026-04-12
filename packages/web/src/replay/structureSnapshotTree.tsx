import React, { useMemo } from "react";

/** 从录制日志行解析出的结构快照（text_digest） */
export type ParsedStructureSnapshot = {
  ts: number;
  text: string;
};

/**
 * 从矢量录制 SSE 推送的逐行 JSON 中抽取 `structure_snapshot` 事件。
 */
export function parseStructureSnapshotsFromReplayLines(lines: string[]): ParsedStructureSnapshot[] {
  const out: ParsedStructureSnapshot[] = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line) as {
        type?: string;
        ts?: unknown;
        text?: unknown;
        format?: string;
        schemaVersion?: unknown;
      };
      if (o.type !== "structure_snapshot" || o.format !== "text_digest") continue;
      if (typeof o.text !== "string") continue;
      const ts = typeof o.ts === "number" ? o.ts : Number(o.ts);
      out.push({ ts: Number.isFinite(ts) ? ts : 0, text: o.text });
    } catch {
      /* 非 JSON 或非录制行 */
    }
  }
  return out;
}

/**
 * 从原始日志中去掉 structure_snapshot 行，避免与树状面板重复展示。
 */
export function filterNonStructureReplayLines(lines: string[]): string[] {
  return lines.filter((line) => {
    try {
      const o = JSON.parse(line) as { type?: string };
      return o.type !== "structure_snapshot";
    } catch {
      return true;
    }
  });
}

function leadingSpaceCount(line: string): number {
  const m = /^(\s*)/.exec(line);
  return m?.[1]?.length ?? 0;
}

/**
 * 将 text_digest 按行展示为缩进「树」：行首空白映射为左侧 padding（innerText 常见无缩进时退化为平铺列表）。
 */
function SnapshotTextAsTree({ text }: { text: string }): React.ReactElement {
  const rows = text.split("\n");
  const baseIndent = rows.reduce((min, line) => {
    if (line.length === 0) return min;
    const n = leadingSpaceCount(line);
    return Math.min(min, n);
  }, Infinity);
  const offset = Number.isFinite(baseIndent) && baseIndent !== Infinity ? baseIndent : 0;

  return (
    <div
      role="tree"
      style={{
        margin: 0,
        padding: "6px 8px",
        fontSize: 10,
        lineHeight: 1.45,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        color: "#cbd5e1",
        maxHeight: "min(200px, 28vh)",
        overflow: "auto",
        background: "#020617",
        borderRadius: 4,
        border: "1px solid #334155",
      }}
    >
      {rows.map((line, idx) => {
        const rel = Math.max(0, leadingSpaceCount(line) - offset);
        const display = line.slice(leadingSpaceCount(line)) || "\u00a0";
        return (
          <div
            key={idx}
            role="treeitem"
            style={{
              paddingLeft: Math.min(rel, 32) * 6,
              borderLeft: rel > 0 ? "1px solid #475569" : undefined,
              marginLeft: rel > 0 ? 4 : 0,
              paddingBottom: 2,
            }}
          >
            <span style={{ color: "#94a3b8", marginRight: 6, userSelect: "none" }}>
              {rel > 0 ? "·" : "•"}
            </span>
            {display}
          </div>
        );
      })}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  borderRadius: 6,
  border: "1px solid #334155",
  background: "#0f172a",
  overflow: "hidden",
};

const summaryStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 600,
  color: "#e2e8f0",
  cursor: "pointer",
  listStyle: "none",
  display: "flex",
  alignItems: "center",
  gap: 8,
};

/**
 * 将原始 JSON 行中的 structure_snapshot 以可折叠块 + 行树形式展示。
 */
export function StructureSnapshotTreePanel({ lines }: { lines: string[] }): React.ReactElement {
  const snapshots = useMemo(() => parseStructureSnapshotsFromReplayLines(lines), [lines]);

  if (snapshots.length === 0) {
    return (
      <div
        style={{
          ...panelStyle,
          padding: "10px 12px",
          fontSize: 11,
          color: "#64748b",
          lineHeight: 1.5,
        }}
      >
        暂无结构快照（<code style={{ fontSize: 10 }}>structure_snapshot</code>
        ）。页面注入后会定时上报 <code style={{ fontSize: 10 }}>text_digest</code>（正文可见文本），请稍候或操作页面后再看。
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>结构快照（text_digest → 行树）</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "min(320px, 40vh)", overflow: "auto" }}>
        {snapshots.map((snap, i) => (
          <details
            key={`${snap.ts}-${i}`}
            open={i === snapshots.length - 1}
            style={panelStyle}
          >
            <summary style={summaryStyle}>
              <span>快照 {i + 1}</span>
              <span style={{ fontWeight: 400, color: "#64748b", fontSize: 10 }}>
                {snap.ts ? new Date(snap.ts).toLocaleString() : "—"}
              </span>
            </summary>
            <div style={{ padding: "0 8px 8px" }}>
              <SnapshotTextAsTree text={snap.text} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
