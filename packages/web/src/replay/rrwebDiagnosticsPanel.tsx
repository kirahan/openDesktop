import React, { useMemo } from "react";
import { summarizeRrwebEventsForUi } from "./rrwebEventSummary.js";

type RrwebStreamDiagnosticsProps = {
  events: unknown[];
  /** 当前 SSE 是否在跑 */
  streamRunning: boolean;
};

/**
 * 在 Studio 内展示 rrweb SSE 是否收到数据、事件类型是否合理，便于先排除「未录制」再查 Replayer。
 */
export function RrwebStreamDiagnostics({
  events,
  streamRunning,
}: RrwebStreamDiagnosticsProps): React.ReactElement {
  const s = useMemo(() => summarizeRrwebEventsForUi(events), [events]);

  return (
    <div
      style={{
        fontSize: 11,
        lineHeight: 1.45,
        color: "#334155",
        background: "#f1f5f9",
        borderRadius: 8,
        padding: "8px 10px",
        border: "1px solid #e2e8f0",
        flexShrink: 0,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6, color: "#0f172a" }}>rrweb 数据诊断</div>
      <div style={{ marginBottom: 4 }}>
        SSE 状态：<strong>{streamRunning ? "订阅中" : "未订阅"}</strong>
        ｜已累积事件：<strong>{s.count}</strong> 条
      </div>
      {s.count === 0 ? (
        <div style={{ color: "#64748b" }}>
          若长时间为 0：请确认已点「开始 rrweb 流」、目标会话允许脚本、且注入包已构建；并在<strong>被调试应用窗口</strong>内操作页面。
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 4, color: "#64748b" }}>
            是否含 Meta(4)：<strong>{s.hasMeta ? "是" : "否"}</strong>
            ｜是否含 FullSnapshot(2)：<strong>{s.hasFullSnapshot ? "是" : "否"}</strong>
            <span style={{ marginLeft: 6, fontSize: 10 }}>
              （通常需要 4 与 2 之后 Replayer 才能出画面）
            </span>
          </div>
          <div
            style={{
              marginBottom: 6,
              fontSize: 10,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              wordBreak: "break-word",
              color: "#475569",
            }}
          >
            type 序列（前 48 条）：{s.typeSequenceLabel}
            {s.count > 48 ? " …" : ""}
          </div>
          <div style={{ marginBottom: 8, fontSize: 10, color: "#64748b", lineHeight: 1.45 }}>
            若控制台出现「Not allowed to load local resource: chrome://…」，是浏览器禁止在普通网页里加载扩展内置资源；回放中字体或图片可能缺失，属预期现象。
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>最后一条事件（截断）：</div>
          <pre
            style={{
              margin: 0,
              maxHeight: 120,
              overflow: "auto",
              padding: 8,
              fontSize: 10,
              lineHeight: 1.35,
              background: "#0f172a",
              color: "#e2e8f0",
              borderRadius: 6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          >
            {s.lastEventJsonPreview}
          </pre>
        </>
      )}
    </div>
  );
}
