import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NetworkView } from "./network/NetworkView.js";
import { requestCompleteToRow } from "./network/sseToRow.js";
import type { NetworkRequestRow } from "./network/types.js";

type DetailKind = "list-window" | "metrics" | "snapshot";

const OBS_PALETTE = {
  border: "#d8dee8",
  borderActive: "#3b82f6",
  bg: "#ffffff",
  bgHover: "#f8fafc",
  bgActive: "#eff6ff",
  textMuted: "#64748b",
  accentTopo: "#2563eb",
  accentMetrics: "#059669",
  accentSnap: "#7c3aed",
};

type Session = {
  id: string;
  profileId: string;
  state: string;
  createdAt: string;
  cdpPort?: number;
  allowScriptExecution?: boolean;
};

/** 与 `yarn oc app list` / GET /v1/apps 一致 */
type OdApp = {
  id: string;
  name: string;
  executable: string;
  cwd: string;
  env: Record<string, string>;
  args: string[];
  injectElectronDebugPort: boolean;
};

/** GET /v1/profiles，用于选择 `yarn oc session create <profileId>` 等价参数 */
type OdProfile = {
  id: string;
  appId: string;
  name: string;
  env: Record<string, string>;
  extraArgs: string[];
  allowScriptExecution?: boolean;
};

/** GET/POST `/v1/apps/:appId/user-scripts` — 与 Core 持久化结构一致 */
type OdUserScript = {
  id: string;
  appId: string;
  source: string;
  metadata: {
    name: string;
    namespace?: string;
    version?: string;
    description?: string;
    author?: string;
    matches: string[];
    grant: string;
  };
  updatedAt: string;
};

const DEFAULT_USER_SCRIPT = `// ==UserScript==
// @name         新脚本
// @namespace    https://opendesktop.local/
// @version      1.0
// @description  
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

`;

/** `POST …/actions` 中 `network-observe` 成功响应（与 Core JSON 对齐，供 Studio 展示） */
type NetworkObserveUiPayload = {
  schemaVersion?: number;
  windowMs?: number;
  totalRequests?: number;
  completedRequests?: number;
  maxConcurrent?: number;
  slowRequests?: Array<{ method?: string; url?: string; status?: number; durationMs?: number }>;
  truncated?: boolean;
  inflightAtEnd?: number;
  slowThresholdMs?: number;
  stripQuery?: boolean;
};

/** `POST …/actions` 中 `runtime-exception` 成功响应 */
type RuntimeExceptionUiPayload = {
  text?: string;
  textTruncated?: boolean;
  frames?: Array<{
    functionName?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  }>;
  note?: string;
  waitMs?: number;
};

/**
 * 解析 API 基址。未填写时：仅当页面明显与 Core 同源（:8787）才用相对路径 `/v1`；
 * 否则（Vite、Cursor 内置预览、file:// 等）默认直连 `http://127.0.0.1:8787`，避免请求落到非 Core 服务得到 404。
 */
function resolveApiRoot(rawBase: string): string {
  const b = rawBase.trim().replace(/\/$/, "");
  if (b) return b;
  if (typeof window === "undefined") return "";

  const { protocol, hostname, port } = window.location;

  if (protocol === "file:") return "http://127.0.0.1:8787";

  const sameOriginAsCore =
    port === "8787" ||
    (port === "" && (hostname === "127.0.0.1" || hostname === "localhost"));
  if (sameOriginAsCore) return "";

  const isLoopback =
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  if (isLoopback) return "http://127.0.0.1:8787";

  return "";
}

/** Core 文档：Playwright `connectOverCDP` 使用经网关的 HTTP 根，而非裸子进程端口 */
function cdpGatewayHttpUrl(apiRoot: string, sessionId: string): string {
  const b = apiRoot.trim().replace(/\/$/, "");
  const origin = b || (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin}/v1/sessions/${sessionId}/cdp`;
}

/** 经 Core 代理的 CDP `/json/list`（无需 Bearer；与 Playwright 使用同一网关根） */
function cdpJsonListUrl(apiRoot: string, sessionId: string): string {
  return `${cdpGatewayHttpUrl(apiRoot, sessionId)}/json/list`;
}

/**
 * 将 CDP 返回的 `webSocketDebuggerUrl` 转为 Chrome 地址栏可用的 devtools:// 链接（须用户手动粘贴，网页内禁止跳转该协议）。
 */
function webSocketToDevtoolsInspectorUrl(wsUrl: string): string | null {
  try {
    const u = new URL(wsUrl);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return null;
    const wsParam = `${u.host}${u.pathname}${u.search}`;
    return `devtools://devtools/bundled/inspector.html?ws=${encodeURIComponent(wsParam)}`;
  } catch {
    return null;
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function IconListWindow({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3" stroke={color} strokeWidth="1.7" />
      <circle cx="16" cy="8" r="3" stroke={color} strokeWidth="1.7" />
      <circle cx="12" cy="17" r="3" stroke={color} strokeWidth="1.7" />
      <path d="M10 10.5 L11.5 14.5 M14 10.5 L12.5 14.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconMetrics({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5 M8 19v-8 M12 19V9 M16 19v-5 M20 19V7"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSnapshot({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="1.6" />
      <path d="M12 8v4l3 2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 应用行：启动会话 */
function IconSessionStart({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path d="M9 7.5v9l7.5-4.5L9 7.5z" fill={color} />
    </svg>
  );
}

/** 应用行：停止会话 */
function IconSessionStop({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill={color} />
    </svg>
  );
}

function IconSessionBusy({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <g>
        <animateTransform
          attributeName="transform"
          attributeType="XML"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.75s"
          repeatCount="indefinite"
        />
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke={color}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="14 46"
        />
      </g>
    </svg>
  );
}

/** 复制到剪贴板 */
function IconCopy({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 7V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"
        stroke={color}
        strokeWidth="1.65"
        strokeLinecap="round"
      />
      <rect x="5" y="8" width="11" height="11" rx="2" stroke={color} strokeWidth="1.65" />
    </svg>
  );
}

function IconCopied({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 12l3.5 3.5L18 7"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ObservActionCards({
  sessionId,
  loadingKind,
  detailId,
  detailTopo,
  detailMetrics,
  detailSnap,
  onAction,
}: {
  sessionId: string;
  loadingKind: DetailKind | null;
  detailId: string | null;
  detailTopo: string | null;
  detailMetrics: string | null;
  detailSnap: string | null;
  onAction: (id: string, kind: DetailKind) => void;
}) {
  const rows: {
    kind: DetailKind;
    title: string;
    hint: string;
    Icon: React.ComponentType<{ color: string }>;
    accent: string;
  }[] = [
    {
      kind: "list-window",
      title: "窗口列表",
      hint: "调试目标与页面（CDP /json/list）",
      Icon: IconListWindow,
      accent: OBS_PALETTE.accentTopo,
    },
    {
      kind: "metrics",
      title: "进程指标",
      hint: "CPU · 内存",
      Icon: IconMetrics,
      accent: OBS_PALETTE.accentMetrics,
    },
    {
      kind: "snapshot",
      title: "态势快照",
      hint: "OODA · 供 Agent 阅读",
      Icon: IconSnapshot,
      accent: OBS_PALETTE.accentSnap,
    },
  ];

  const isActive = (kind: DetailKind) => {
    if (detailId !== sessionId) return false;
    if (loadingKind === kind) return true;
    if (kind === "list-window" && detailTopo) return true;
    if (kind === "metrics" && detailMetrics) return true;
    if (kind === "snapshot" && detailSnap) return true;
    return false;
  };

  return (
    <div
      role="group"
      aria-label="会话观测"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        maxWidth: 420,
      }}
    >
      {rows.map(({ kind, title, hint, Icon, accent }) => {
        const active = isActive(kind);
        const loading = loadingKind === kind && detailId === sessionId;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onAction(sessionId, kind)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              textAlign: "left",
              minWidth: 118,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${active ? accent : OBS_PALETTE.border}`,
              background: active ? OBS_PALETTE.bgActive : OBS_PALETTE.bg,
              boxShadow: active ? `0 1px 0 0 ${accent}33` : "0 1px 2px rgba(15,23,42,0.06)",
              cursor: "pointer",
              transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = OBS_PALETTE.bgHover;
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = OBS_PALETTE.bg;
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
              <Icon color={accent} />
              <span style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>{title}</span>
              {loading && (
                <span
                  aria-hidden
                  style={{
                    marginLeft: "auto",
                    fontSize: 14,
                    color: accent,
                    fontWeight: 700,
                    animation: "od-pulse 1s ease-in-out infinite",
                  }}
                >
                  ⋯
                </span>
              )}
            </span>
            <span style={{ fontSize: 11, color: OBS_PALETTE.textMuted, marginTop: 6, lineHeight: 1.35 }}>
              {hint}
            </span>
          </button>
        );
      })}
      <style>{`@keyframes od-pulse { 50% { opacity: 0.35; } }`}</style>
    </div>
  );
}

function detailPanelTitle(kind: DetailKind | null): string {
  if (kind === "list-window") return "窗口列表";
  if (kind === "metrics") return "进程指标";
  if (kind === "snapshot") return "态势快照（OODA）";
  return "结果";
}

function detailPanelAccent(kind: DetailKind | null): string {
  if (kind === "list-window") return OBS_PALETTE.accentTopo;
  if (kind === "metrics") return OBS_PALETTE.accentMetrics;
  if (kind === "snapshot") return OBS_PALETTE.accentSnap;
  return "#64748b";
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function RawJsonCollapse({ raw }: { raw: string }) {
  return (
    <details style={{ marginTop: 12 }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: 12,
          color: OBS_PALETTE.textMuted,
          userSelect: "none",
        }}
      >
        原始 JSON
      </summary>
      <pre
        style={{
          marginTop: 8,
          marginBottom: 0,
          fontSize: 11,
          lineHeight: 1.45,
          overflow: "auto",
          maxHeight: 200,
          padding: 10,
          background: "#e2e8f0",
          borderRadius: 8,
          color: "#334155",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        {tryPrettyJson(raw)}
      </pre>
    </details>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "blue" | "amber" | "slate" | "green" | "red" }) {
  const bg =
    tone === "blue"
      ? "#dbeafe"
      : tone === "amber"
        ? "#fef3c7"
        : tone === "green"
          ? "#d1fae5"
          : tone === "red"
            ? "#fee2e2"
            : "#f1f5f9";
  const fg =
    tone === "blue"
      ? "#1e40af"
      : tone === "amber"
        ? "#92400e"
        : tone === "green"
          ? "#065f46"
          : tone === "red"
            ? "#991b1b"
            : "#475569";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        background: bg,
        color: fg,
      }}
    >
      {children}
    </span>
  );
}

/** 会话状态：浅底 + 同色描边圆角标签（与拓扑 Badge 区分，更接近「状态胶囊」） */
function SessionStateTag({ state }: { state: string }) {
  const k = (state || "").toLowerCase();
  let border = "1px solid #3b82f6";
  let background = "#dbeafe";
  let color = "#1e40af";
  if (k === "running") {
    border = "1px solid #22c55e";
    background = "#dcfce7";
    color = "#14532d";
  } else if (k === "starting" || k === "pending") {
    border = "1px solid #f59e0b";
    background = "#fef3c7";
    color = "#92400e";
  } else if (k === "killed" || k === "stopped") {
    border = "1px solid #b91c1c";
    background = "#fee2e2";
    color = "#7f1d1d";
  } else if (k === "failed") {
    border = "1px solid #ef4444";
    background = "#fee2e2";
    color = "#991b1b";
  }
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.25,
        borderRadius: 6,
        border,
        background,
        color,
      }}
    >
      {state}
    </span>
  );
}

/** 拓扑面板内按 target 拉取页面截图（POST /v1/agent/.../actions）所需上下文 */
type TopologySnapshotContext = {
  sessionId: string;
  apiRoot: string;
  token: string;
  /** 子进程远程调试端口；用于 chrome://inspect「配置网络目标」 */
  cdpDirectPort?: number;
};

function pageInspectorBtnStyle(loading: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    borderRadius: 8,
    border: `1px solid ${loading ? OBS_PALETTE.border : OBS_PALETTE.borderActive}`,
    background: loading ? "#f1f5f9" : "#eff6ff",
    color: loading ? OBS_PALETTE.textMuted : "#1d4ed8",
  };
}

/** 右侧抽屉内 SSE 类型：与 Core `GET .../console|network|runtime-exception/stream` 对齐 */
type ObservabilityStreamKind = "console" | "network" | "exception";

function observabilityStreamKindLabel(k: ObservabilityStreamKind): string {
  switch (k) {
    case "console":
      return "日志";
    case "network":
      return "HTTPS";
    case "exception":
      return "异常";
    default:
      return k;
  }
}

function observabilityStartButtonLabel(kind: ObservabilityStreamKind, running: boolean): string {
  if (running) return "订阅中…";
  switch (kind) {
    case "console":
      return "开始实时日志";
    case "network":
      return "开始 HTTPS 流";
    case "exception":
      return "开始异常栈流";
    default:
      return "开始";
  }
}

function observabilityStreamHint(kind: ObservabilityStreamKind): string {
  switch (kind) {
    case "console":
      return "SSE · 仅订阅后的 console · 与短时「控制台」采样不同";
    case "network":
      return "SSE · 每条请求完成事件 · 限流时出现 [warning] · 无 body";
    case "exception":
      return "SSE · uncaught 异常与栈 · 须 Profile allowScriptExecution（否则 HTTP 403）";
    default:
      return "";
  }
}

function buildObservabilitySseUrl(
  apiRoot: string,
  sessionId: string,
  targetId: string,
  kind: ObservabilityStreamKind,
): string {
  const enc = encodeURIComponent(targetId);
  let path: string;
  switch (kind) {
    case "console":
      path = `/v1/sessions/${sessionId}/console/stream?targetId=${enc}`;
      break;
    case "network":
      path = `/v1/sessions/${sessionId}/network/stream?targetId=${enc}`;
      break;
    case "exception":
      path = `/v1/sessions/${sessionId}/runtime-exception/stream?targetId=${enc}`;
      break;
  }
  return apiRoot ? `${apiRoot.replace(/\/$/, "")}${path}` : path;
}

type LiveConsoleTabState = {
  id: string;
  sessionId: string;
  targetId: string;
  /** 与 {@link ObservabilityStreamKind} 一致 */
  streamKind: ObservabilityStreamKind;
  label: string;
  lines: string[];
  /** `streamKind === "network"` 时：SSE `requestComplete` 累积行 */
  networkRows?: NetworkRequestRow[];
  running: boolean;
  err: string | null;
};

type OpenLiveTabParams = {
  sessionId: string;
  targetId: string;
  /** 窗口标题等，用于 tab 展示 */
  label: string;
  /** 默认 `console`（原「实时日志」） */
  streamKind?: ObservabilityStreamKind;
};

const LiveConsoleDockContext = React.createContext<{
  openLiveTab: (p: OpenLiveTabParams) => void;
} | null>(null);

function useLiveConsoleDock(): { openLiveTab: (p: OpenLiveTabParams) => void } | null {
  return useContext(LiveConsoleDockContext);
}

/** 右侧实时观测抽屉：默认收起；多 tab，每 tab 对应 (session, target, 流类型) */
function LiveConsoleDockLayout({
  apiRoot,
  token,
  children,
}: {
  apiRoot: string;
  token: string;
  children: React.ReactNode;
}) {
  const [tabs, setTabs] = useState<LiveConsoleTabState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const abortMap = useRef<Map<string, AbortController>>(new Map());
  const tabsRef = useRef<LiveConsoleTabState[]>([]);
  tabsRef.current = tabs;

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const stopStream = useCallback((tabId: string) => {
    abortMap.current.get(tabId)?.abort();
    abortMap.current.delete(tabId);
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, running: false } : t)));
  }, []);

  const clearTabLines = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? {
              ...t,
              lines: [],
              networkRows: t.streamKind === "network" ? [] : t.networkRows,
            }
          : t,
      ),
    );
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      abortMap.current.get(tabId)?.abort();
      abortMap.current.delete(tabId);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        setActiveId((a) => {
          if (a !== tabId) return a;
          return next[0]?.id ?? null;
        });
        return next;
      });
    },
    [],
  );

  const startStream = useCallback(
    async (
      tabId: string,
      sessionId: string,
      targetId: string,
      streamKind: ObservabilityStreamKind,
    ) => {
      stopStream(tabId);
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, err: null, running: true } : t)));
      const ac = new AbortController();
      abortMap.current.set(tabId, ac);
      const url = buildObservabilitySseUrl(apiRoot, sessionId, targetId, streamKind);
      const MAX_LINES = 500;
      const tokenTrim = token.trim();

      const pushLine = (lineText: string): void => {
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== tabId) return t;
            const next = [...t.lines, lineText];
            return { ...t, lines: next.length > MAX_LINES ? next.slice(-MAX_LINES) : next };
          }),
        );
      };

      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${tokenTrim}` },
          signal: ac.signal,
        });
        if (!res.ok) {
          const t = await res.text();
          let msg = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(t) as { error?: { message?: string } };
            msg = j.error?.message ?? msg;
          } catch {
            msg = t.slice(0, 200);
          }
          throw new Error(msg);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("响应无 body");
        const dec = new TextDecoder();
        let buf = "";
        while (!ac.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          for (;;) {
            const idx = buf.indexOf("\n\n");
            if (idx < 0) break;
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let evName: string | undefined;
            const dataLines: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) evName = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
            }
            const raw = dataLines.join("\n");
            if (!raw) continue;
            if (evName === "ready") continue;
            if (evName === "error") {
              try {
                const e = JSON.parse(raw) as { message?: string };
                setTabs((prev) =>
                  prev.map((t) => (t.id === tabId ? { ...t, err: e.message ?? raw } : t)),
                );
              } catch {
                setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, err: raw } : t)));
              }
              continue;
            }
            if (evName === "warning") {
              try {
                const w = JSON.parse(raw) as { code?: string; droppedEvents?: number };
                pushLine(`[warning] ${w.code ?? "?"} · dropped=${String(w.droppedEvents ?? "?")}`);
              } catch {
                pushLine(`[warning] ${raw.slice(0, 240)}`);
              }
              continue;
            }
            try {
              if (streamKind === "console") {
                const entry = JSON.parse(raw) as { type?: string; argsPreview?: string[] };
                pushLine(`[${entry.type ?? "log"}] ${(entry.argsPreview ?? []).join(" ")}`);
                continue;
              }
              if (streamKind === "network") {
                const o = JSON.parse(raw) as {
                  kind?: string;
                  method?: string;
                  url?: string;
                  durationMs?: number;
                  status?: number;
                  requestId?: string;
                };
                if (o.kind === "requestComplete") {
                  const row = requestCompleteToRow(o);
                  setTabs((prev) =>
                    prev.map((t) => {
                      if (t.id !== tabId) return t;
                      const prevRows = t.networkRows ?? [];
                      const nextRows = [...prevRows, row].slice(-500);
                      return { ...t, networkRows: nextRows };
                    }),
                  );
                } else {
                  pushLine(`[network] ${raw.slice(0, 400)}`);
                }
                continue;
              }
              if (streamKind === "exception") {
                const o = JSON.parse(raw) as {
                  text?: string;
                  textTruncated?: boolean;
                  frames?: Array<{
                    functionName?: string;
                    url?: string;
                    lineNumber?: number;
                    columnNumber?: number;
                  }>;
                };
                const head = `[exception] ${o.text ?? ""}${o.textTruncated ? " …(截断)" : ""}`;
                const fr = Array.isArray(o.frames) ? o.frames : [];
                const rest = fr
                  .map(
                    (f, i) =>
                      `  #${i} ${f.functionName ?? "(anonymous)"} ${f.url ?? ""}:${f.lineNumber ?? "?"}`,
                  )
                  .join("\n");
                pushLine(rest ? `${head}\n${rest}` : head);
                continue;
              }
            } catch {
              /* ignore malformed chunk */
            }
          }
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, err: e instanceof Error ? e.message : String(e) } : t,
            ),
          );
        }
      } finally {
        abortMap.current.delete(tabId);
        setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, running: false } : t)));
      }
    },
    [apiRoot, token, stopStream],
  );

  const openLiveTab = useCallback(
    (p: OpenLiveTabParams) => {
      const streamKind = p.streamKind ?? "console";
      const id = `${p.sessionId}::${p.targetId}::${streamKind}`;
      const title = (p.label.slice(0, 28) || p.targetId.slice(0, 10)).trim();
      const tabLabel = `${title} · ${observabilityStreamKindLabel(streamKind)}`;
      const existed = tabsRef.current.some((t) => t.id === id);
      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [
          ...prev,
          {
            id,
            sessionId: p.sessionId,
            targetId: p.targetId,
            streamKind,
            label: tabLabel,
            lines: [],
            networkRows: streamKind === "network" ? [] : undefined,
            running: false,
            err: null,
          },
        ];
      });
      setActiveId(id);
      setDrawerOpen(true);
      if (!existed && streamKind === "network") {
        window.setTimeout(() => void startStream(id, p.sessionId, p.targetId, "network"), 0);
      }
    },
    [startStream],
  );

  const ctxValue = useMemo(() => ({ openLiveTab }), [openLiveTab]);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const tokenOk = token.trim().length > 0;
  const drawerWide = active?.streamKind === "network";

  return (
    <LiveConsoleDockContext.Provider value={ctxValue}>
      <div style={{ width: "100%" }}>{children}</div>
      {!drawerOpen && (
        <button
          type="button"
          aria-label={tabs.length > 0 ? `打开实时观测，已打开 ${tabs.length} 个标签` : "打开实时观测"}
          onClick={() => setDrawerOpen(true)}
          title={tabs.length > 0 ? `已打开 ${tabs.length} 个标签` : "日志 / HTTPS / 异常栈 SSE"}
          style={{
            position: "fixed",
            right: 16,
            bottom: 24,
            zIndex: 1060,
            padding: "10px 14px",
            borderRadius: 10,
            border: "none",
            background: "#2563eb",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(37, 99, 235, 0.35)",
          }}
        >
          实时观测{tabs.length > 0 ? ` · ${tabs.length}` : ""}
        </button>
      )}
      {drawerOpen && (
        <div
          role="presentation"
          aria-hidden
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1040,
            background: "rgba(15, 23, 42, 0.38)",
          }}
        />
      )}
      <aside
        role="dialog"
        aria-modal="true"
        aria-hidden={!drawerOpen}
        aria-label="实时观测"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          bottom: 0,
          width: drawerWide ? "min(960px, 96vw)" : "min(340px, 100vw)",
          zIndex: 1050,
          display: "flex",
          flexDirection: "column",
          maxHeight: "100vh",
          borderRadius: "12px 0 0 12px",
          border: `1px solid ${OBS_PALETTE.border}`,
          borderRight: "none",
          background: "#fff",
          boxShadow: "-4px 0 24px rgba(15,23,42,0.12)",
          overflow: "hidden",
          transform: drawerOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s ease-out, width 0.2s ease-out",
          pointerEvents: drawerOpen ? "auto" : "none",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            borderBottom: `1px solid ${OBS_PALETTE.border}`,
            background: "#f8fafc",
            fontSize: 13,
            fontWeight: 600,
            color: "#0f172a",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span>实时观测</span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: `1px solid ${OBS_PALETTE.border}`,
              background: "#fff",
              color: "#475569",
              cursor: "pointer",
            }}
          >
            收起
          </button>
        </div>
          {!tokenOk ? (
            <div style={{ padding: 12, fontSize: 12, color: OBS_PALETTE.textMuted }}>填写 Bearer 后可用</div>
          ) : tabs.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: OBS_PALETTE.textMuted, lineHeight: 1.5 }}>
              在「窗口 / 调试目标」卡片中打开「实时日志 / HTTPS / 异常栈」，或点右下角「实时观测」，可为此 target 新开标签；同一窗口可开多种流（多 tab）。
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                  padding: "8px 8px 0",
                  borderBottom: `1px solid ${OBS_PALETTE.border}`,
                  background: "#fff",
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              >
                {tabs.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      maxWidth: "100%",
                    }}
                  >
                    <button
                      type="button"
                      title={t.label}
                      onClick={() => setActiveId(t.id)}
                      style={{
                        padding: "4px 8px",
                        fontSize: 11,
                        borderRadius: 6,
                        border: `1px solid ${activeId === t.id ? OBS_PALETTE.borderActive : OBS_PALETTE.border}`,
                        background: activeId === t.id ? "#eff6ff" : "#f8fafc",
                        color: "#0f172a",
                        cursor: "pointer",
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.label}
                    </button>
                    <button
                      type="button"
                      aria-label="关闭标签"
                      onClick={() => closeTab(t.id)}
                      style={{
                        padding: "2px 6px",
                        fontSize: 12,
                        lineHeight: 1,
                        border: "none",
                        background: "transparent",
                        color: "#94a3b8",
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {active && (
                <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 200 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <button
                      type="button"
                      disabled={!tokenOk || active.running}
                      onClick={() =>
                        void startStream(active.id, active.sessionId, active.targetId, active.streamKind)
                      }
                      style={pageInspectorBtnStyle(!tokenOk || active.running)}
                    >
                      {observabilityStartButtonLabel(active.streamKind, active.running)}
                    </button>
                    <button
                      type="button"
                      disabled={!active.running}
                      onClick={() => stopStream(active.id)}
                      style={pageInspectorBtnStyle(!active.running)}
                    >
                      停止
                    </button>
                    <button type="button" onClick={() => clearTabLines(active.id)} style={pageInspectorBtnStyle(false)}>
                      清屏
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: 10, color: OBS_PALETTE.textMuted, lineHeight: 1.45 }}>
                    {observabilityStreamHint(active.streamKind)}
                  </p>
                  {active.err && (
                    <div style={{ fontSize: 11, color: "#991b1b", lineHeight: 1.4 }}>{active.err}</div>
                  )}
                  {active.streamKind === "network" ? (
                    <>
                      <NetworkView rows={active.networkRows ?? []} />
                      {active.lines.length > 0 && (
                        <pre
                          style={{
                            margin: 0,
                            flexShrink: 0,
                            maxHeight: 120,
                            overflow: "auto",
                            padding: 8,
                            fontSize: 10,
                            lineHeight: 1.4,
                            background: "#1e293b",
                            color: "#fde68a",
                            borderRadius: 6,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                          }}
                        >
                          {active.lines.join("\n")}
                        </pre>
                      )}
                    </>
                  ) : (
                    active.lines.length > 0 && (
                      <pre
                        style={{
                          margin: 0,
                          flex: 1,
                          minHeight: 160,
                          maxHeight: "min(420px, 55vh)",
                          overflow: "auto",
                          padding: 8,
                          fontSize: 10,
                          lineHeight: 1.4,
                          background: "#0f172a",
                          color: "#e2e8f0",
                          borderRadius: 6,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        }}
                      >
                        {active.lines.join("\n")}
                      </pre>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </aside>
    </LiveConsoleDockContext.Provider>
  );
}

/** page 卡片：截图 / DOM / 控制台（均走 Agent actions） */
function PageTargetScreenshot({
  ctx,
  targetId,
  enabled,
  windowTitle,
}: {
  ctx: TopologySnapshotContext;
  targetId: string;
  enabled: boolean;
  /** 用于实时观测抽屉内标签标题 */
  windowTitle: string;
}) {
  const [shotLoading, setShotLoading] = useState(false);
  const [shotSrc, setShotSrc] = useState<string | null>(null);
  const [shotErr, setShotErr] = useState<string | null>(null);

  const [domLoading, setDomLoading] = useState(false);
  const [domHtml, setDomHtml] = useState<string | null>(null);
  const [domTrunc, setDomTrunc] = useState(false);
  const [domErr, setDomErr] = useState<string | null>(null);

  const [conLoading, setConLoading] = useState(false);
  const [conEntries, setConEntries] = useState<
    Array<{ type: string; argsPreview: string[]; timestamp?: number }> | null
  >(null);
  const [conNote, setConNote] = useState<string | null>(null);
  const [conErr, setConErr] = useState<string | null>(null);

  const [devLoading, setDevLoading] = useState(false);
  const [devErr, setDevErr] = useState<string | null>(null);
  const [devToolsUrlCopied, setDevToolsUrlCopied] = useState(false);

  const [globalsLoading, setGlobalsLoading] = useState(false);
  const [globalsErr, setGlobalsErr] = useState<string | null>(null);
  const [globalsText, setGlobalsText] = useState<string | null>(null);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreErr, setExploreErr] = useState<string | null>(null);
  const [exploreText, setExploreText] = useState<string | null>(null);
  const [interestPattern, setInterestPattern] = useState("");

  const [netLoading, setNetLoading] = useState(false);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [netResult, setNetResult] = useState<NetworkObserveUiPayload | null>(null);
  const [netWindowMsStr, setNetWindowMsStr] = useState("3000");
  const [netSlowMsStr, setNetSlowMsStr] = useState("1000");
  const [netStripQuery, setNetStripQuery] = useState(true);

  const [stackLoading, setStackLoading] = useState(false);
  const [stackErr, setStackErr] = useState<string | null>(null);
  const [stackResult, setStackResult] = useState<RuntimeExceptionUiPayload | null>(null);
  const [stackWaitMsStr, setStackWaitMsStr] = useState("2000");

  const tokenOk = ctx.token.trim().length > 0;
  const liveDock = useLiveConsoleDock();

  const gatewayRoot = cdpGatewayHttpUrl(ctx.apiRoot, ctx.sessionId);
  const jsonListUrl = `${gatewayRoot}/json/list`;
  const directInspectAddr =
    typeof ctx.cdpDirectPort === "number" ? `127.0.0.1:${ctx.cdpDirectPort}` : null;

  const postAgent = useCallback(
    async (payload: Record<string, unknown>) => {
      const path = `/v1/agent/sessions/${ctx.sessionId}/actions`;
      const url = ctx.apiRoot ? `${ctx.apiRoot}${path}` : path;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.token.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...payload, targetId }),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text) as { error?: { message?: string; code?: string } };
          msg = j.error?.message ?? j.error?.code ?? msg;
        } catch {
          msg = text.slice(0, 160);
        }
        throw new Error(msg);
      }
      return JSON.parse(text) as Record<string, unknown>;
    },
    [ctx.sessionId, ctx.apiRoot, ctx.token, targetId],
  );

  const runCapture = useCallback(async () => {
    if (!tokenOk) return;
    setShotLoading(true);
    setShotErr(null);
    try {
      const j = await postAgent({ action: "screenshot" });
      const data = j.data as string | undefined;
      const mime = (j.mime as string) || "image/png";
      if (!data) throw new Error("响应中无截图数据");
      setShotSrc(`data:${mime};base64,${data}`);
    } catch (e) {
      setShotErr(e instanceof Error ? e.message : String(e));
    } finally {
      setShotLoading(false);
    }
  }, [postAgent, tokenOk]);

  const runDom = useCallback(async () => {
    if (!tokenOk) return;
    setDomLoading(true);
    setDomErr(null);
    try {
      const j = await postAgent({ action: "dom" });
      const html = j.html as string | undefined;
      if (html === undefined) throw new Error("响应中无 HTML");
      setDomHtml(html);
      setDomTrunc(!!j.truncated);
    } catch (e) {
      setDomErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDomLoading(false);
    }
  }, [postAgent, tokenOk]);

  const runConsole = useCallback(async () => {
    if (!tokenOk) return;
    setConLoading(true);
    setConErr(null);
    try {
      const j = await postAgent({ action: "console-messages", waitMs: 2000 });
      const entries = j.entries as Array<{ type: string; argsPreview: string[]; timestamp?: number }> | undefined;
      setConEntries(Array.isArray(entries) ? entries : []);
      setConNote(typeof j.note === "string" ? j.note : null);
    } catch (e) {
      setConErr(e instanceof Error ? e.message : String(e));
    } finally {
      setConLoading(false);
    }
  }, [postAgent, tokenOk]);

  const copyDevToolsFromJsonList = useCallback(async () => {
    setDevLoading(true);
    setDevErr(null);
    try {
      const r = await fetch(jsonListUrl);
      if (!r.ok) throw new Error(`拉取 json/list 失败 HTTP ${r.status}`);
      const arr = (await r.json()) as Array<{ id?: string; webSocketDebuggerUrl?: string }>;
      if (!Array.isArray(arr)) throw new Error("json/list 响应不是数组");
      const row = arr.find((x) => x.id === targetId);
      const ws = row?.webSocketDebuggerUrl;
      if (!ws) throw new Error("未找到该 target 的 WebSocket URL");
      const devUrl = webSocketToDevtoolsInspectorUrl(ws);
      if (!devUrl) throw new Error("无法生成 devtools:// 链接");
      await copyToClipboard(devUrl);
      setDevToolsUrlCopied(true);
      window.setTimeout(() => setDevToolsUrlCopied(false), 2500);
    } catch (e) {
      setDevErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDevLoading(false);
    }
  }, [jsonListUrl, targetId]);

  const runRendererGlobals = useCallback(async () => {
    if (!tokenOk) return;
    setGlobalsLoading(true);
    setGlobalsErr(null);
    try {
      const payload: Record<string, unknown> = { action: "renderer-globals" };
      const t = interestPattern.trim();
      if (t.length > 0) payload.interestPattern = t;
      const j = await postAgent(payload);
      setGlobalsText(JSON.stringify(j, null, 2));
    } catch (e) {
      setGlobalsErr(e instanceof Error ? e.message : String(e));
      setGlobalsText(null);
    } finally {
      setGlobalsLoading(false);
    }
  }, [postAgent, tokenOk, interestPattern]);

  const runExplore = useCallback(async () => {
    if (!tokenOk) return;
    setExploreLoading(true);
    setExploreErr(null);
    try {
      const j = await postAgent({ action: "explore" });
      setExploreText(JSON.stringify(j, null, 2));
    } catch (e) {
      setExploreErr(e instanceof Error ? e.message : String(e));
      setExploreText(null);
    } finally {
      setExploreLoading(false);
    }
  }, [postAgent, tokenOk]);

  const runNetworkObserve = useCallback(async () => {
    if (!tokenOk) return;
    setNetLoading(true);
    setNetErr(null);
    try {
      const w = parseInt(netWindowMsStr, 10);
      const windowMs = Math.min(30000, Math.max(100, Number.isFinite(w) ? w : 3000));
      const s = parseInt(netSlowMsStr, 10);
      const slowThresholdMs = Math.max(0, Number.isFinite(s) ? s : 1000);
      const j = (await postAgent({
        action: "network-observe",
        windowMs,
        slowThresholdMs,
        stripQuery: netStripQuery,
      })) as NetworkObserveUiPayload;
      setNetResult(j);
    } catch (e) {
      setNetErr(e instanceof Error ? e.message : String(e));
      setNetResult(null);
    } finally {
      setNetLoading(false);
    }
  }, [postAgent, tokenOk, netWindowMsStr, netSlowMsStr, netStripQuery]);

  const runRuntimeException = useCallback(async () => {
    if (!tokenOk) return;
    setStackLoading(true);
    setStackErr(null);
    try {
      const w = parseInt(stackWaitMsStr, 10);
      const waitMs = Math.min(30_000, Math.max(100, Number.isFinite(w) ? w : 2000));
      const j = (await postAgent({
        action: "runtime-exception",
        waitMs,
      })) as RuntimeExceptionUiPayload;
      setStackResult(j);
    } catch (e) {
      setStackErr(e instanceof Error ? e.message : String(e));
      setStackResult(null);
    } finally {
      setStackLoading(false);
    }
  }, [postAgent, tokenOk, stackWaitMsStr]);

  if (!enabled) return null;

  if (!tokenOk) {
    return (
      <div
        style={{
          marginBottom: 10,
          padding: 10,
          borderRadius: 8,
          background: "#f8fafc",
          fontSize: 11,
          color: OBS_PALETTE.textMuted,
        }}
      >
        填写 Bearer token 后可使用截图、DOM、控制台采样、HTTPS 观测（network-observe）、异常栈（runtime-exception）、全局快照（renderer-globals）与探索（explore）。
      </div>
    );
  }

  const shotLabel = shotLoading ? "截取中…" : shotSrc ? "刷新截图" : "截取页面";
  const domLabel = domLoading ? "读取中…" : domHtml ? "刷新 DOM" : "DOM 结构";
  const conLabel = conLoading ? "监听中…" : conEntries !== null ? "刷新控制台" : "控制台";
  const netLabel = netLoading ? "观测中…" : netResult ? "刷新 HTTPS" : "HTTPS 观测";
  const stackLabel = stackLoading ? "监听中…" : stackResult ? "刷新异常栈" : "异常栈";

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          disabled={shotLoading}
          onClick={() => void runCapture()}
          style={pageInspectorBtnStyle(shotLoading)}
        >
          {shotLabel}
        </button>
        <button
          type="button"
          disabled={domLoading}
          onClick={() => void runDom()}
          style={pageInspectorBtnStyle(domLoading)}
        >
          {domLabel}
        </button>
        <button
          type="button"
          disabled={conLoading}
          onClick={() => void runConsole()}
          style={pageInspectorBtnStyle(conLoading)}
        >
          {conLabel}
        </button>
        <button
          type="button"
          disabled={exploreLoading}
          onClick={() => void runExplore()}
          style={pageInspectorBtnStyle(exploreLoading)}
          title="Agent explore：解析当前页 DOM，返回按钮类候选（selector 可配合点击）"
        >
          {exploreLoading ? "探索中…" : exploreText ? "刷新探索" : "探索"}
        </button>
        <button
          type="button"
          disabled={netLoading}
          onClick={() => void runNetworkObserve()}
          style={pageInspectorBtnStyle(netLoading)}
          title="Agent network-observe：短时窗口内聚合该 target 的 HTTP(S) 请求（约阻塞「观测窗口」毫秒；不含 body）"
        >
          {netLabel}
        </button>
        <button
          type="button"
          disabled={stackLoading}
          onClick={() => void runRuntimeException()}
          style={pageInspectorBtnStyle(stackLoading)}
          title="Agent runtime-exception：在监听窗口内捕获未捕获异常与调用栈（须 allowScriptExecution；约阻塞「监听」毫秒）"
        >
          {stackLabel}
        </button>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <label style={{ fontSize: 11, color: OBS_PALETTE.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
          窗口 ms
          <input
            type="number"
            min={100}
            max={30000}
            value={netWindowMsStr}
            onChange={(e) => setNetWindowMsStr(e.target.value)}
            style={{
              width: 72,
              padding: "4px 8px",
              fontSize: 11,
              borderRadius: 6,
              border: `1px solid ${OBS_PALETTE.border}`,
            }}
          />
        </label>
        <label style={{ fontSize: 11, color: OBS_PALETTE.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
          慢请求 ≥
          <input
            type="number"
            min={0}
            value={netSlowMsStr}
            onChange={(e) => setNetSlowMsStr(e.target.value)}
            style={{
              width: 72,
              padding: "4px 8px",
              fontSize: 11,
              borderRadius: 6,
              border: `1px solid ${OBS_PALETTE.border}`,
            }}
          />
          ms
        </label>
        <label style={{ fontSize: 11, color: OBS_PALETTE.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={netStripQuery}
            onChange={(e) => setNetStripQuery(e.target.checked)}
          />
          去掉 query/hash
        </label>
        <label style={{ fontSize: 11, color: OBS_PALETTE.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
          异常栈监听 ms
          <input
            type="number"
            min={100}
            max={30000}
            value={stackWaitMsStr}
            onChange={(e) => setStackWaitMsStr(e.target.value)}
            style={{
              width: 72,
              padding: "4px 8px",
              fontSize: 11,
              borderRadius: 6,
              border: `1px solid ${OBS_PALETTE.border}`,
            }}
          />
        </label>
        <span style={{ fontSize: 10, color: OBS_PALETTE.textMuted }}>须会话 allowScriptExecution</span>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <input
          type="text"
          value={interestPattern}
          onChange={(e) => setInterestPattern(e.target.value)}
          placeholder="可选：interest 正则（如 ^acquire|shell）"
          aria-label="renderer-globals interest 正则"
          style={{
            minWidth: 200,
            flex: "1 1 200px",
            maxWidth: 440,
            padding: "6px 10px",
            fontSize: 11,
            borderRadius: 8,
            border: `1px solid ${OBS_PALETTE.border}`,
            background: "#fff",
            color: "#0f172a",
          }}
        />
        <button
          type="button"
          disabled={globalsLoading}
          onClick={() => void runRendererGlobals()}
          style={pageInspectorBtnStyle(globalsLoading)}
        >
          {globalsLoading ? "枚举中…" : globalsText ? "刷新全局快照" : "全局快照"}
        </button>
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 10, color: OBS_PALETTE.textMuted, lineHeight: 1.45 }}>
        通过 CDP 反射枚举当前 page 的 <code style={{ fontSize: 10 }}>globalThis</code> 属性（需 Profile
        允许脚本执行）。结果较大时仅作探测用途。
      </p>
      <div
        style={{
          marginBottom: 10,
          padding: 10,
          borderRadius: 8,
          background: "#f8fafc",
          border: `1px dashed ${OBS_PALETTE.border}`,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: "#334155", marginBottom: 6 }}>DevTools 附加</div>
        {liveDock && tokenOk && (
          <div
            style={{
              marginBottom: 10,
              paddingBottom: 10,
              borderBottom: `1px solid ${OBS_PALETTE.border}`,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6 }}>实时观测（右侧抽屉）</div>
            <p style={{ margin: "0 0 8px", fontSize: 10, color: OBS_PALETTE.textMuted, lineHeight: 1.45 }}>
              与下方「HTTPS 观测」「异常栈」短时采样互补：此处为 <strong>SSE 长连接</strong>（仅连接后的新事件）。可分别打开
              <strong> 控制台 / HTTPS / 异常栈 </strong>
              三种标签；限流时会出现 <code style={{ fontSize: 10 }}>[warning]</code>。
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                onClick={() =>
                  liveDock.openLiveTab({
                    sessionId: ctx.sessionId,
                    targetId,
                    label: windowTitle,
                    streamKind: "console",
                  })
                }
                style={pageInspectorBtnStyle(false)}
              >
                打开实时日志
              </button>
              <button
                type="button"
                onClick={() =>
                  liveDock.openLiveTab({
                    sessionId: ctx.sessionId,
                    targetId,
                    label: windowTitle,
                    streamKind: "network",
                  })
                }
                style={pageInspectorBtnStyle(false)}
                title="SSE：/v1/sessions/.../network/stream"
              >
                打开 HTTPS 流
              </button>
              <button
                type="button"
                onClick={() =>
                  liveDock.openLiveTab({
                    sessionId: ctx.sessionId,
                    targetId,
                    label: windowTitle,
                    streamKind: "exception",
                  })
                }
                style={pageInspectorBtnStyle(false)}
                title="须 allowScriptExecution；SSE：.../runtime-exception/stream"
              >
                打开异常栈流
              </button>
            </div>
          </div>
        )}
        <p style={{ margin: "0 0 8px", fontSize: 11, color: OBS_PALETTE.textMuted, lineHeight: 1.45 }}>
          路线 A：在本机 Chrome 打开{" "}
          <code style={{ fontSize: 10 }}>chrome://inspect/#devices</code> →「发现网络目标」→「配置」→ 填入下述{" "}
          <strong>直连 host:port</strong>（与 CDP 网关不同：inspect 要连子进程调试端口）。在列表中选中与当前
          URL/title 一致的 page。路线 B：用 <code style={{ fontSize: 10 }}>json/list</code> 取{" "}
          <code style={{ fontSize: 10 }}>webSocketDebuggerUrl</code> 生成 <code style={{ fontSize: 10 }}>devtools://</code>
          。浏览器<strong>不允许</strong>从普通网页用脚本打开该协议（会报 Not allowed to load local resource）；请点下方按钮复制后，到
          本机 <strong>Chrome 地址栏手动粘贴并回车</strong>。
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {directInspectAddr && (
            <button
              type="button"
              onClick={() => void copyToClipboard(directInspectAddr)}
              style={pageInspectorBtnStyle(false)}
            >
              复制 inspect 用 host:port
            </button>
          )}
          <button
            type="button"
            onClick={() => void copyToClipboard(gatewayRoot)}
            style={pageInspectorBtnStyle(false)}
          >
            复制 CDP 网关根
          </button>
          <button
            type="button"
            onClick={() => void copyToClipboard(jsonListUrl)}
            style={pageInspectorBtnStyle(false)}
          >
            复制 json/list URL
          </button>
          <button
            type="button"
            disabled={devLoading}
            onClick={() => void copyDevToolsFromJsonList()}
            style={pageInspectorBtnStyle(devLoading)}
          >
            {devLoading
              ? "拉取 json/list…"
              : devToolsUrlCopied
                ? "已复制 — 请粘贴到 Chrome 地址栏"
                : "复制 devtools:// 链接"}
          </button>
        </div>
        {devErr && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#991b1b", lineHeight: 1.4 }}>DevTools：{devErr}</div>
        )}
      </div>
      {shotSrc && (
        <div
          style={{
            marginBottom: 10,
            borderRadius: 8,
            overflow: "hidden",
            border: `1px solid ${OBS_PALETTE.border}`,
            background: "#0f172a",
          }}
        >
          <img src={shotSrc} alt="" style={{ width: "100%", height: "auto", display: "block" }} />
        </div>
      )}
      {shotErr && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 8,
            background: "#fef2f2",
            fontSize: 11,
            color: "#991b1b",
            lineHeight: 1.45,
          }}
        >
          截图：{shotErr}
        </div>
      )}
      {domHtml !== null && (
        <div style={{ marginBottom: 10 }}>
          {domTrunc && (
            <div style={{ fontSize: 11, color: "#b45309", marginBottom: 6 }}>内容已截断（体积上限保护）</div>
          )}
          <pre
            style={{
              margin: 0,
              maxHeight: 280,
              overflow: "auto",
              padding: 12,
              borderRadius: 8,
              fontSize: 11,
              lineHeight: 1.45,
              background: "#f8fafc",
              border: `1px solid ${OBS_PALETTE.border}`,
              color: "#0f172a",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          >
            {domHtml}
          </pre>
        </div>
      )}
      {domErr && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 8,
            background: "#fef2f2",
            fontSize: 11,
            color: "#991b1b",
            lineHeight: 1.45,
          }}
        >
          DOM：{domErr}
        </div>
      )}
      {conEntries !== null && (
        <div style={{ marginBottom: 10 }}>
          {conNote && (
            <p style={{ margin: "0 0 8px", fontSize: 11, color: OBS_PALETTE.textMuted, lineHeight: 1.45 }}>
              {conNote}
            </p>
          )}
          {conEntries.length === 0 ? (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                color: OBS_PALETTE.textMuted,
                background: "#f8fafc",
                border: `1px dashed ${OBS_PALETTE.border}`,
              }}
            >
              等待窗口内未捕获到新的 console 输出（可在目标页触发 log 后重试）。
            </div>
          ) : (
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                maxHeight: 240,
                overflow: "auto",
                fontSize: 12,
                color: "#334155",
                lineHeight: 1.5,
              }}
            >
              {conEntries.map((e, idx) => (
                <li key={idx} style={{ marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, color: "#0f172a" }}>[{e.type}]</span>{" "}
                  {e.argsPreview.join(" ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {conErr && (
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            background: "#fef2f2",
            fontSize: 11,
            color: "#991b1b",
            lineHeight: 1.45,
          }}
        >
          控制台：{conErr}
        </div>
      )}
      {exploreText !== null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: OBS_PALETTE.textMuted, marginBottom: 6 }}>
            explore 响应（候选按钮 JSON，与 get 同源 HTML）
          </div>
          <pre
            style={{
              margin: 0,
              maxHeight: 280,
              overflow: "auto",
              padding: 12,
              borderRadius: 8,
              fontSize: 10,
              lineHeight: 1.45,
              background: "#f0fdf4",
              border: `1px solid ${OBS_PALETTE.border}`,
              color: "#0f172a",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          >
            {exploreText}
          </pre>
        </div>
      )}
      {exploreErr && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 8,
            background: "#fef2f2",
            fontSize: 11,
            color: "#991b1b",
            lineHeight: 1.45,
          }}
        >
          探索：{exploreErr}
        </div>
      )}
      {netResult !== null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: OBS_PALETTE.textMuted, marginBottom: 8 }}>
            HTTPS 观测（<code style={{ fontSize: 10 }}>network-observe</code>，CDP Network，不含 body）
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                minWidth: 100,
                padding: "10px 12px",
                borderRadius: 10,
                background: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
                border: "1px solid #c7d2fe",
              }}
            >
              <div style={{ fontSize: 10, color: "#4338ca", fontWeight: 600 }}>发起数</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#312e81" }}>
                {typeof netResult.totalRequests === "number" ? netResult.totalRequests : "—"}
              </div>
            </div>
            <div
              style={{
                minWidth: 100,
                padding: "10px 12px",
                borderRadius: 10,
                background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
                border: "1px solid #a7f3d0",
              }}
            >
              <div style={{ fontSize: 10, color: "#047857", fontWeight: 600 }}>已完成</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#065f46" }}>
                {typeof netResult.completedRequests === "number" ? netResult.completedRequests : "—"}
              </div>
            </div>
            <div
              style={{
                minWidth: 100,
                padding: "10px 12px",
                borderRadius: 10,
                background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
                border: "1px solid #fdba74",
              }}
            >
              <div style={{ fontSize: 10, color: "#c2410c", fontWeight: 600 }}>并发峰值</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#9a3412" }}>
                {typeof netResult.maxConcurrent === "number" ? netResult.maxConcurrent : "—"}
              </div>
            </div>
            <div
              style={{
                minWidth: 100,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#f8fafc",
                border: `1px solid ${OBS_PALETTE.border}`,
              }}
            >
              <div style={{ fontSize: 10, color: OBS_PALETTE.textMuted, fontWeight: 600 }}>窗口末在途</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
                {typeof netResult.inflightAtEnd === "number" ? netResult.inflightAtEnd : "—"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
            {typeof netResult.windowMs === "number" && (
              <Badge tone="slate">窗口 {netResult.windowMs} ms</Badge>
            )}
            {typeof netResult.slowThresholdMs === "number" && (
              <Badge tone="slate">慢阈值 {netResult.slowThresholdMs} ms</Badge>
            )}
            {netResult.truncated && <Badge tone="amber">跟踪已截断</Badge>}
            {netResult.stripQuery === false && <Badge tone="slate">保留 query</Badge>}
          </div>
          {Array.isArray(netResult.slowRequests) && netResult.slowRequests.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 11,
                  background: "#fff",
                  border: `1px solid ${OBS_PALETTE.border}`,
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <thead>
                  <tr style={{ background: "#f1f5f9", color: "#475569", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px", fontWeight: 600 }}>方法</th>
                    <th style={{ padding: "8px 10px", fontWeight: 600 }}>耗时 (ms)</th>
                    <th style={{ padding: "8px 10px", fontWeight: 600 }}>状态</th>
                    <th style={{ padding: "8px 10px", fontWeight: 600 }}>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {netResult.slowRequests.map((row, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${OBS_PALETTE.border}` }}>
                      <td style={{ padding: "8px 10px", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>
                        {row.method ?? "—"}
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {typeof row.durationMs === "number" ? Math.round(row.durationMs) : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {row.status !== undefined ? String(row.status) : "—"}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          wordBreak: "break-all",
                          color: "#334155",
                          lineHeight: 1.4,
                        }}
                      >
                        {row.url ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                color: OBS_PALETTE.textMuted,
                background: "#f8fafc",
                border: `1px dashed ${OBS_PALETTE.border}`,
              }}
            >
              本窗口内无达到慢阈值的已完成请求（可缩短窗口或调低慢请求阈值后重试）。
            </div>
          )}
        </div>
      )}
      {netErr && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 8,
            background: "#fef2f2",
            fontSize: 11,
            color: "#991b1b",
            lineHeight: 1.45,
          }}
        >
          HTTPS 观测：{netErr}
        </div>
      )}
      {stackResult !== null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: OBS_PALETTE.textMuted, marginBottom: 8 }}>
            异常与调用栈（<code style={{ fontSize: 10 }}>runtime-exception</code>）
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
            {typeof stackResult.waitMs === "number" && <Badge tone="slate">监听 {stackResult.waitMs} ms</Badge>}
            {stackResult.textTruncated && <Badge tone="amber">异常文案已截断</Badge>}
          </div>
          {typeof stackResult.text === "string" && stackResult.text.length > 0 && (
            <pre
              style={{
                margin: "0 0 10px",
                maxHeight: 160,
                overflow: "auto",
                padding: 10,
                borderRadius: 8,
                fontSize: 11,
                lineHeight: 1.45,
                background: "#fff7ed",
                border: "1px solid #fed7aa",
                color: "#9a3412",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              }}
            >
              {stackResult.text}
            </pre>
          )}
          {typeof stackResult.note === "string" && stackResult.note.length > 0 && (
            <p style={{ margin: "0 0 8px", fontSize: 11, color: OBS_PALETTE.textMuted, lineHeight: 1.45 }}>
              {stackResult.note}
            </p>
          )}
          {Array.isArray(stackResult.frames) && stackResult.frames.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 11,
                  background: "#fff",
                  border: `1px solid ${OBS_PALETTE.border}`,
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <thead>
                  <tr style={{ background: "#fef3c7", color: "#92400e", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px", fontWeight: 600, width: 36 }}>#</th>
                    <th style={{ padding: "8px 10px", fontWeight: 600 }}>函数</th>
                    <th style={{ padding: "8px 10px", fontWeight: 600 }}>行</th>
                    <th style={{ padding: "8px 10px", fontWeight: 600 }}>列</th>
                    <th style={{ padding: "8px 10px", fontWeight: 600 }}>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {stackResult.frames.map((fr, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${OBS_PALETTE.border}` }}>
                      <td style={{ padding: "8px 10px", color: OBS_PALETTE.textMuted }}>{i}</td>
                      <td
                        style={{
                          padding: "8px 10px",
                          fontFamily: "ui-monospace, monospace",
                          wordBreak: "break-word",
                          color: "#0f172a",
                        }}
                      >
                        {fr.functionName && fr.functionName.length > 0 ? fr.functionName : "(anonymous)"}
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {fr.lineNumber !== undefined ? String(fr.lineNumber) : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {fr.columnNumber !== undefined ? String(fr.columnNumber) : "—"}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          wordBreak: "break-all",
                          color: "#334155",
                          lineHeight: 1.4,
                        }}
                      >
                        {fr.url && fr.url.length > 0 ? fr.url : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                color: OBS_PALETTE.textMuted,
                background: "#fffbeb",
                border: `1px dashed ${OBS_PALETTE.border}`,
              }}
            >
              监听窗口内未捕获到新的异常（可在页面触发报错后重试，或拉长「异常栈监听 ms」）。
            </div>
          )}
        </div>
      )}
      {stackErr && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 8,
            background: "#fef2f2",
            fontSize: 11,
            color: "#991b1b",
            lineHeight: 1.45,
          }}
        >
          异常栈：{stackErr}
        </div>
      )}
      {globalsText !== null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: OBS_PALETTE.textMuted, marginBottom: 6 }}>
            renderer-globals 响应（JSON）
          </div>
          <pre
            style={{
              margin: 0,
              maxHeight: 320,
              overflow: "auto",
              padding: 12,
              borderRadius: 8,
              fontSize: 10,
              lineHeight: 1.45,
              background: "#f1f5f9",
              border: `1px solid ${OBS_PALETTE.border}`,
              color: "#0f172a",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          >
            {globalsText}
          </pre>
        </div>
      )}
      {globalsErr && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 8,
            background: "#fef2f2",
            fontSize: 11,
            color: "#991b1b",
            lineHeight: 1.45,
          }}
        >
          全局快照：{globalsErr}
        </div>
      )}
    </div>
  );
}

function TopologyVisual({
  raw,
  snapshotCtx,
}: {
  raw: string;
  snapshotCtx?: TopologySnapshotContext | null;
}) {
  let data: {
    schemaVersion?: number;
    sessionId?: string;
    partial?: boolean;
    warnings?: string[];
    nodes?: Array<{
      nodeId: string;
      targetId: string;
      type: string;
      title: string;
      url: string;
    }>;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return (
      <pre style={{ margin: 0, padding: 14, fontSize: 12, whiteSpace: "pre-wrap" }}>{raw}</pre>
    );
  }
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        {data.partial && <Badge tone="amber">部分数据</Badge>}
        {typeof data.schemaVersion === "number" && (
          <Badge tone="slate">schema v{data.schemaVersion}</Badge>
        )}
        {nodes.length > 0 && <Badge tone="blue">{nodes.length} 个 target</Badge>}
      </div>
      {Array.isArray(data.warnings) && data.warnings.length > 0 && (
        <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12, color: "#92400e" }}>
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {snapshotCtx && nodes.some((n) => n.type === "page") && (
        <p style={{ margin: "0 0 12px", fontSize: 12, color: OBS_PALETTE.textMuted, lineHeight: 1.5 }}>
          每个 <strong>page</strong> 卡片顶部可「截取页面」「DOM 结构」「控制台」「HTTPS 观测」「异常栈」：对应{" "}
          <code style={{ fontSize: 11 }}>screenshot</code> / <code style={{ fontSize: 11 }}>dom</code> /{" "}
          <code style={{ fontSize: 11 }}>console-messages</code> / <code style={{ fontSize: 11 }}>network-observe</code> /{" "}
          <code style={{ fontSize: 11 }}>runtime-exception</code>
          （默认不自动拉取）。下方「DevTools 附加」提供 <code style={{ fontSize: 11 }}>chrome://inspect</code>{" "}
          用直连端口、CDP 网关、<code style={{ fontSize: 11 }}>devtools://</code>（须复制到 Chrome 地址栏）。宿主窗口尺寸/前置等依赖 Electron CDP 扩展，<strong>纯 Web Studio 不提供</strong>。<strong>实时观测</strong>在<strong>右侧抽屉</strong>展示控制台 / HTTPS / 异常栈 SSE（平时收起；点右下角「实时观测」或卡片内对应按钮）。短时「控制台 / HTTPS / 异常栈」按钮仍为窗口采样。需 Core
          开启 Agent API（可用 <code style={{ fontSize: 11 }}>OPENDESKTOP_AGENT_API=0</code> 关闭）。
          若出现 <code style={{ fontSize: 11 }}>Unknown action: dom</code>，说明运行的 Core 仍是旧构建：请在{" "}
          <code style={{ fontSize: 11 }}>packages/core</code> 执行 <code style={{ fontSize: 11 }}>yarn build</code>{" "}
          后重启进程；自检 <code style={{ fontSize: 11 }}>GET /v1/version</code> 应包含{" "}
          <code style={{ fontSize: 11 }}>agentActions</code> 且其中有 <code style={{ fontSize: 11 }}>dom</code>。
        </p>
      )}
      {nodes.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: OBS_PALETTE.textMuted }}>暂无 CDP target 或未能拉取列表。</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 10,
          }}
        >
          {nodes.map((n, i) => (
            <div
              key={n.nodeId || n.targetId || i}
              style={{
                border: `1px solid ${OBS_PALETTE.border}`,
                borderRadius: 10,
                padding: 12,
                background: "#fff",
                boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
              }}
            >
              {snapshotCtx && n.type === "page" && n.targetId && (
                <PageTargetScreenshot
                  ctx={{ ...snapshotCtx, sessionId: data.sessionId ?? snapshotCtx.sessionId }}
                  targetId={n.targetId}
                  enabled
                  windowTitle={n.title || "（无标题）"}
                />
              )}
              <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a", marginBottom: 6 }}>
                {n.title || "（无标题）"}
              </div>
              <div style={{ marginBottom: 8 }}>
                <Badge tone={n.type === "page" ? "blue" : "slate"}>{n.type || "?"}</Badge>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: OBS_PALETTE.textMuted,
                  wordBreak: "break-all",
                  lineHeight: 1.4,
                  maxHeight: 56,
                  overflow: "hidden",
                }}
                title={n.url}
              >
                {n.url || "—"}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 10,
                  color: "#94a3b8",
                  fontFamily: "ui-monospace, monospace",
                }}
                title={n.targetId}
              >
                target: {n.targetId?.slice(0, 12)}…
              </div>
            </div>
          ))}
        </div>
      )}
      <RawJsonCollapse raw={raw} />
    </div>
  );
}

function MetricsVisual({ raw }: { raw: string }) {
  let data: {
    sessionId?: string;
    sampledAt?: string;
    metrics?: { cpuPercent?: number; memoryBytes?: number } | null;
    reason?: string;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return (
      <pre style={{ margin: 0, padding: 14, fontSize: 12, whiteSpace: "pre-wrap" }}>{raw}</pre>
    );
  }
  const m = data.metrics;
  const cpu = m?.cpuPercent;
  const mem = m?.memoryBytes;
  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <div
          style={{
            flex: "1 1 140px",
            minWidth: 120,
            padding: 14,
            borderRadius: 12,
            background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
            border: "1px solid #a7f3d0",
          }}
        >
          <div style={{ fontSize: 11, color: "#047857", fontWeight: 600 }}>CPU</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#065f46", marginTop: 4 }}>
            {typeof cpu === "number" ? `${cpu.toFixed(1)}%` : "—"}
          </div>
          {typeof cpu === "number" && (
            <div
              style={{
                marginTop: 8,
                height: 6,
                borderRadius: 3,
                background: "#a7f3d0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, cpu))}%`,
                  height: "100%",
                  background: "#059669",
                  borderRadius: 3,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          )}
        </div>
        <div
          style={{
            flex: "1 1 140px",
            minWidth: 120,
            padding: 14,
            borderRadius: 12,
            background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
            border: "1px solid #93c5fd",
          }}
        >
          <div style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 600 }}>内存</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1e40af", marginTop: 4 }}>
            {typeof mem === "number" ? formatBytes(mem) : "—"}
          </div>
        </div>
      </div>
      {data.reason && (
        <p style={{ fontSize: 12, color: "#b45309", margin: "0 0 8px" }}>
          说明：{data.reason}
        </p>
      )}
      {data.sampledAt && (
        <p style={{ fontSize: 11, color: OBS_PALETTE.textMuted, margin: "0 0 8px" }}>
          采样时间 {new Date(data.sampledAt).toLocaleString()}
        </p>
      )}
      <RawJsonCollapse raw={raw} />
    </div>
  );
}

function SnapshotVisual({ raw }: { raw: string }) {
  let data: {
    sessionId?: string;
    state?: string;
    topologySummary?: { nodeCount?: number; partial?: boolean };
    recentErrors?: { count?: number; last?: string };
    metrics?: { cpuPercent?: number; memoryBytes?: number } | null;
    metricsReason?: string;
    suggestedNextSteps?: string[];
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return (
      <pre style={{ margin: 0, padding: 14, fontSize: 12, whiteSpace: "pre-wrap" }}>{raw}</pre>
    );
  }
  const steps = Array.isArray(data.suggestedNextSteps) ? data.suggestedNextSteps : [];
  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {data.state && <Badge tone="blue">状态 {data.state}</Badge>}
        {data.topologySummary && (
          <Badge tone="slate">
            窗口 {data.topologySummary.nodeCount ?? 0} 节点
            {data.topologySummary.partial ? " · 部分" : ""}
          </Badge>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div style={{ padding: 12, borderRadius: 10, background: "#fff", border: `1px solid ${OBS_PALETTE.border}` }}>
          <div style={{ fontSize: 11, color: OBS_PALETTE.textMuted }}>最近异常条数</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a" }}>
            {data.recentErrors?.count ?? 0}
          </div>
          {data.recentErrors?.last && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "#64748b",
                maxHeight: 48,
                overflow: "hidden",
                lineHeight: 1.35,
              }}
              title={data.recentErrors.last}
            >
              最后一条：{data.recentErrors.last}
            </div>
          )}
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: "#fff", border: `1px solid ${OBS_PALETTE.border}` }}>
          <div style={{ fontSize: 11, color: OBS_PALETTE.textMuted }}>指标</div>
          {data.metrics ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
                CPU {data.metrics.cpuPercent?.toFixed(1) ?? "—"}%
              </div>
              <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
                内存 {formatBytes(data.metrics.memoryBytes ?? 0)}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
              {data.metricsReason || "无指标"}
            </div>
          )}
        </div>
      </div>
      {steps.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#334155" }}>建议下一步</div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#475569" }}>
            {steps.map((s, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}
      <RawJsonCollapse raw={raw} />
    </div>
  );
}

function ObservationBody({
  kind,
  text,
  loading,
  topologySnapshotCtx,
}: {
  kind: DetailKind | null;
  text: string | null;
  loading: boolean;
  /** 仅拓扑面板：用于按 target 拉取页面截图 */
  topologySnapshotCtx?: TopologySnapshotContext | null;
}) {
  if (loading && !text) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          fontSize: 13,
          color: OBS_PALETTE.textMuted,
        }}
      >
        正在拉取数据…
      </div>
    );
  }
  if (text == null) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return (
      <pre
        style={{
          margin: 0,
          padding: 14,
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          background: "#f1f5f9",
          color: "#991b1b",
        }}
      >
        {text}
      </pre>
    );
  }
  if (kind === "list-window") return <TopologyVisual raw={text} snapshotCtx={topologySnapshotCtx ?? undefined} />;
  if (kind === "metrics") return <MetricsVisual raw={text} />;
  if (kind === "snapshot") return <SnapshotVisual raw={text} />;
  return (
    <pre
      style={{
        margin: 0,
        padding: 14,
        fontSize: 12,
        background: "#f1f5f9",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      {tryPrettyJson(text)}
    </pre>
  );
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("od_token") ?? "");
  const [base, setBase] = useState(() => localStorage.getItem("od_base") ?? "");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [apps, setApps] = useState<OdApp[]>([]);
  const [appsErr, setAppsErr] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<OdProfile[]>([]);
  const [profilesErr, setProfilesErr] = useState<string | null>(null);
  const [selectedProfileByApp, setSelectedProfileByApp] = useState<Record<string, string>>({});
  const [appBusyId, setAppBusyId] = useState<string | null>(null);
  const [appActionMsg, setAppActionMsg] = useState<Record<string, string>>({});
  /** 已注册应用 — 用户脚本弹层 */
  const [userScriptAppId, setUserScriptAppId] = useState<string | null>(null);
  const [userScriptList, setUserScriptList] = useState<OdUserScript[]>([]);
  const [userScriptListLoading, setUserScriptListLoading] = useState(false);
  const [userScriptSelectedId, setUserScriptSelectedId] = useState<string | null>(null);
  const [userScriptSource, setUserScriptSource] = useState("");
  const [userScriptBusy, setUserScriptBusy] = useState(false);
  const [userScriptErr, setUserScriptErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailTopo, setDetailTopo] = useState<string | null>(null);
  const [detailMetrics, setDetailMetrics] = useState<string | null>(null);
  const [detailSnap, setDetailSnap] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<DetailKind | null>(null);
  const [cdpCopiedId, setCdpCopiedId] = useState<string | null>(null);

  const apiRoot = resolveApiRoot(base);
  const sessionsUrl = apiRoot ? `${apiRoot}/v1/sessions` : "/v1/sessions";
  const appsUrl = apiRoot ? `${apiRoot}/v1/apps` : "/v1/apps";
  const profilesUrl = apiRoot ? `${apiRoot}/v1/profiles` : "/v1/profiles";
  const tokenTrimmed = token.trim();

  const headers = {
    Authorization: `Bearer ${tokenTrimmed}`,
    "Content-Type": "application/json",
  };

  /** `stopped` 不展示（旧数据/兼容）；`killed` 等其余状态展示 */
  const sessionsVisible = useMemo(
    () => sessions.filter((s) => (s.state || "").toLowerCase() !== "stopped"),
    [sessions],
  );

  const refreshCoreData = useCallback(async () => {
    const h = {
      Authorization: `Bearer ${tokenTrimmed}`,
      "Content-Type": "application/json",
    };
    try {
      const res = await fetch(sessionsUrl, { headers: h });
      const raw = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
      if (!raw.trimStart().startsWith("{")) {
        throw new Error(
          "返回不是 JSON（常为 HTML）。若用 yarn dev:web，请留空 API Base 并确认已启动 Core:8787；或显式填 http://127.0.0.1:8787",
        );
      }
      const data = JSON.parse(raw) as { sessions: Session[] };
      setSessions(data.sessions);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    try {
      const res = await fetch(appsUrl, { headers: h });
      const raw = await res.text();
      if (!res.ok) {
        setAppsErr(`应用列表 ${res.status}: ${raw.slice(0, 200)}`);
        setApps([]);
        return;
      }
      if (!raw.trimStart().startsWith("{")) {
        setAppsErr("应用列表返回非 JSON");
        setApps([]);
        return;
      }
      const data = JSON.parse(raw) as { apps?: OdApp[] };
      setAppsErr(null);
      setApps(Array.isArray(data.apps) ? data.apps : []);
    } catch (e) {
      setAppsErr(e instanceof Error ? e.message : String(e));
      setApps([]);
    }
    try {
      const res = await fetch(profilesUrl, { headers: h });
      const raw = await res.text();
      if (!res.ok) {
        setProfilesErr(`Profile 列表 ${res.status}: ${raw.slice(0, 200)}`);
        setProfiles([]);
        return;
      }
      if (!raw.trimStart().startsWith("{")) {
        setProfilesErr("Profile 列表返回非 JSON");
        setProfiles([]);
        return;
      }
      const data = JSON.parse(raw) as { profiles?: OdProfile[] };
      setProfilesErr(null);
      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
    } catch (e) {
      setProfilesErr(e instanceof Error ? e.message : String(e));
      setProfiles([]);
    }
  }, [tokenTrimmed, sessionsUrl, appsUrl, profilesUrl]);

  useEffect(() => {
    if (!tokenTrimmed) {
      setErr("请在下方填写 token（见 Core 数据目录或终端里 Token: 行）");
      setSessions([]);
      setApps([]);
      setAppsErr(null);
      setProfiles([]);
      setProfilesErr(null);
      return;
    }
    void refreshCoreData();
  }, [tokenTrimmed, refreshCoreData]);

  useEffect(() => {
    setSelectedProfileByApp((prev) => {
      const next = { ...prev };
      for (const a of apps) {
        const ps = profiles.filter((p) => p.appId === a.id);
        if (ps.length === 0) continue;
        if (!next[a.id] || !ps.some((p) => p.id === next[a.id])) {
          next[a.id] = ps[0].id;
        }
      }
      return next;
    });
  }, [apps, profiles]);

  /** 会话已从 Core 移除，或变为不展示的 `stopped` 时收起观测详情 */
  useEffect(() => {
    if (!detailId) return;
    if (!sessionsVisible.some((s) => s.id === detailId)) {
      setDetailId(null);
      setDetailTopo(null);
      setDetailMetrics(null);
      setDetailSnap(null);
      setDetailLoading(null);
    }
  }, [sessionsVisible, detailId]);

  /** 进程被杀/断线后状态在 Core 内更新，定时拉取会话与列表以便 UI 同步 */
  useEffect(() => {
    if (!tokenTrimmed) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshCoreData();
    };
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [tokenTrimmed, refreshCoreData]);

  function apiUrl(path: string): string {
    return apiRoot ? `${apiRoot}${path}` : path;
  }

  async function copyCdpGatewayForSession(sessionId: string) {
    const url = cdpGatewayHttpUrl(apiRoot ?? "", sessionId);
    await copyToClipboard(url);
    setCdpCopiedId(sessionId);
    window.setTimeout(() => {
      setCdpCopiedId((cur) => (cur === sessionId ? null : cur));
    }, 2000);
  }

  async function startSessionForApp(appId: string) {
    const profs = profiles.filter((p) => p.appId === appId);
    if (profs.length === 0) {
      setAppActionMsg((m) => ({
        ...m,
        [appId]: "无可用 Profile：请先创建 Profile（如 yarn oc app init-demo）",
      }));
      return;
    }
    const profileId = selectedProfileByApp[appId] ?? profs[0].id;
    setAppActionMsg((m) => ({ ...m, [appId]: "" }));
    setAppBusyId(appId);
    try {
      const res = await fetch(apiUrl("/v1/sessions"), {
        method: "POST",
        headers,
        body: JSON.stringify({ profileId }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${raw.slice(0, 220)}`);
      await refreshCoreData();
    } catch (e) {
      setAppActionMsg((m) => ({
        ...m,
        [appId]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setAppBusyId(null);
    }
  }

  async function stopSessionsForApp(appId: string) {
    const profileIds = new Set(profiles.filter((p) => p.appId === appId).map((p) => p.id));
    const targets = sessions.filter(
      (s) =>
        profileIds.has(s.profileId) && ["running", "starting", "pending"].includes(s.state),
    );
    if (targets.length === 0) return;
    setAppActionMsg((m) => ({ ...m, [appId]: "" }));
    setAppBusyId(appId);
    try {
      for (const s of targets) {
        const res = await fetch(apiUrl(`/v1/sessions/${s.id}/stop`), {
          method: "POST",
          headers,
        });
        const raw = await res.text();
        if (!res.ok) throw new Error(`停止 ${s.id.slice(0, 8)}…: ${res.status} ${raw.slice(0, 120)}`);
      }
      await refreshCoreData();
    } catch (e) {
      setAppActionMsg((m) => ({
        ...m,
        [appId]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setAppBusyId(null);
    }
  }

  async function refreshUserScriptList(appId: string): Promise<void> {
    const res = await fetch(apiUrl(`/v1/apps/${encodeURIComponent(appId)}/user-scripts`), { headers });
    const raw = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${raw.slice(0, 200)}`);
    const data = JSON.parse(raw) as { scripts?: OdUserScript[] };
    setUserScriptList(Array.isArray(data.scripts) ? data.scripts : []);
  }

  function openUserScriptsModal(appId: string) {
    if (!tokenTrimmed) {
      setAppActionMsg((m) => ({ ...m, [appId]: "请先填写 Bearer token" }));
      return;
    }
    setUserScriptAppId(appId);
    setUserScriptErr(null);
    setUserScriptSelectedId(null);
    setUserScriptSource(DEFAULT_USER_SCRIPT);
    setUserScriptListLoading(true);
    void (async () => {
      try {
        await refreshUserScriptList(appId);
      } catch (e) {
        setUserScriptErr(e instanceof Error ? e.message : String(e));
        setUserScriptList([]);
      } finally {
        setUserScriptListLoading(false);
      }
    })();
  }

  function closeUserScriptsModal() {
    setUserScriptAppId(null);
    setUserScriptErr(null);
    setUserScriptList([]);
    setUserScriptSelectedId(null);
    setUserScriptSource("");
  }

  async function saveUserScriptDraft() {
    if (!userScriptAppId) return;
    setUserScriptBusy(true);
    setUserScriptErr(null);
    try {
      const basePath = `/v1/apps/${encodeURIComponent(userScriptAppId)}/user-scripts`;
      const path = userScriptSelectedId
        ? `${basePath}/${encodeURIComponent(userScriptSelectedId)}`
        : basePath;
      const res = await fetch(apiUrl(path), {
        method: userScriptSelectedId ? "PATCH" : "POST",
        headers,
        body: JSON.stringify({ source: userScriptSource }),
      });
      const raw = await res.text();
      if (!res.ok) {
        let msg = raw.slice(0, 400);
        try {
          const j = JSON.parse(raw) as { error?: { code?: string; message?: string } };
          if (j.error?.message) {
            msg = j.error.code ? `${j.error.code}: ${j.error.message}` : j.error.message;
          }
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      const data = JSON.parse(raw) as { script?: OdUserScript };
      if (data.script) {
        setUserScriptSelectedId(data.script.id);
        setUserScriptSource(data.script.source);
      }
      await refreshUserScriptList(userScriptAppId);
    } catch (e) {
      setUserScriptErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUserScriptBusy(false);
    }
  }

  async function deleteSelectedUserScript() {
    if (!userScriptAppId || !userScriptSelectedId) return;
    setUserScriptBusy(true);
    setUserScriptErr(null);
    try {
      const res = await fetch(
        apiUrl(
          `/v1/apps/${encodeURIComponent(userScriptAppId)}/user-scripts/${encodeURIComponent(userScriptSelectedId)}`,
        ),
        { method: "DELETE", headers },
      );
      const raw = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${raw.slice(0, 200)}`);
      setUserScriptSelectedId(null);
      setUserScriptSource(DEFAULT_USER_SCRIPT);
      await refreshUserScriptList(userScriptAppId);
    } catch (e) {
      setUserScriptErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUserScriptBusy(false);
    }
  }

  async function loadDetail(sessionId: string, kind: "list-window" | "metrics" | "snapshot") {
    if (!tokenTrimmed) {
      const msg =
        "未填写 token：请先粘贴 Bearer。缺 token 时 Core 会返回 401，而不是你看到的 404。";
      if (kind === "list-window") setDetailTopo(msg);
      if (kind === "metrics") setDetailMetrics(msg);
      if (kind === "snapshot") setDetailSnap(msg);
      return;
    }
    const path =
      kind === "list-window"
        ? `/v1/sessions/${sessionId}/list-window`
        : kind === "metrics"
          ? `/v1/sessions/${sessionId}/metrics`
          : `/v1/agent/sessions/${sessionId}/snapshot`;
    setDetailTopo(null);
    setDetailMetrics(null);
    setDetailSnap(null);
    setDetailLoading(kind);
    setDetailId(sessionId);
    try {
      const res = await fetch(apiUrl(path), { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text) as unknown;
      const pretty = JSON.stringify(json, null, 2);
      if (kind === "list-window") setDetailTopo(pretty);
      if (kind === "metrics") setDetailMetrics(pretty);
      if (kind === "snapshot") setDetailSnap(pretty);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (kind === "list-window") setDetailTopo(msg);
      if (kind === "metrics") setDetailMetrics(msg);
      if (kind === "snapshot") setDetailSnap(msg);
    } finally {
      setDetailLoading(null);
    }
  }

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        minHeight: "100vh",
        boxSizing: "border-box",
        background: "#f1f5f9",
        padding: "24px 18px 40px",
      }}
    >
      <style>{`
        .od-input {
          display: block;
          width: 100%;
          margin-top: 6px;
          padding: 10px 12px;
          font-size: 14px;
          border-radius: 8px;
          border: 1px solid ${OBS_PALETTE.border};
          background: #fff;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .od-input:focus {
          outline: none;
          border-color: ${OBS_PALETTE.borderActive};
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
        }
        .od-table-row:hover td {
          background: #f8fafc;
        }
      `}</style>

      <LiveConsoleDockLayout apiRoot={apiRoot ?? ""} token={tokenTrimmed}>
      <div style={{ maxWidth: 920, margin: "0 auto", width: "100%" }}>
        <h1
          style={{
            margin: "0 0 6px",
            fontSize: 26,
            fontWeight: 700,
            color: "#0f172a",
            letterSpacing: "-0.02em",
          }}
        >
          OpenDesktop
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: OBS_PALETTE.textMuted }}>
          只读应用注册、会话列表与观测面板
        </p>

        <div
          style={{
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${OBS_PALETTE.border}`,
            background: "#fff",
            boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              background: "#fff",
              borderBottom: `1px solid ${OBS_PALETTE.border}`,
            }}
          >
            <span
              style={{
                width: 4,
                height: 18,
                borderRadius: 2,
                background: "#64748b",
              }}
            />
            <span style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>Core 连接与鉴权</span>
          </div>
          <div style={{ padding: 16, background: "#fafbfc" }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>API Base</div>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: OBS_PALETTE.textMuted, lineHeight: 1.45 }}>
                留空时：生产同源 /v1；开发默认直连 http://127.0.0.1:8787（除非当前页本身已在 :8787）。
              </p>
              <input
                className="od-input"
                value={base}
                onChange={(e) => {
                  setBase(e.target.value);
                  localStorage.setItem("od_base", e.target.value);
                }}
                placeholder="留空（开发默认 8787）或 http://127.0.0.1:8787"
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Bearer token</div>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: OBS_PALETTE.textMuted, lineHeight: 1.45 }}>
                见 Core 数据目录或终端中 Token 行；缺 token 时列表请求会失败。
              </p>
              <input
                className="od-input"
                value={token}
                type="password"
                autoComplete="off"
                onChange={(e) => {
                  setToken(e.target.value);
                  localStorage.setItem("od_token", e.target.value);
                }}
              />
            </div>
            {err && (
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 10,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#991b1b",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {err}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${OBS_PALETTE.border}`,
            background: "#fff",
            boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              background: "#fff",
              borderBottom: `1px solid ${OBS_PALETTE.border}`,
            }}
          >
            <span
              style={{
                width: 4,
                height: 18,
                borderRadius: 2,
                background: "#6366f1",
              }}
            />
            <span style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>已注册应用</span>
            <span style={{ fontSize: 12, color: OBS_PALETTE.textMuted, fontWeight: 400 }}>
              （与 <code style={{ fontSize: 11 }}>yarn oc app list</code> 同源；启动会话等价{" "}
              <code style={{ fontSize: 11 }}>yarn oc session create &lt;profileId&gt;</code>）
            </span>
          </div>
          <div style={{ background: "#fafbfc" }}>
            {!tokenTrimmed && (
              <p style={{ margin: 16, fontSize: 13, color: OBS_PALETTE.textMuted }}>
                填写 Bearer token 后从 Core 拉取应用列表。
              </p>
            )}
            {profilesErr && (
              <div
                style={{
                  margin: "12px 16px 0",
                  padding: 12,
                  borderRadius: 10,
                  background: "#fffbeb",
                  border: "1px solid #fcd34d",
                  color: "#92400e",
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                {profilesErr}（操作列依赖 Profile 列表；可检查 Core 与 token）
              </div>
            )}
            {appsErr && (
              <div
                style={{
                  margin: 16,
                  padding: 12,
                  borderRadius: 10,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#991b1b",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {appsErr}
              </div>
            )}
            {tokenTrimmed && !appsErr && (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 900,
                    borderCollapse: "collapse",
                    background: "#fff",
                    tableLayout: "fixed",
                  }}
                >
                  <thead>
                    <tr>
                      {["ID", "名称", "可执行文件", "工作目录", "CDP 注入", "启动参数", "操作"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: "12px 14px",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#475569",
                            borderBottom: `1px solid ${OBS_PALETTE.border}`,
                            background: "#f8fafc",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {apps.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          style={{
                            padding: 20,
                            fontSize: 13,
                            color: OBS_PALETTE.textMuted,
                            borderBottom: `1px solid #f1f5f9`,
                          }}
                        >
                          暂无已注册应用。可使用 CLI 注册，例如{" "}
                          <code style={{ fontSize: 12 }}>yarn oc app init-demo</code>。
                        </td>
                      </tr>
                    ) : (
                      apps.map((a) => {
                        const argsStr = JSON.stringify(a.args);
                        const argsShort = argsStr.length > 72 ? `${argsStr.slice(0, 72)}…` : argsStr;
                        const profs = profiles.filter((p) => p.appId === a.id);
                        const pidSet = new Set(profs.map((p) => p.id));
                        const activeForApp = sessions.filter(
                          (s) =>
                            pidSet.has(s.profileId) &&
                            ["running", "starting", "pending"].includes(s.state),
                        );
                        const busy = appBusyId === a.id;
                        const msg = appActionMsg[a.id];
                        return (
                          <tr key={a.id} className="od-table-row">
                            <td
                              title={a.id}
                              style={{
                                padding: "12px 14px",
                                fontSize: 12,
                                color: "#0f172a",
                                borderBottom: `1px solid #f1f5f9`,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                verticalAlign: "middle",
                              }}
                            >
                              {a.id}
                            </td>
                            <td
                              title={a.name}
                              style={{
                                padding: "12px 14px",
                                fontSize: 12,
                                color: "#334155",
                                borderBottom: `1px solid #f1f5f9`,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                verticalAlign: "middle",
                              }}
                            >
                              {a.name}
                            </td>
                            <td
                              title={a.executable}
                              style={{
                                padding: "12px 14px",
                                fontSize: 11,
                                color: "#334155",
                                borderBottom: `1px solid #f1f5f9`,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                verticalAlign: "middle",
                                fontFamily: "ui-monospace, monospace",
                              }}
                            >
                              {a.executable}
                            </td>
                            <td
                              title={a.cwd}
                              style={{
                                padding: "12px 14px",
                                fontSize: 11,
                                color: "#64748b",
                                borderBottom: `1px solid #f1f5f9`,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                verticalAlign: "middle",
                                fontFamily: "ui-monospace, monospace",
                              }}
                            >
                              {a.cwd}
                            </td>
                            <td
                              style={{
                                padding: "12px 14px",
                                borderBottom: `1px solid #f1f5f9`,
                                verticalAlign: "middle",
                              }}
                            >
                              <Badge tone={a.injectElectronDebugPort ? "green" : "slate"}>
                                {a.injectElectronDebugPort ? "是" : "否"}
                              </Badge>
                            </td>
                            <td
                              title={argsStr}
                              style={{
                                padding: "12px 14px",
                                fontSize: 11,
                                color: "#475569",
                                borderBottom: `1px solid #f1f5f9`,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                verticalAlign: "middle",
                                fontFamily: "ui-monospace, monospace",
                              }}
                            >
                              {argsShort}
                            </td>
                            <td
                              style={{
                                padding: "10px 12px",
                                borderBottom: `1px solid #f1f5f9`,
                                verticalAlign: "top",
                                fontSize: 11,
                              }}
                            >
                              {msg && (
                                <div
                                  style={{
                                    color: "#991b1b",
                                    marginBottom: 6,
                                    lineHeight: 1.35,
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {msg}
                                </div>
                              )}
                              {profs.length > 1 && (
                                <label style={{ display: "block", marginBottom: 6, color: OBS_PALETTE.textMuted }}>
                                  Profile
                                  <select
                                    value={selectedProfileByApp[a.id] ?? profs[0]?.id}
                                    disabled={busy}
                                    onChange={(e) =>
                                      setSelectedProfileByApp((prev) => ({
                                        ...prev,
                                        [a.id]: e.target.value,
                                      }))
                                    }
                                    style={{
                                      display: "block",
                                      width: "100%",
                                      marginTop: 4,
                                      padding: "4px 6px",
                                      fontSize: 11,
                                      borderRadius: 6,
                                      border: `1px solid ${OBS_PALETTE.border}`,
                                    }}
                                  >
                                    {profs.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name} ({p.id})
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                <button
                                  type="button"
                                  disabled={busy || profs.length === 0}
                                  aria-label={busy ? "启动中" : "启动会话"}
                                  title={
                                    profs.length === 0
                                      ? "需先存在绑定到该应用的 Profile"
                                      : "POST /v1/sessions，等同 yarn oc session create"
                                  }
                                  onClick={() => void startSessionForApp(a.id)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minWidth: 30,
                                    minHeight: 28,
                                    padding: "4px 8px",
                                    cursor: busy || profs.length === 0 ? "not-allowed" : "pointer",
                                    borderRadius: 6,
                                    border: `1px solid ${OBS_PALETTE.borderActive}`,
                                    background: busy || profs.length === 0 ? "#f1f5f9" : "#eff6ff",
                                    color: busy || profs.length === 0 ? OBS_PALETTE.textMuted : "#1d4ed8",
                                  }}
                                >
                                  {busy ? (
                                    <IconSessionBusy color={profs.length === 0 ? OBS_PALETTE.textMuted : "#1d4ed8"} />
                                  ) : (
                                    <IconSessionStart color={profs.length === 0 ? OBS_PALETTE.textMuted : "#1d4ed8"} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || activeForApp.length === 0}
                                  aria-label={
                                    activeForApp.length === 0
                                      ? "关闭会话"
                                      : `关闭会话（${activeForApp.length} 个）`
                                  }
                                  title={
                                    activeForApp.length === 0
                                      ? "该应用下无运行中/启动中的会话"
                                      : `停止 ${activeForApp.length} 个会话（POST .../stop）`
                                  }
                                  onClick={() => void stopSessionsForApp(a.id)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 5,
                                    minWidth: 30,
                                    minHeight: 28,
                                    padding: "4px 8px",
                                    cursor: busy || activeForApp.length === 0 ? "not-allowed" : "pointer",
                                    borderRadius: 6,
                                    border: `1px solid #fca5a5`,
                                    background: busy || activeForApp.length === 0 ? "#f1f5f9" : "#fef2f2",
                                    color: busy || activeForApp.length === 0 ? OBS_PALETTE.textMuted : "#b91c1c",
                                  }}
                                >
                                  {busy ? (
                                    <IconSessionBusy
                                      color={activeForApp.length === 0 ? OBS_PALETTE.textMuted : "#b91c1c"}
                                    />
                                  ) : (
                                    <>
                                      <IconSessionStop
                                        color={activeForApp.length === 0 ? OBS_PALETTE.textMuted : "#b91c1c"}
                                      />
                                      {activeForApp.length > 0 && (
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            lineHeight: 1,
                                            minWidth: 14,
                                            textAlign: "center",
                                          }}
                                          aria-hidden
                                        >
                                          {activeForApp.length}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || !tokenTrimmed}
                                  title="按应用保存 UserScript 元数据；@match 仅存不用，不自动注入页面"
                                  onClick={() => openUserScriptsModal(a.id)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minHeight: 28,
                                    padding: "4px 10px",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: busy || !tokenTrimmed ? "not-allowed" : "pointer",
                                    borderRadius: 6,
                                    border: `1px solid ${OBS_PALETTE.border}`,
                                    background: busy || !tokenTrimmed ? "#f1f5f9" : "#fff",
                                    color: busy || !tokenTrimmed ? OBS_PALETTE.textMuted : "#334155",
                                  }}
                                >
                                  脚本
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${OBS_PALETTE.border}`,
            background: "#fff",
            boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              background: "#fff",
              borderBottom: `1px solid ${OBS_PALETTE.border}`,
            }}
          >
            <span
              style={{
                width: 4,
                height: 18,
                borderRadius: 2,
                background: OBS_PALETTE.accentTopo,
              }}
            />
            <span style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>会话列表</span>
            <span style={{ fontSize: 12, color: OBS_PALETTE.textMuted, fontWeight: 400 }}>（只读）</span>
          </div>
          <div style={{ overflowX: "auto", background: "#fafbfc" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: "#fff",
                tableLayout: "fixed",
              }}
            >
              <colgroup>
                <col style={{ width: 200 }} />
                <col style={{ width: 88 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 112 }} />
                <col />
              </colgroup>
        <thead>
          <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#475569",
                    borderBottom: `1px solid ${OBS_PALETTE.border}`,
                    background: "#f8fafc",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  ID
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#475569",
                    borderBottom: `1px solid ${OBS_PALETTE.border}`,
                    background: "#f8fafc",
                  }}
                >
                  状态
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#475569",
                    borderBottom: `1px solid ${OBS_PALETTE.border}`,
                    background: "#f8fafc",
                  }}
                >
                  Profile
                </th>
                <th
                  title="子进程 remote-debugging 端口；点击复制经 Core 的 CDP 网关（供 Playwright connectOverCDP 等）"
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#475569",
                    borderBottom: `1px solid ${OBS_PALETTE.border}`,
                    background: "#f8fafc",
                  }}
                >
                  CDP
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#475569",
                    borderBottom: `1px solid ${OBS_PALETTE.border}`,
                    background: "#f8fafc",
                    minWidth: 260,
                  }}
                >
                  观测
                </th>
          </tr>
        </thead>
        <tbody>
          {sessionsVisible.map((s) => (
            <React.Fragment key={s.id}>
              <tr className="od-table-row">
                <td
                  title={s.id}
                  style={{
                    padding: "12px 14px",
                    fontSize: 12,
                    color: "#0f172a",
                    borderBottom: `1px solid #f1f5f9`,
                    maxWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    verticalAlign: "middle",
                  }}
                >
                  {s.id}
                </td>
                <td
                  style={{
                    padding: "12px 14px",
                    borderBottom: `1px solid #f1f5f9`,
                    verticalAlign: "middle",
                  }}
                >
                  <SessionStateTag state={s.state} />
                </td>
                <td
                  style={{
                    padding: "12px 14px",
                    fontSize: 13,
                    color: "#334155",
                    borderBottom: `1px solid #f1f5f9`,
                  }}
                >
                  {s.profileId}
                </td>
                <td
                  style={{
                    padding: "10px 12px",
                    borderBottom: `1px solid #f1f5f9`,
                    verticalAlign: "top",
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 600,
                      color: typeof s.cdpPort === "number" ? "#0f172a" : OBS_PALETTE.textMuted,
                    }}
                  >
                    {typeof s.cdpPort === "number" ? s.cdpPort : "—"}
                  </div>
                  <button
                    type="button"
                    aria-label={cdpCopiedId === s.id ? "已复制" : "复制 CDP 网关"}
                    title={cdpGatewayHttpUrl(apiRoot ?? "", s.id)}
                    onClick={() => void copyCdpGatewayForSession(s.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 6,
                      minWidth: 30,
                      minHeight: 28,
                      padding: "4px 8px",
                      cursor: "pointer",
                      borderRadius: 6,
                      border:
                        cdpCopiedId === s.id
                          ? "1px solid #86efac"
                          : `1px solid ${OBS_PALETTE.borderActive}`,
                      background: cdpCopiedId === s.id ? "#f0fdf4" : "#eff6ff",
                      color: cdpCopiedId === s.id ? "#15803d" : "#1d4ed8",
                      maxWidth: "100%",
                    }}
                  >
                    {cdpCopiedId === s.id ? (
                      <IconCopied color="#15803d" />
                    ) : (
                      <IconCopy color="#1d4ed8" />
                    )}
                  </button>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 10,
                      color: OBS_PALETTE.textMuted,
                      lineHeight: 1.35,
                      wordBreak: "break-all",
                    }}
                  >
                    经 Core 代理；裸端口见上（仅本机子进程）
                  </div>
                </td>
                <td
                  style={{
                    verticalAlign: "top",
                    padding: "12px 14px",
                    borderBottom: `1px solid #f1f5f9`,
                  }}
                >
                  <ObservActionCards
                    sessionId={s.id}
                    loadingKind={detailLoading}
                    detailId={detailId}
                    detailTopo={detailTopo}
                    detailMetrics={detailMetrics}
                    detailSnap={detailSnap}
                    onAction={(id, kind) => void loadDetail(id, kind)}
                  />
                </td>
              </tr>
              {detailId === s.id && (detailLoading || detailTopo || detailMetrics || detailSnap) && (
                <tr>
                  <td colSpan={5} style={{ borderBottom: "1px solid #e8edf4", paddingBottom: 12 }}>
                    {(() => {
                      const panelKind: DetailKind | null =
                        detailLoading ??
                        (detailTopo
                          ? "list-window"
                          : detailMetrics
                            ? "metrics"
                            : detailSnap
                              ? "snapshot"
                              : null);
                      return (
                    <div
                      style={{
                        borderRadius: 12,
                        overflow: "hidden",
                        border: `1px solid ${OBS_PALETTE.border}`,
                        background: "#fafbfc",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "10px 14px",
                          background: "#fff",
                          borderBottom: `1px solid ${OBS_PALETTE.border}`,
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#0f172a",
                        }}
                      >
                        <span
                          style={{
                            width: 4,
                            height: 18,
                            borderRadius: 2,
                            background: detailPanelAccent(panelKind),
                          }}
                        />
                        {detailPanelTitle(panelKind)}
                        {detailLoading && (
                          <span style={{ fontWeight: 400, color: OBS_PALETTE.textMuted, fontSize: 12 }}>
                            加载中…
                          </span>
                        )}
                      </div>
                      <ObservationBody
                        kind={panelKind}
                        text={detailTopo ?? detailMetrics ?? detailSnap}
                        loading={!!detailLoading}
                        topologySnapshotCtx={
                          panelKind === "list-window" && detailId
                            ? {
                                sessionId: detailId,
                                apiRoot: apiRoot ?? "",
                                token: tokenTrimmed,
                                cdpDirectPort: sessions.find((s) => s.id === detailId)?.cdpPort,
                              }
                            : undefined
                        }
                      />
                    </div>
                      );
                    })()}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
          </div>
        </div>
      </div>
      {userScriptAppId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="od-user-script-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            boxSizing: "border-box",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeUserScriptsModal();
          }}
        >
          <div
            style={{
              width: "min(960px, 100%)",
              height: "min(92vh, 900px)",
              maxHeight: "min(92vh, 900px)",
              background: "#fff",
              borderRadius: 12,
              border: `1px solid ${OBS_PALETTE.border}`,
              boxShadow: "0 20px 50px rgba(15,23,42,0.18)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 16px",
                borderBottom: `1px solid ${OBS_PALETTE.border}`,
                background: "#f8fafc",
                flexShrink: 0,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div id="od-user-script-title" style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                  用户脚本 · {userScriptAppId}
                </div>
                <div style={{ fontSize: 11, color: OBS_PALETTE.textMuted, marginTop: 4, lineHeight: 1.4 }}>
                  `@match` 等元数据会保存，但<strong>当前不会</strong>用于 URL 匹配或自动注入；SPA 场景见 README。
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flexShrink: 0, alignItems: "center" }}>
                <button
                  type="button"
                  disabled={userScriptBusy || !userScriptSource.trim()}
                  onClick={() => void saveUserScriptDraft()}
                  style={{
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 700,
                    borderRadius: 8,
                    border: `1px solid ${OBS_PALETTE.borderActive}`,
                    background:
                      userScriptBusy || !userScriptSource.trim() ? "#e2e8f0" : "#2563eb",
                    color: userScriptBusy || !userScriptSource.trim() ? "#94a3b8" : "#fff",
                    cursor: userScriptBusy || !userScriptSource.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  {userScriptBusy ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  onClick={() => closeUserScriptsModal()}
                  style={{
                    padding: "8px 14px",
                    fontSize: 13,
                    borderRadius: 8,
                    border: `1px solid ${OBS_PALETTE.border}`,
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  关闭
                </button>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flex: 1,
                minHeight: 0,
                gap: 0,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: 220,
                  flexShrink: 0,
                  borderRight: `1px solid ${OBS_PALETTE.border}`,
                  overflow: "auto",
                  padding: "10px 8px",
                  background: "#fafafa",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: OBS_PALETTE.textMuted, marginBottom: 8 }}>
                  已保存
                </div>
                {userScriptListLoading ? (
                  <div style={{ fontSize: 12, color: OBS_PALETTE.textMuted }}>加载中…</div>
                ) : userScriptList.length === 0 ? (
                  <div style={{ fontSize: 12, color: OBS_PALETTE.textMuted }}>暂无，点右侧「新建」或编辑后保存</div>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {userScriptList.map((s) => (
                      <li key={s.id} style={{ marginBottom: 4 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setUserScriptSelectedId(s.id);
                            setUserScriptSource(s.source);
                            setUserScriptErr(null);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            fontSize: 12,
                            borderRadius: 8,
                            border:
                              userScriptSelectedId === s.id
                                ? `1px solid ${OBS_PALETTE.borderActive}`
                                : `1px solid transparent`,
                            background: userScriptSelectedId === s.id ? "#eff6ff" : "#fff",
                            cursor: "pointer",
                            wordBreak: "break-word",
                          }}
                        >
                          <span style={{ fontWeight: 600, color: "#0f172a" }}>{s.metadata.name}</span>
                          {s.metadata.matches.length > 0 && (
                            <span style={{ display: "block", fontSize: 10, color: OBS_PALETTE.textMuted, marginTop: 2 }}>
                              {s.metadata.matches.length} 条 @match
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  minHeight: 0,
                  padding: 12,
                  overflow: "hidden",
                }}
              >
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea
                    className="od-input"
                    value={userScriptSource}
                    onChange={(e) => setUserScriptSource(e.target.value)}
                    spellCheck={false}
                    placeholder="完整 .user.js 源文"
                    style={{
                      flex: 1,
                      minHeight: 120,
                      width: "100%",
                      resize: "none",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 12,
                      lineHeight: 1.45,
                      marginTop: 0,
                      overflow: "auto",
                    }}
                  />
                  {userScriptErr && (
                    <div
                      style={{
                        flexShrink: 0,
                        padding: "8px 10px",
                        fontSize: 12,
                        color: "#991b1b",
                        background: "#fef2f2",
                        borderRadius: 8,
                        wordBreak: "break-word",
                      }}
                    >
                      {userScriptErr}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: `1px solid ${OBS_PALETTE.border}`,
                    flexShrink: 0,
                  }}
                >
                  <button
                    type="button"
                    disabled={userScriptBusy || !userScriptSource.trim()}
                    onClick={() => void saveUserScriptDraft()}
                    style={{
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 700,
                      borderRadius: 8,
                      border: `1px solid ${OBS_PALETTE.borderActive}`,
                      background:
                        userScriptBusy || !userScriptSource.trim() ? "#e2e8f0" : "#2563eb",
                      color: userScriptBusy || !userScriptSource.trim() ? "#94a3b8" : "#fff",
                      cursor: userScriptBusy || !userScriptSource.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    {userScriptBusy ? "保存中…" : "保存"}
                  </button>
                  <button
                    type="button"
                    disabled={userScriptBusy}
                    onClick={() => {
                      setUserScriptSelectedId(null);
                      setUserScriptSource(DEFAULT_USER_SCRIPT);
                      setUserScriptErr(null);
                    }}
                    style={{
                      padding: "8px 14px",
                      fontSize: 12,
                      borderRadius: 8,
                      border: `1px solid ${OBS_PALETTE.border}`,
                      background: "#fff",
                      cursor: userScriptBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    新建草稿
                  </button>
                  <button
                    type="button"
                    disabled={userScriptBusy || !userScriptSelectedId}
                    onClick={() => void deleteSelectedUserScript()}
                    style={{
                      padding: "8px 14px",
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #fca5a5",
                      background: userScriptBusy || !userScriptSelectedId ? "#f1f5f9" : "#fef2f2",
                      color: userScriptBusy || !userScriptSelectedId ? OBS_PALETTE.textMuted : "#b91c1c",
                      cursor: userScriptBusy || !userScriptSelectedId ? "not-allowed" : "pointer",
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </LiveConsoleDockLayout>
    </div>
  );
}
