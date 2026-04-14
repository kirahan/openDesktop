import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NetworkView } from "./network/NetworkView.js";
import { proxyRequestCompleteToRow, requestCompleteToRow } from "./network/sseToRow.js";
import type { NetworkRequestRow } from "./network/types.js";
import { domPickStateKey } from "./domPickUi.js";
import {
  appIdExists,
  parseAppIdsFromListJson,
  suggestedAppIdFromExecutablePath,
} from "./appIdSuggest.js";
import { mapReplayCoordsToObjectFitContain } from "./replay/replayOverlayMath.js";
import { splitReplayLinesBySegmentMarkers } from "./replay/splitReplayLinesBySegmentMarkers.js";
import { filterNonStructureReplayLines } from "./replay/structureSnapshotTree.js";
import { RrwebReplayView } from "./replay/RrwebReplayView.js";
import { RrwebStreamDiagnostics } from "./replay/rrwebDiagnosticsPanel.js";
import {
  nativeAccessibilityAtPointDisabledReason,
  nativeAccessibilityTreeDisabledReason,
} from "./nativeAccessibilityObservability.js";
import { MacAxTreeVisual } from "./macAxTreeVisual.js";
import {
  buildNativeAccessibilityAtPointPath,
  QT_AX_SHELL_CURSOR_POLL_MS,
} from "./nativeA11yAtPointUrl.js";
import { applyElectronShellBearerTokenPrefillIfEmpty, getElectronShell } from "./studioShell.js";

type DetailKind = "list-window" | "metrics" | "snapshot" | "native-a11y" | "native-a11y-point";

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
  accentNativeA11y: "#c2410c",
  accentNativeA11yPoint: "#ea580c",
};

/** 「指针附近无障碍」面板打开时自动轮询 nut-js 鼠标坐标 + Core 采样间隔（毫秒）（未开启壳十字线时） */
const NATIVE_A11Y_POINT_POLL_MS = 3000;

function isLikelyDarwinPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = navigator.platform ?? "";
  const ua = navigator.userAgent ?? "";
  return p.toLowerCase().includes("mac") || /Mac OS X|iPhone|iPad/i.test(ua);
}

type Session = {
  id: string;
  profileId: string;
  state: string;
  createdAt: string;
  cdpPort?: number;
  /** 子进程 PID（macOS 原生无障碍树等能力依赖） */
  pid?: number;
  /** Core 在 failed 等终态时写入，如 CDP_READY_TIMEOUT、child exited… */
  error?: string;
  /** Core 聚合自应用定义 */
  uiRuntime?: "electron" | "qt";
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
  uiRuntime?: "electron" | "qt";
  injectElectronDebugPort: boolean;
  /** 启动时追加 `--headless=new`（Chromium/Electron） */
  headless?: boolean;
  /** 与会话启动时注入进程级 HTTP(S)_PROXY 对应（GET /v1/sessions/.../proxy/stream） */
  useDedicatedProxy?: boolean;
};

/** GET /v1/profiles，启动配置（内部为 Profile；用于 session start 等） */
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

/** 与 Core `path.win32.isAbsolute` 对齐的轻量检测（注册 .lnk 时提示用） */
function looksLikeWindowsAbsolutePath(p: string): boolean {
  let t = p.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  if (!t) return false;
  if (t.startsWith("\\\\")) return true;
  return /^[a-zA-Z]:[\\/]/.test(t);
}

/** 快捷方式解析失败时附加的操作提示（复制完整路径） */
const LNK_RESOLVE_FAIL_HINT =
  "请确认路径含盘符且文件存在。仍失败时：在资源管理器中 Shift+右键快捷方式 →「复制为路径」，粘贴到上方（可去掉首尾引号）后再试。";

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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
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

/** 原生 Accessibility（AX）树 */
function IconNativeA11y({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3c-1.1 0-2 .9-2 2v1H8c-.6 0-1 .4-1 1v2H5c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h4v-6h4v6h4c.6 0 1-.4 1-1V8c0-.6-.4-1-1-1h-2V7c0-.6-.4-1-1-1h-2V5c0-1.1-.9-2-2-2z"
        stroke={color}
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
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
  sessionUiRuntime,
  loadingKind,
  detailId,
  detailTopo,
  detailMetrics,
  detailSnap,
  detailNativeA11y,
  detailNativeA11yPoint,
  nativeA11yDisabledReason,
  nativeA11yPointDisabledReason,
  onAction,
}: {
  sessionId: string;
  sessionUiRuntime: "electron" | "qt";
  loadingKind: DetailKind | null;
  detailId: string | null;
  detailTopo: string | null;
  detailMetrics: string | null;
  detailSnap: string | null;
  detailNativeA11y: string | null;
  detailNativeA11yPoint: string | null;
  /** 非 null 时禁用「原生无障碍树」并展示原因 */
  nativeA11yDisabledReason: string | null;
  nativeA11yPointDisabledReason: string | null;
  onAction: (id: string, kind: DetailKind) => void;
}) {
  const electronRows: {
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
    {
      kind: "native-a11y",
      title: "原生无障碍树",
      hint: "系统 AX（Qt 等无 CDP 页面）",
      Icon: IconNativeA11y,
      accent: OBS_PALETTE.accentNativeA11y,
    },
  ];
  const qtRows: (typeof electronRows)[number][] = [
    {
      kind: "native-a11y",
      title: "原生无障碍树",
      hint: "整棵 AX 子树（可能较大）",
      Icon: IconNativeA11y,
      accent: OBS_PALETTE.accentNativeA11y,
    },
    {
      kind: "native-a11y-point",
      title: "捕获无障碍树（鼠标周围）",
      hint: "指针屏幕坐标附近局部 AX",
      Icon: IconNativeA11y,
      accent: OBS_PALETTE.accentNativeA11yPoint,
    },
  ];
  const rows = sessionUiRuntime === "qt" ? qtRows : electronRows;

  const isActive = (kind: DetailKind) => {
    if (detailId !== sessionId) return false;
    if (loadingKind === kind) return true;
    if (kind === "list-window" && detailTopo) return true;
    if (kind === "metrics" && detailMetrics) return true;
    if (kind === "snapshot" && detailSnap) return true;
    if (kind === "native-a11y" && detailNativeA11y) return true;
    if (kind === "native-a11y-point" && detailNativeA11yPoint) return true;
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
        maxWidth: 560,
      }}
    >
      {rows.map(({ kind, title, hint, Icon, accent }) => {
        const active = isActive(kind);
        const loading = loadingKind === kind && detailId === sessionId;
        const isNativeTree = kind === "native-a11y";
        const isNativePoint = kind === "native-a11y-point";
        const nativeReason = isNativeTree
          ? nativeA11yDisabledReason
          : isNativePoint
            ? nativeA11yPointDisabledReason
            : null;
        const cardDisabled = (isNativeTree || isNativePoint) && nativeReason !== null;
        const hintText =
          (isNativeTree || isNativePoint) && nativeReason ? nativeReason : hint;
        return (
          <button
            key={kind}
            type="button"
            disabled={cardDisabled}
            title={cardDisabled ? nativeReason ?? undefined : undefined}
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
              cursor: cardDisabled ? "not-allowed" : "pointer",
              opacity: cardDisabled ? 0.55 : 1,
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
              {hintText}
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
  if (kind === "native-a11y") return "原生无障碍树（AX）";
  if (kind === "native-a11y-point") return "指针附近无障碍（AX）";
  return "结果";
}

function detailPanelAccent(kind: DetailKind | null): string {
  if (kind === "list-window") return OBS_PALETTE.accentTopo;
  if (kind === "metrics") return OBS_PALETTE.accentMetrics;
  if (kind === "snapshot") return OBS_PALETTE.accentSnap;
  if (kind === "native-a11y") return OBS_PALETTE.accentNativeA11y;
  if (kind === "native-a11y-point") return OBS_PALETTE.accentNativeA11yPoint;
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
function SessionStateTag({ state, error }: { state: string; error?: string }) {
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
      title={k === "failed" && error ? error : undefined}
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

/** 仅保留可交给 Core `parseReplayEnvelope` 的 NDJSON 行（去掉 `[warning]` 等非事件 JSON）。 */
function filterVectorLinesForTestRecordingArtifact(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("[warning]")) continue;
    try {
      const o = JSON.parse(line) as { schemaVersion?: unknown; type?: unknown };
      if (o.schemaVersion !== 1) continue;
      const typ = o.type;
      if (
        typ === "pointermove" ||
        typ === "pointerdown" ||
        typ === "click" ||
        typ === "structure_snapshot" ||
        typ === "assertion_checkpoint" ||
        typ === "segment_start" ||
        typ === "segment_end"
      ) {
        out.push(line);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

/** 与矢量预览「复制 BDD 提示词」同一套说明，仅替换中间数据块 */
function buildBddFeaturePromptBlock(dataBlock: string): string {
  const truncated =
    dataBlock.length > 20000
      ? `${dataBlock.slice(0, 20000)}\n\n…（已截断，请配合完整落盘文件或自行拼接）`
      : dataBlock;
  return `你是测试工程师。下列为矢量录制 JSON（每行一条）。请据此编写 Gherkin 风格的 BDD Feature 文件（步骤描述可用中文）。\n\n分析重点（优先遵守）：\n- 以用户意图与完整流程为主：通读时间线，推断用户在完成什么任务；用业务语言概括场景，不要逐条复述或堆砌坐标数字。\n- pointermove 等事件里的 x、y、viewportWidth 等仅作辅助理解顺序，默认不要在 Given/When/Then 里写具体像素坐标。\n- 更有价值的是 click（及带 target 时）：用 target 中的 tagName、id、className、selector、data-*、role、可见文本等，翻译成可读的控件或区域描述（例如输入框、置顶会话项、工具栏图标），用于步骤表述。\n- 若连续多条仅为移动指针而无新的有效交互，可合并为「浏览或定位」类描述，不必为每次采样单独一步。\n- segment_start / segment_end / assertion_checkpoint 表示人工标记的分段或检查点，可在 Scenario 边界或 Then 预期中体现。\n\n输出要求：\n- 输出完整 Feature，含 Feature、Scenario，以及 Given / When / Then（或团队约定的中文关键词）。\n- 步骤顺序与录制中的有效交互顺序一致（以 click 等业务节点为主线）。\n- 不要编造录制中不存在的行为；未出现的输入、接口结果等不要写死。\n\n--- 录制数据开始 ---\n${truncated}\n--- 录制数据结束 ---`;
}

/** 右侧抽屉内 SSE 类型：与 Core `GET .../console|network|runtime-exception|proxy/stream` 及 `logs/stream` 对齐 */
type ObservabilityStreamKind =
  | "console"
  | "network"
  | "exception"
  | "proxy"
  | "mainlog"
  | "replay"
  | "rrweb";

/** rrweb 事件条数上限，避免长会话撑爆内存 */
const MAX_RRWEB_EVENTS = 6000;

/** 矢量录制 overlay 标记（视口 CSS 坐标 + 视口宽高，用于缩放映射） */
type ReplayOverlayMark = {
  kind: "move" | "click";
  x: number;
  y: number;
  vw: number;
  vh: number;
  ts: number;
};

/** 本地代理流 tab 用的占位 targetId（非 CDP target） */
const SESSION_PROXY_TARGET_ID = "__session_proxy__";

/** 子进程 stdout/stderr 日志流 tab 占位（非 CDP target） */
const SESSION_MAIN_LOG_TARGET_ID = "__session_main_log__";

function observabilityStreamKindLabel(k: ObservabilityStreamKind): string {
  switch (k) {
    case "console":
      return "页面控制台";
    case "network":
      return "HTTPS";
    case "exception":
      return "异常";
    case "proxy":
      return "主进程代理";
    case "mainlog":
      return "主进程日志";
    case "replay":
      return "矢量录制";
    case "rrweb":
      return "rrweb 回放";
    default:
      return k;
  }
}

function observabilityStartButtonLabel(kind: ObservabilityStreamKind, running: boolean): string {
  if (running) return "订阅中…";
  switch (kind) {
    case "console":
      return "开始页面控制台流";
    case "network":
      return "开始 HTTPS 流";
    case "exception":
      return "开始异常栈流";
    case "proxy":
      return "开始主进程代理流";
    case "mainlog":
      return "开始主进程日志流";
    case "replay":
      return "开始矢量录制流";
    case "rrweb":
      return "开始 rrweb 流";
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
      return "SSE · uncaught 异常与栈 · 须会话允许脚本执行 allowScriptExecution（否则 HTTP 403）";
    case "proxy":
      return "SSE · 本地转发代理 · HTTP 明文 + HTTPS CONNECT（不解密）· 须应用开启专用代理";
    case "mainlog":
      return "SSE · Core 拉起的子进程 stdout/stderr（连接前先推送已有缓冲）· 与渲染进程 DevTools 控制台不是同一路";
    case "replay":
      return "须先 POST 开启录制。目标页底部默认显示标记条（段开始、段结束、检查点；非本窗口）。清屏仅清空本标签；点抽屉内「停止」会结束订阅并请求 stop。有数据后可「落盘测试录制」。";
    case "rrweb":
      return "须先 POST 开启 rrweb 录制（或「注入录制包」）；SSE data 帧为 rrweb JSON（type 为数字）；清屏清空本标签累积事件；停止会结束订阅并请求 rrweb stop";
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
    case "proxy":
      path = `/v1/sessions/${sessionId}/proxy/stream`;
      break;
    case "mainlog":
      path = `/v1/sessions/${sessionId}/logs/stream`;
      break;
    case "replay":
      path = `/v1/sessions/${sessionId}/replay/stream?targetId=${enc}`;
      break;
    case "rrweb":
      path = `/v1/sessions/${sessionId}/rrweb/stream?targetId=${enc}`;
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
  /** `streamKind === "network" | "proxy"` 时：SSE 累积表格行 */
  networkRows?: NetworkRequestRow[];
  /** `streamKind === "replay"`：overlay 用采样点 */
  replayOverlay?: ReplayOverlayMark[];
  /** `streamKind === "rrweb"`：Replayer 用事件列表 */
  rrwebEvents?: unknown[];
  running: boolean;
  err: string | null;
};

/**
 * rrweb SSE 事件频率很高（尤其 MouseMove），若每条都 setTabs 会拖垮主线程与 Replayer。
 * 合并为每帧最多一次更新，显著降低卡顿。
 */
function createRrwebEventBatchSink(
  tabId: string,
  ac: AbortController,
  setTabs: React.Dispatch<React.SetStateAction<LiveConsoleTabState[]>>,
): {
  push: (obj: Record<string, unknown>) => void;
  flushSync: () => void;
} {
  const pending: Record<string, unknown>[] = [];
  let rafId: number | null = null;

  const flush = (): void => {
    rafId = null;
    if (ac.signal.aborted) {
      pending.length = 0;
      return;
    }
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId || t.streamKind !== "rrweb") return t;
        const prevEv = t.rrwebEvents ?? [];
        const nextEv = [...prevEv, ...batch];
        return {
          ...t,
          rrwebEvents:
            nextEv.length > MAX_RRWEB_EVENTS ? nextEv.slice(-MAX_RRWEB_EVENTS) : nextEv,
        };
      }),
    );
  };

  return {
    push(obj: Record<string, unknown>): void {
      pending.push(obj);
      if (rafId == null) {
        rafId = requestAnimationFrame(flush);
      }
    },
    flushSync(): void {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      flush();
    },
  };
}

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

function VectorReplayPreview({
  lines,
  marks,
  apiRoot,
  sessionId,
  targetId,
  token,
  screenshotWhileRunning,
}: {
  lines: string[];
  marks: ReplayOverlayMark[];
  apiRoot: string;
  sessionId: string;
  targetId: string;
  token: string;
  /** 为 true 时轮询窗口截图作为轻虚化背景（约 5s），不实时逐帧刷新 */
  screenshotWhileRunning: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 200 });
  const [blurBgSrc, setBlurBgSrc] = useState<string | null>(null);
  const [bddCopied, setBddCopied] = useState(false);
  const logLinesWithoutStructure = useMemo(() => filterNonStructureReplayLines(lines), [lines]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!screenshotWhileRunning) {
      setBlurBgSrc(null);
      return;
    }
    const tok = token.trim();
    if (!tok) {
      setBlurBgSrc(null);
      return;
    }
    const base = apiRoot.replace(/\/$/, "");
    const path = `/v1/agent/sessions/${sessionId}/actions`;
    const url = base ? `${base}${path}` : path;
    let cancelled = false;
    const fetchShot = async (): Promise<void> => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "screenshot", targetId }),
        });
        const text = await res.text();
        if (cancelled) return;
        if (!res.ok) return;
        const j = JSON.parse(text) as Record<string, unknown>;
        const data = j.data;
        const mimeRaw = j.mime;
        if (typeof data !== "string" || data.length === 0) return;
        const mime =
          typeof mimeRaw === "string" && /^image\/[a-z0-9.+-]+$/i.test(mimeRaw) ? mimeRaw : "image/png";
        setBlurBgSrc(`data:${mime};base64,${data}`);
      } catch {
        if (!cancelled) setBlurBgSrc(null);
      }
    };
    void fetchShot();
    const id = window.setInterval(() => void fetchShot(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [screenshotWhileRunning, apiRoot, sessionId, targetId, token]);

  const copyBddPrompt = useCallback(async () => {
    const prompt = buildBddFeaturePromptBlock(logLinesWithoutStructure.join("\n"));
    const ok = await copyToClipboard(prompt);
    if (ok) {
      setBddCopied(true);
      window.setTimeout(() => setBddCopied(false), 2000);
    }
  }, [logLinesWithoutStructure]);

  const lastMove = [...marks].reverse().find((m) => m.kind === "move");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
      <div
        ref={ref}
        style={{
          position: "relative",
          flex: "1 1 auto",
          minHeight: "clamp(200px, 42vh, 78vh)",
          background: "#0f172a",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {blurBgSrc ? (
          <img
            alt=""
            src={blurBgSrc}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              filter: "blur(0.5px)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
        ) : null}
        {lastMove && lastMove.vw > 0 && lastMove.vh > 0 ? (
          (() => {
            const p = mapReplayCoordsToObjectFitContain(
              lastMove.x,
              lastMove.y,
              lastMove.vw,
              lastMove.vh,
              size.w,
              size.h,
            );
            return (
              <div
                title="pointermove（视口坐标映射到本预览框）"
                style={{
                  position: "absolute",
                  borderRadius: 999,
                  width: 12,
                  height: 12,
                  marginLeft: -6,
                  marginTop: -6,
                  background: "rgba(96, 165, 250, 0.95)",
                  left: p.leftPx,
                  top: p.topPx,
                  pointerEvents: "none",
                  zIndex: 1,
                  boxShadow: "0 0 0 2px rgba(15, 23, 42, 0.65), 0 0 14px rgba(96, 165, 250, 0.65)",
                }}
              />
            );
          })()
        ) : null}
        {marks
          .filter((m) => m.kind === "click")
          .slice(-12)
          .map((m, i) => {
            const p = mapReplayCoordsToObjectFitContain(m.x, m.y, m.vw, m.vh, size.w, size.h);
            return (
              <div
                key={`${m.ts}-${i}`}
                title="click"
                style={{
                  position: "absolute",
                  left: p.leftPx,
                  top: p.topPx,
                  width: 18,
                  height: 18,
                  marginLeft: -9,
                  marginTop: -9,
                  borderRadius: 999,
                  border: "2px solid #fbbf24",
                  background: "rgba(251, 191, 36, 0.22)",
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              />
            );
          })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void copyBddPrompt()}
          style={{
            padding: "6px 10px",
            fontSize: 11,
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#f8fafc",
            cursor: "pointer",
            color: "#0f172a",
          }}
        >
          复制 BDD 生成提示词（含 JSON）
        </button>
        {bddCopied ? <span style={{ fontSize: 11, color: "#166534" }}>已复制到剪贴板</span> : null}
        <span style={{ fontSize: 10, color: OBS_PALETTE.textMuted, lineHeight: 1.4 }}>
          将提示词粘贴到大模型即可生成侧重行为与点击目标的 Gherkin 用例；背景为当前窗口截图（轻度虚化），录制中约每 5 秒刷新
        </span>
      </div>
      {logLinesWithoutStructure.length > 0 && (
        <pre
          style={{
            margin: 0,
            flex: "0 1 auto",
            minHeight: 0,
            maxHeight: "min(280px, 32vh)",
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
          {logLinesWithoutStructure.join("\n")}
        </pre>
      )}
    </div>
  );
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

  const [testRecPersistMsg, setTestRecPersistMsg] = useState<string | null>(null);
  const [testRecPersistBusy, setTestRecPersistBusy] = useState(false);
  /** 本会话在观测页成功落盘的测试录制（用于列表与按条复制 BDD 提示词） */
  const [persistedTestRecordings, setPersistedTestRecordings] = useState<
    { appId: string; recordingId: string }[]
  >([]);

  useEffect(() => {
    setTestRecPersistMsg(null);
  }, [activeId]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const stopStream = useCallback(
    async (tabId: string): Promise<void> => {
      const tab = tabsRef.current.find((x) => x.id === tabId);
      const tok = token.trim();
      if (tab?.streamKind === "replay" && tok) {
        const base = apiRoot.replace(/\/$/, "");
        const stopUrl = `${base}/v1/sessions/${tab.sessionId}/replay/recording/stop`;
        try {
          const res = await fetch(stopUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tok}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ targetId: tab.targetId }),
          });
          /* 无活跃录制时 Core 返回 409，视为幂等成功 */
          if (!res.ok && res.status !== 409) void res.text().catch(() => undefined);
        } catch {
          /* noop */
        }
      } else if (tab?.streamKind === "rrweb" && tok) {
        const base = apiRoot.replace(/\/$/, "");
        const stopUrl = `${base}/v1/sessions/${tab.sessionId}/rrweb/recording/stop`;
        try {
          const res = await fetch(stopUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tok}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ targetId: tab.targetId }),
          });
          if (!res.ok && res.status !== 409) void res.text().catch(() => undefined);
        } catch {
          /* noop */
        }
      }
      abortMap.current.get(tabId)?.abort();
      abortMap.current.delete(tabId);
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, running: false } : t)));
    },
    [apiRoot, token],
  );

  const clearTabLines = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? {
              ...t,
              lines: [],
              networkRows:
                t.streamKind === "network" || t.streamKind === "proxy" ? [] : t.networkRows,
              replayOverlay: t.streamKind === "replay" ? [] : t.replayOverlay,
              rrwebEvents: t.streamKind === "rrweb" ? [] : t.rrwebEvents,
            }
          : t,
      ),
    );
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      void stopStream(tabId);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        setActiveId((a) => {
          if (a !== tabId) return a;
          return next[0]?.id ?? null;
        });
        return next;
      });
    },
    [stopStream],
  );

  const startStream = useCallback(
    async (
      tabId: string,
      sessionId: string,
      targetId: string,
      streamKind: ObservabilityStreamKind,
    ) => {
      await stopStream(tabId);
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

      let rrwebBatchSink: ReturnType<typeof createRrwebEventBatchSink> | null = null;

      try {
        if (streamKind === "rrweb") {
          rrwebBatchSink = createRrwebEventBatchSink(tabId, ac, setTabs);
        }
        if (streamKind === "replay" || streamKind === "rrweb") {
          const base = apiRoot.replace(/\/$/, "");
          const startPath =
            streamKind === "replay"
              ? `/v1/sessions/${sessionId}/replay/recording/start`
              : `/v1/sessions/${sessionId}/rrweb/recording/start`;
          const startUrl = `${base}${startPath}`;
          const startRes = await fetch(startUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokenTrim}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              streamKind === "replay" ? { targetId, injectPageControls: true } : { targetId },
            ),
            signal: ac.signal,
          });
          if (!startRes.ok) {
            const tx = await startRes.text();
            let msg = `HTTP ${startRes.status}`;
            try {
              const j = JSON.parse(tx) as { error?: { message?: string } };
              msg = j.error?.message ?? msg;
            } catch {
              msg = tx.slice(0, 200);
            }
            throw new Error(msg);
          }
        }

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
              if (streamKind === "replay") {
                let obj: Record<string, unknown>;
                try {
                  obj = JSON.parse(raw) as Record<string, unknown>;
                } catch {
                  pushLine(raw);
                  continue;
                }
                pushLine(raw);
                const typ = String(obj.type ?? "");
                if (typ !== "pointermove" && typ !== "click" && typ !== "pointerdown") {
                  continue;
                }
                const kind: ReplayOverlayMark["kind"] =
                  typ === "click" || typ === "pointerdown" ? "click" : "move";
                setTabs((prev) =>
                  prev.map((t) => {
                    if (t.id !== tabId || t.streamKind !== "replay") return t;
                    const mark: ReplayOverlayMark = {
                      kind,
                      x: Number(obj.x ?? 0),
                      y: Number(obj.y ?? 0),
                      vw: Number(obj.viewportWidth ?? 1),
                      vh: Number(obj.viewportHeight ?? 1),
                      ts: Number(obj.ts ?? 0),
                    };
                    const prevO = t.replayOverlay ?? [];
                    return { ...t, replayOverlay: [...prevO, mark].slice(-40) };
                  }),
                );
                continue;
              }
              if (streamKind === "rrweb") {
                let obj: Record<string, unknown>;
                try {
                  obj = JSON.parse(raw) as Record<string, unknown>;
                } catch {
                  continue;
                }
                if (typeof obj.type !== "number") continue;
                rrwebBatchSink?.push(obj);
                continue;
              }
              if (streamKind === "mainlog") {
                const row = JSON.parse(raw) as { ts?: string; stream?: string; line?: string };
                const tag = row.stream === "stderr" ? "stderr" : "stdout";
                const head = row.ts ? `${row.ts} [${tag}]` : `[${tag}]`;
                pushLine(`${head} ${String(row.line ?? "")}`);
                continue;
              }
              if (streamKind === "console") {
                const entry = JSON.parse(raw) as { type?: string; argsPreview?: string[] };
                pushLine(`[${entry.type ?? "log"}] ${(entry.argsPreview ?? []).join(" ")}`);
                continue;
              }
              if (streamKind === "network" || streamKind === "proxy") {
                const o = JSON.parse(raw) as {
                  kind?: string;
                  method?: string;
                  url?: string;
                  durationMs?: number;
                  status?: number;
                  requestId?: string;
                  tlsTunnel?: boolean;
                };
                if (streamKind === "network" && o.kind === "requestComplete") {
                  const row = requestCompleteToRow(o);
                  setTabs((prev) =>
                    prev.map((t) => {
                      if (t.id !== tabId) return t;
                      const prevRows = t.networkRows ?? [];
                      const nextRows = [...prevRows, row].slice(-500);
                      return { ...t, networkRows: nextRows };
                    }),
                  );
                } else if (streamKind === "proxy" && o.kind === "proxyRequestComplete") {
                  const row = proxyRequestCompleteToRow(o);
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
        rrwebBatchSink?.flushSync();
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
            networkRows: streamKind === "network" || streamKind === "proxy" ? [] : undefined,
            replayOverlay: streamKind === "replay" ? [] : undefined,
            rrwebEvents: streamKind === "rrweb" ? [] : undefined,
            running: false,
            err: null,
          },
        ];
      });
      setActiveId(id);
      setDrawerOpen(true);
      if (!existed && (streamKind === "network" || streamKind === "proxy" || streamKind === "mainlog")) {
        window.setTimeout(
          () => void startStream(id, p.sessionId, p.targetId, streamKind),
          0,
        );
      }
    },
    [startStream],
  );

  const copyBddPromptForPersistedArtifact = useCallback(
    async (item: { appId: string; recordingId: string }) => {
      const tokenTrim = token.trim();
      if (!tokenTrim) return;
      const base = apiRoot.replace(/\/$/, "");
      const url = `${base}/v1/apps/${encodeURIComponent(item.appId)}/test-recording-artifacts/${encodeURIComponent(item.recordingId)}`;
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenTrim}` } });
        const tx = await res.text();
        if (!res.ok) {
          setTestRecPersistMsg(`✗ 读取制品失败 HTTP ${String(res.status)}`);
          return;
        }
        const artifact = JSON.parse(tx) as Record<string, unknown>;
        const dataBlock = JSON.stringify(artifact, null, 2);
        const prompt = buildBddFeaturePromptBlock(dataBlock);
        const ok = await copyToClipboard(prompt);
        if (ok) setTestRecPersistMsg(`✓ 已复制 BDD 提示词（${item.recordingId}）`);
        else setTestRecPersistMsg("✗ 复制失败");
      } catch (e) {
        setTestRecPersistMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [apiRoot, token],
  );

  const persistVectorTestRecording = useCallback(async () => {
    const tab = tabsRef.current.find((x) => x.id === activeId);
    if (!tab || tab.streamKind !== "replay") return;
    const tokenTrim = token.trim();
    if (!tokenTrim) return;
    const replayLines = filterVectorLinesForTestRecordingArtifact(tab.lines);
    if (replayLines.length === 0) {
      setTestRecPersistMsg("✗ 没有可落盘的矢量 JSON 行，请先「开始矢量录制流」并产生数据");
      return;
    }
    const chunks = splitReplayLinesBySegmentMarkers(replayLines);
    if (chunks.length === 0) {
      setTestRecPersistMsg("✗ 分段后无可落盘内容");
      return;
    }
    setTestRecPersistBusy(true);
    setTestRecPersistMsg(null);
    try {
      const base = apiRoot.replace(/\/$/, "");
      const url = `${base}/v1/sessions/${encodeURIComponent(tab.sessionId)}/test-recording-artifacts`;
      const stamp = `r${String(Date.now())}`;
      const parts: string[] = [];
      for (let idx = 0; idx < chunks.length; idx++) {
        const recordingId =
          chunks.length === 1 ? undefined : `${stamp}-p${String(idx + 1)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenTrim}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            targetId: tab.targetId,
            replayLines: chunks[idx],
            ...(recordingId !== undefined ? { recordingId } : {}),
          }),
        });
        const tx = await res.text();
        if (!res.ok) {
          let msg = `HTTP ${String(res.status)}`;
          try {
            const j = JSON.parse(tx) as { error?: { message?: string; code?: string } };
            msg = j.error?.message ?? j.error?.code ?? msg;
          } catch {
            msg = tx.slice(0, 280);
          }
          const prefix =
            chunks.length > 1
              ? `✗ 第 ${String(idx + 1)}/${String(chunks.length)} 段落盘失败：`
              : "✗ ";
          setTestRecPersistMsg(`${prefix}${msg}`);
          return;
        }
        try {
          const j = JSON.parse(tx) as {
            path?: string;
            recordingId?: string;
            artifact?: { appId?: string };
          };
          const rid = String(j.recordingId ?? "?");
          const pth = String(j.path ?? "");
          parts.push(`${rid} · ${pth}`);
          if (typeof j.recordingId === "string" && j.artifact && typeof j.artifact.appId === "string") {
            setPersistedTestRecordings((prev) => {
              const next = [{ appId: j.artifact!.appId!, recordingId: j.recordingId! }, ...prev];
              const deduped = next.filter(
                (x, i, a) => a.findIndex((y) => y.appId === x.appId && y.recordingId === x.recordingId) === i,
              );
              return deduped.slice(0, 25);
            });
          }
        } catch {
          parts.push("?");
        }
      }
      const summary =
        chunks.length > 1
          ? `✓ 已落盘 ${String(chunks.length)} 个制品（按 segment 分段）\n${parts.join("\n")}`
          : `✓ 已落盘 ${parts[0] ?? ""}`;
      setTestRecPersistMsg(summary);
    } catch (e) {
      setTestRecPersistMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestRecPersistBusy(false);
    }
  }, [activeId, apiRoot, token]);

  const ctxValue = useMemo(() => ({ openLiveTab }), [openLiveTab]);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const tokenOk = token.trim().length > 0;
  const drawerWide =
    active?.streamKind === "network" ||
    active?.streamKind === "proxy" ||
    active?.streamKind === "replay" ||
    active?.streamKind === "rrweb";

  return (
    <LiveConsoleDockContext.Provider value={ctxValue}>
      <div style={{ width: "100%" }}>{children}</div>
      {!drawerOpen && (
        <button
          type="button"
          aria-label={tabs.length > 0 ? `打开实时观测，已打开 ${tabs.length} 个标签` : "打开实时观测"}
          onClick={() => setDrawerOpen(true)}
          title={tabs.length > 0 ? `已打开 ${tabs.length} 个标签` : "页面控制台 / 主进程日志 / HTTPS / 异常栈 SSE"}
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
              在「窗口 / 调试目标」卡片中打开「页面控制台 / 主进程日志 / HTTPS / 异常栈 / 矢量录制 / rrweb」，或点右下角「实时观测」，可新开标签；同一窗口可开多种流（多 tab）。
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
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
                  flexShrink: 0,
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
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    overflow: "auto",
                  }}
                >
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
                    {active.streamKind === "replay" ? (
                      <button
                        type="button"
                        title="将本标签内累积的矢量 JSON 行 POST 为测试录制制品（须会话 running）"
                        disabled={
                          !tokenOk ||
                          testRecPersistBusy ||
                          filterVectorLinesForTestRecordingArtifact(active.lines).length === 0
                        }
                        onClick={() => void persistVectorTestRecording()}
                        style={pageInspectorBtnStyle(testRecPersistBusy)}
                      >
                        {testRecPersistBusy ? "落盘中…" : "落盘测试录制"}
                      </button>
                    ) : null}
                  </div>
                  <p style={{ margin: 0, fontSize: 10, color: OBS_PALETTE.textMuted, lineHeight: 1.45 }}>
                    {observabilityStreamHint(active.streamKind)}
                  </p>
                  {active.streamKind === "replay" && testRecPersistMsg ? (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 10,
                        lineHeight: 1.45,
                        color: testRecPersistMsg.startsWith("✓") ? "#166534" : "#b91c1c",
                        wordBreak: "break-word",
                      }}
                    >
                      {testRecPersistMsg}
                    </p>
                  ) : null}
                  {active.streamKind === "replay" && persistedTestRecordings.length > 0 ? (
                    <div
                      style={{
                        marginTop: 4,
                        padding: 8,
                        borderRadius: 8,
                        border: `1px solid ${OBS_PALETTE.border}`,
                        background: "#f8fafc",
                        maxHeight: 200,
                        overflow: "auto",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                        已落盘测试录制
                      </div>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                        {persistedTestRecordings.map((item) => (
                          <li
                            key={`${item.appId}::${item.recordingId}`}
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 10,
                            }}
                          >
                            <code
                              style={{
                                fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                                color: "#0f172a",
                                wordBreak: "break-all",
                                flex: "1 1 120px",
                              }}
                            >
                              {item.recordingId}
                            </code>
                            <button
                              type="button"
                              disabled={!tokenOk || testRecPersistBusy}
                              onClick={() => void copyBddPromptForPersistedArtifact(item)}
                              style={pageInspectorBtnStyle(!tokenOk || testRecPersistBusy)}
                            >
                              复制 BDD 提示词
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {active.err && (
                    <div style={{ fontSize: 11, color: "#991b1b", lineHeight: 1.4 }}>{active.err}</div>
                  )}
                  {active.streamKind === "network" || active.streamKind === "proxy" ? (
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
                  ) : active.streamKind === "replay" ? (
                    <VectorReplayPreview
                      lines={active.lines}
                      marks={active.replayOverlay ?? []}
                      apiRoot={apiRoot}
                      sessionId={active.sessionId}
                      targetId={active.targetId}
                      token={token}
                      screenshotWhileRunning={tokenOk && active.running}
                    />
                  ) : active.streamKind === "rrweb" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 200 }}>
                      <RrwebStreamDiagnostics
                        events={active.rrwebEvents ?? []}
                        streamRunning={active.running}
                      />
                      {(active.rrwebEvents ?? []).length === 0 ? (
                        <p style={{ margin: 0, fontSize: 11, color: OBS_PALETTE.textMuted }}>
                          下方重放区在至少 2 条事件后才会绘制；请先根据「数据诊断」确认 SSE 是否在累积 Meta(4) 与 FullSnapshot(2)。
                        </p>
                      ) : null}
                      <RrwebReplayView events={active.rrwebEvents ?? []} />
                    </div>
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
            </div>
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

  const [rrwebInjectLoading, setRrwebInjectLoading] = useState(false);
  const [rrwebInjectErr, setRrwebInjectErr] = useState<string | null>(null);
  const [rrwebInjectOk, setRrwebInjectOk] = useState(false);

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

  const runRrwebInject = useCallback(async () => {
    if (!tokenOk) return;
    setRrwebInjectLoading(true);
    setRrwebInjectErr(null);
    setRrwebInjectOk(false);
    try {
      const base = ctx.apiRoot.replace(/\/$/, "");
      const enc = encodeURIComponent(targetId);
      const url = `${base}/v1/sessions/${ctx.sessionId}/targets/${enc}/rrweb/inject`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.token.trim()}`,
          "Content-Type": "application/json",
        },
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text) as { error?: { message?: string } };
          msg = j.error?.message ?? msg;
        } catch {
          msg = text.slice(0, 200);
        }
        throw new Error(msg);
      }
      setRrwebInjectOk(true);
      window.setTimeout(() => setRrwebInjectOk(false), 3200);
    } catch (e) {
      setRrwebInjectErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRrwebInjectLoading(false);
    }
  }, [tokenOk, ctx.apiRoot, ctx.sessionId, ctx.token, targetId]);

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
        填写 Bearer token 后可使用截图、DOM、控制台短时采样、全局快照（renderer-globals）与探索（explore）；HTTPS / 异常栈请用下方「实时观测」SSE 流。
      </div>
    );
  }

  const shotLabel = shotLoading ? "截取中…" : shotSrc ? "刷新截图" : "截取页面";
  const domLabel = domLoading ? "读取中…" : domHtml ? "刷新 DOM" : "DOM 结构";
  const conLabel = conLoading ? "监听中…" : conEntries !== null ? "刷新控制台" : "控制台";

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
        通过 CDP 反射枚举当前 page 的 <code style={{ fontSize: 10 }}>globalThis</code> 属性（需会话侧允许脚本执行）。结果较大时仅作探测用途。
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
              此处为 <strong>SSE 长连接</strong>。页面控制台流仅含<strong>连接后的</strong>新事件；主进程日志流含 Core
              已缓冲行并持续推送子进程 stdout/stderr。可分别打开<strong> 页面控制台 / 主进程日志 / HTTPS / 异常栈 /
              矢量录制 / rrweb / 代理 </strong>
              等标签；HTTPS 限流时会出现 <code style={{ fontSize: 10 }}>[warning]</code>。
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
                打开页面控制台流
              </button>
              <button
                type="button"
                onClick={() =>
                  liveDock.openLiveTab({
                    sessionId: ctx.sessionId,
                    targetId: SESSION_MAIN_LOG_TARGET_ID,
                    label: windowTitle,
                    streamKind: "mainlog",
                  })
                }
                style={pageInspectorBtnStyle(false)}
                title="SSE：GET /v1/sessions/.../logs/stream（子进程 stdout/stderr）"
              >
                打开主进程日志流
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
              <button
                type="button"
                onClick={() =>
                  liveDock.openLiveTab({
                    sessionId: ctx.sessionId,
                    targetId,
                    label: windowTitle,
                    streamKind: "replay",
                  })
                }
                style={pageInspectorBtnStyle(false)}
                title="须 allowScriptExecution；先 POST 开启录制再订阅 SSE：.../replay/stream"
              >
                打开矢量录制
              </button>
              <button
                type="button"
                onClick={() =>
                  liveDock.openLiveTab({
                    sessionId: ctx.sessionId,
                    targetId,
                    label: windowTitle,
                    streamKind: "rrweb",
                  })
                }
                style={pageInspectorBtnStyle(false)}
                title="须 allowScriptExecution；先 POST 开启 rrweb 录制再订阅 SSE：.../rrweb/stream"
              >
                打开 rrweb 回放
              </button>
              <button
                type="button"
                disabled={!tokenOk || rrwebInjectLoading}
                onClick={() => void runRrwebInject()}
                style={pageInspectorBtnStyle(!tokenOk || rrwebInjectLoading)}
                title="POST .../targets/:targetId/rrweb/inject，向页面注入 rrweb 录制脚本"
              >
                {rrwebInjectLoading ? "注入中…" : rrwebInjectOk ? "已请求注入" : "注入 rrweb 录制包"}
              </button>
              <button
                type="button"
                onClick={() =>
                  liveDock.openLiveTab({
                    sessionId: ctx.sessionId,
                    targetId: SESSION_PROXY_TARGET_ID,
                    label: windowTitle,
                    streamKind: "proxy",
                  })
                }
                style={pageInspectorBtnStyle(false)}
                title="SSE：GET /v1/sessions/.../proxy/stream（须应用开启「专用代理」并重启会话）"
              >
                打开主进程代理流
              </button>
            </div>
            {rrwebInjectErr && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#991b1b", lineHeight: 1.4 }}>
                rrweb 注入：{rrwebInjectErr}
              </div>
            )}
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

/** 窗口列表筛选：空格分隔多关键词，均须在 title/url/targetId/nodeId/type 的合并文本中出现（子串、不区分大小写） */
function topologyNodeMatchesFilter(
  n: { nodeId?: string; targetId?: string; type?: string; title?: string; url?: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [n.title, n.url, n.targetId, n.nodeId, n.type]
    .map((s) => String(s ?? "").toLowerCase())
    .join(" ");
  const parts = q.split(/\s+/).filter(Boolean);
  return parts.every((part) => hay.includes(part));
}

/** 窗口列表筛选关键词，持久化到 localStorage */
const TOPOLOGY_WINDOW_FILTER_STORAGE_KEY = "od_topology_window_filter";

/** 窗口列表内按 target 的 DOM 拾取（arm / resolve / cancel） */
type TopologyDomPickProps = {
  busyKey: string | null;
  hints: Record<string, string>;
  onArm: (sessionId: string, targetId: string) => void | Promise<void>;
  onResolve: (sessionId: string, targetId: string) => void | Promise<void>;
  onCancel: (sessionId: string, targetId: string) => void | Promise<void>;
};

function TopologyVisual({
  raw,
  snapshotCtx,
  domPick,
}: {
  raw: string;
  snapshotCtx?: TopologySnapshotContext | null;
  domPick?: TopologyDomPickProps;
}) {
  const [windowListFilter, setWindowListFilter] = useState(() => {
    try {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(TOPOLOGY_WINDOW_FILTER_STORAGE_KEY) ?? ""
        : "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(TOPOLOGY_WINDOW_FILTER_STORAGE_KEY, windowListFilter);
    } catch {
      /* 忽略配额 / 隐私模式等 */
    }
  }, [windowListFilter]);

  type TopoPayload = {
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
  const parsed = useMemo((): { ok: true; data: TopoPayload } | { ok: false } => {
    try {
      return { ok: true, data: JSON.parse(raw) as TopoPayload };
    } catch {
      return { ok: false };
    }
  }, [raw]);

  const nodes = useMemo(() => {
    if (!parsed.ok) return [];
    const n = parsed.data.nodes;
    return Array.isArray(n) ? n : [];
  }, [parsed]);

  const filteredNodes = useMemo(
    () => nodes.filter((n) => topologyNodeMatchesFilter(n, windowListFilter)),
    [nodes, windowListFilter],
  );
  const filterActive = windowListFilter.trim().length > 0;

  if (!parsed.ok) {
    return (
      <pre style={{ margin: 0, padding: 14, fontSize: 12, whiteSpace: "pre-wrap" }}>{raw}</pre>
    );
  }

  const data = parsed.data;
  const sessionIdForDomPick = data.sessionId ?? snapshotCtx?.sessionId ?? "";
  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        {data.partial && <Badge tone="amber">部分数据</Badge>}
        {typeof data.schemaVersion === "number" && (
          <Badge tone="slate">schema v{data.schemaVersion}</Badge>
        )}
        {nodes.length > 0 && (
          <Badge tone="blue">
            {filterActive ? `显示 ${filteredNodes.length} / ${nodes.length} 个 target` : `${nodes.length} 个 target`}
          </Badge>
        )}
      </div>
      {nodes.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              color: OBS_PALETTE.textMuted,
              marginBottom: 6,
            }}
          >
            筛选窗口
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input
              type="search"
              value={windowListFilter}
              onChange={(e) => setWindowListFilter(e.target.value)}
              placeholder="标题、URL、targetId、类型等；空格表示同时包含"
              aria-label="筛选窗口列表"
              style={{
                flex: "1 1 220px",
                minWidth: 180,
                maxWidth: 480,
                padding: "8px 12px",
                fontSize: 12,
                borderRadius: 8,
                border: `1px solid ${OBS_PALETTE.border}`,
                background: "#fff",
                color: "#0f172a",
              }}
            />
            {filterActive && (
              <button
                type="button"
                onClick={() => setWindowListFilter("")}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  borderRadius: 8,
                  border: `1px solid ${OBS_PALETTE.border}`,
                  background: OBS_PALETTE.bgHover,
                  cursor: "pointer",
                  color: "#334155",
                }}
              >
                清除
              </button>
            )}
          </div>
        </div>
      )}
      {Array.isArray(data.warnings) && data.warnings.length > 0 && (
        <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12, color: "#92400e" }}>
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {snapshotCtx && nodes.some((n) => n.type === "page") && (
        <p style={{ margin: "0 0 12px", fontSize: 12, color: OBS_PALETTE.textMuted, lineHeight: 1.5 }}>
          每个 <strong>page</strong> 卡片顶部可「截取页面」「DOM 结构」「控制台」「探索」等 Agent 采样：对应{" "}
          <code style={{ fontSize: 11 }}>screenshot</code> / <code style={{ fontSize: 11 }}>dom</code> /{" "}
          <code style={{ fontSize: 11 }}>console-messages</code> / <code style={{ fontSize: 11 }}>explore</code>
          （默认不自动拉取）。<strong>HTTPS 与异常栈</strong>请用卡片内「打开 HTTPS 流」「打开异常栈流」在<strong>右侧抽屉</strong>看 SSE。
          下方「DevTools 附加」提供 <code style={{ fontSize: 11 }}>chrome://inspect</code>{" "}
          用直连端口、CDP 网关、<code style={{ fontSize: 11 }}>devtools://</code>（须复制到 Chrome 地址栏）。宿主窗口尺寸/前置等依赖 Electron CDP 扩展，<strong>纯 Web Studio 不提供</strong>。需 Core
          开启 Agent API（可用 <code style={{ fontSize: 11 }}>OPENDESKTOP_AGENT_API=0</code> 关闭）。
          若出现 <code style={{ fontSize: 11 }}>Unknown action: dom</code>，说明运行的 Core 仍是旧构建：请在{" "}
          <code style={{ fontSize: 11 }}>packages/core</code> 执行 <code style={{ fontSize: 11 }}>yarn build</code>{" "}
          后重启进程；自检 <code style={{ fontSize: 11 }}>GET /v1/version</code> 应包含{" "}
          <code style={{ fontSize: 11 }}>agentActions</code> 且其中有 <code style={{ fontSize: 11 }}>dom</code>。
        </p>
      )}
      {nodes.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: OBS_PALETTE.textMuted }}>暂无 CDP target 或未能拉取列表。</p>
      ) : filteredNodes.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: OBS_PALETTE.textMuted }}>
          无匹配窗口，请调整筛选条件或
          <button
            type="button"
            onClick={() => setWindowListFilter("")}
            style={{
              marginLeft: 6,
              padding: "2px 8px",
              fontSize: 12,
              borderRadius: 6,
              border: `1px solid ${OBS_PALETTE.border}`,
              background: "#fff",
              cursor: "pointer",
              color: OBS_PALETTE.accentTopo,
            }}
          >
            清除筛选
          </button>
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 10,
          }}
        >
          {filteredNodes.map((n, i) => {
            const domPickKey =
              domPick && sessionIdForDomPick && n.targetId
                ? domPickStateKey(sessionIdForDomPick, n.targetId)
                : "";
            const domPickBusyHere = Boolean(domPick && domPickKey && domPick.busyKey === domPickKey);
            const domPickHintHere = domPick && domPickKey ? domPick.hints[domPickKey] : undefined;
            return (
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
              {domPick && sessionIdForDomPick && n.type === "page" && n.targetId ? (
                <div style={{ marginTop: 10 }}>
                  <div
                    style={{
                      fontSize: 10,
                      color: OBS_PALETTE.textMuted,
                      marginBottom: 6,
                      lineHeight: 1.35,
                    }}
                  >
                    DOM 拾取（需 allowScriptExecution）：准备后移动鼠标可<strong>实时</strong>预览（虚线框+半透明填充+右下角标签
                    「典型 class · 标签」），点击后<strong>实线</strong>确认；「拾取解析」仅拉 CDP 节点摘要。
                    DevTools→Elements 可搜 selectorHint；勿用主窗口 Ctrl+F。
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <button
                      type="button"
                      title="在此 page target 注入 pointer 监听"
                      disabled={domPickBusyHere}
                      onClick={() => void domPick.onArm(sessionIdForDomPick, n.targetId)}
                      style={{
                        fontSize: 11,
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: `1px solid ${OBS_PALETTE.borderActive}`,
                        background: domPickBusyHere ? "#f1f5f9" : "#f0fdf4",
                        color: "#166534",
                        cursor: domPickBusyHere ? "wait" : "pointer",
                      }}
                    >
                      {domPickBusyHere ? "处理中…" : "拾取准备"}
                    </button>
                    <button
                      type="button"
                      title="解析该 target 上最近一次点击坐标对应的 DOM 节点"
                      disabled={domPickBusyHere}
                      onClick={() => void domPick.onResolve(sessionIdForDomPick, n.targetId)}
                      style={{
                        fontSize: 11,
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: `1px solid ${OBS_PALETTE.borderActive}`,
                        background: domPickBusyHere ? "#f1f5f9" : "#faf5ff",
                        color: "#6b21a8",
                        cursor: domPickBusyHere ? "wait" : "pointer",
                      }}
                    >
                      拾取解析
                    </button>
                    <button
                      type="button"
                      title="卸掉拾取监听并清除页面描边、浮动标签（结束拾取模式）"
                      disabled={domPickBusyHere}
                      onClick={() => void domPick.onCancel(sessionIdForDomPick, n.targetId)}
                      style={{
                        fontSize: 11,
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: `1px solid ${OBS_PALETTE.border}`,
                        background: domPickBusyHere ? "#f1f5f9" : "#f8fafc",
                        color: "#475569",
                        cursor: domPickBusyHere ? "wait" : "pointer",
                      }}
                    >
                      结束拾取
                    </button>
                  </div>
                  {domPickHintHere ? (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 10,
                        color:
                          domPickHintHere.includes("拾取「") ||
                            domPickHintHere.includes("已准备拾取") ||
                            domPickHintHere.includes("已结束拾取")
                              ? "#15803d"
                              : "#b91c1c",
                        lineHeight: 1.35,
                        wordBreak: "break-word",
                      }}
                    >
                      {domPickHintHere}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            );
          })}
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
  domPick,
}: {
  kind: DetailKind | null;
  text: string | null;
  loading: boolean;
  /** 仅拓扑面板：用于按 target 拉取页面截图 */
  topologySnapshotCtx?: TopologySnapshotContext | null;
  /** 仅拓扑面板：窗口卡片内 DOM 拾取按钮 */
  domPick?: TopologyDomPickProps | null;
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
  if (kind === "list-window")
    return (
      <TopologyVisual
        raw={text}
        snapshotCtx={topologySnapshotCtx ?? undefined}
        domPick={domPick ?? undefined}
      />
    );
  if (kind === "metrics") return <MetricsVisual raw={text} />;
  if (kind === "snapshot") return <SnapshotVisual raw={text} />;
  if (kind === "native-a11y" || kind === "native-a11y-point") return <MacAxTreeVisual raw={text} />;
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
  useEffect(() => {
    let cancelled = false;
    void applyElectronShellBearerTokenPrefillIfEmpty(
      () => localStorage.getItem("od_token") ?? "",
      (t) => {
        if (!cancelled) setToken(t);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  /** 注册应用「选路径」：Electron 壳用「选择应用」文案；浏览器基座仍为 Core 触发的系统对话框说明 */
  const isElectronShellForRegister = useMemo(() => getElectronShell() != null, []);
  const registerExePickButtonLabel = isElectronShellForRegister ? "选择应用…" : "系统对话框…";
  const registerExeInputPlaceholder = isElectronShellForRegister
    ? "可粘贴完整路径，或点「选择应用…」选取（.lnk 会自动解析）"
    : "可粘贴完整路径，或点「系统对话框…」选择（.lnk 会自动解析）";
  const registerExePickButtonTitle = isElectronShellForRegister
    ? "在本机选择应用或可执行文件（Electron 壳内原生对话框，不经由 Core HTTP）"
    : "由本机 Core 弹出系统文件对话框以获取完整路径（Windows：PowerShell；macOS：osascript；请求会阻塞至选完或取消）。Windows 选 .lnk 后会自动解析；macOS 选 .app 时会解析为 Contents/MacOS 下主可执行文件";
  const [base, setBase] = useState(() => localStorage.getItem("od_base") ?? "");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [apps, setApps] = useState<OdApp[]>([]);
  const [appsErr, setAppsErr] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<OdProfile[]>([]);
  const [profilesErr, setProfilesErr] = useState<string | null>(null);
  const [selectedProfileByApp, setSelectedProfileByApp] = useState<Record<string, string>>({});
  const [appBusyId, setAppBusyId] = useState<string | null>(null);
  const [appActionMsg, setAppActionMsg] = useState<Record<string, string>>({});
  /** 注册应用弹层（POST /v1/apps） */
  const [registerAppOpen, setRegisterAppOpen] = useState(false);
  const [registerAppBusy, setRegisterAppBusy] = useState(false);
  const [registerAppErr, setRegisterAppErr] = useState<string | null>(null);
  const [registerAppPathHint, setRegisterAppPathHint] = useState<string | null>(null);
  const [regId, setRegId] = useState("");
  const [regName, setRegName] = useState("");
  const [regExe, setRegExe] = useState("");
  const [regCwd, setRegCwd] = useState("");
  const [regArgsJson, setRegArgsJson] = useState("[]");
  const [regInjectCdp, setRegInjectCdp] = useState(true);
  /** 无头启动（Core 追加 --headless=new） */
  const [regHeadless, setRegHeadless] = useState(false);
  const [regDedicatedProxy, setRegDedicatedProxy] = useState(false);
  const [regUiRuntime, setRegUiRuntime] = useState<"electron" | "qt">("electron");
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
  const [detailNativeA11y, setDetailNativeA11y] = useState<string | null>(null);
  const [detailNativeA11yPoint, setDetailNativeA11yPoint] = useState<string | null>(null);
  /** 来自 `GET /v1/version`（无需 Bearer），用于是否展示原生无障碍能力 */
  const [coreCapabilities, setCoreCapabilities] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState<DetailKind | null>(null);
  /** 为 true 时表示详情区正在展示「指针附近无障碍」，用于定时刷新且不随 JSON 内容变化而抖动 */
  const nativeA11yPointPanelOpen = useMemo(() => {
    if (!detailId) return false;
    if (detailLoading === "native-a11y-point") return true;
    return (
      detailNativeA11yPoint !== null &&
      !detailTopo &&
      !detailMetrics &&
      !detailSnap &&
      !detailNativeA11y &&
      detailLoading === null
    );
  }, [
    detailId,
    detailLoading,
    detailNativeA11yPoint,
    detailTopo,
    detailMetrics,
    detailSnap,
    detailNativeA11y,
  ]);
  const [cdpCopiedId, setCdpCopiedId] = useState<string | null>(null);
  /** 会话 ID → 注入用户脚本中 */
  const [userScriptInjectBusy, setUserScriptInjectBusy] = useState<string | null>(null);
  /** 会话 ID → 注入结果摘要或错误文案 */
  const [userScriptInjectHint, setUserScriptInjectHint] = useState<Record<string, string>>({});
  /** `sessionId::targetId` → DOM 拾取 arm/resolve 进行中 */
  const [domPickBusy, setDomPickBusy] = useState<string | null>(null);
  /** `sessionId::targetId` → 拾取结果或错误 */
  const [domPickHint, setDomPickHint] = useState<Record<string, string>>({});
  /** Electron 壳：全屏十字线 + 与 at-point 同源的屏幕坐标（仅 Qt + 指针面板） */
  const [qtAxShellCaptureOn, setQtAxShellCaptureOn] = useState(false);
  const qtAxShellCaptureOnRef = useRef(false);
  const qtAxCursorRef = useRef<{ x: number; y: number } | null>(null);
  const qtAxCursorUnsubRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    qtAxShellCaptureOnRef.current = qtAxShellCaptureOn;
  }, [qtAxShellCaptureOn]);

  const detailSession = useMemo(
    () => (detailId ? sessions.find((s) => s.id === detailId) : undefined),
    [sessions, detailId],
  );

  const apiRoot = resolveApiRoot(base);
  const sessionsUrl = apiRoot ? `${apiRoot}/v1/sessions` : "/v1/sessions";
  const appsUrl = apiRoot ? `${apiRoot}/v1/apps` : "/v1/apps";
  const profilesUrl = apiRoot ? `${apiRoot}/v1/profiles` : "/v1/profiles";
  const tokenTrimmed = token.trim();

  const headers = {
    Authorization: `Bearer ${tokenTrimmed}`,
    "Content-Type": "application/json",
  };

  useEffect(() => {
    const versionPath = apiRoot ? `${apiRoot}/v1/version` : "/v1/version";
    let cancelled = false;
    void fetch(versionPath)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { capabilities?: string[] } | null) => {
        if (cancelled || !b?.capabilities || !Array.isArray(b.capabilities)) return;
        setCoreCapabilities(b.capabilities);
      })
      .catch(() => {
        if (!cancelled) setCoreCapabilities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiRoot]);

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
        setProfilesErr(`启动配置列表 ${res.status}: ${raw.slice(0, 200)}`);
        setProfiles([]);
        return;
      }
      if (!raw.trimStart().startsWith("{")) {
        setProfilesErr("启动配置列表返回非 JSON");
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

  function closeRegisterAppModal() {
    setRegisterAppOpen(false);
    setRegisterAppErr(null);
    setRegisterAppPathHint(null);
  }

  function openRegisterAppModal() {
    setRegisterAppErr(null);
    setRegisterAppPathHint(null);
    setRegId("");
    setRegName("");
    setRegExe("");
    setRegCwd("");
    setRegArgsJson("[]");
    setRegInjectCdp(true);
    setRegHeadless(false);
    setRegDedicatedProxy(false);
    setRegUiRuntime("electron");
    setRegisterAppOpen(true);
  }

  const regenerateAppIdFromExe = useCallback(() => {
    const p = regExe.trim();
    if (!p) {
      setRegisterAppErr("请先填写或选择可执行文件路径");
      return;
    }
    setRegisterAppErr(null);
    setRegId(suggestedAppIdFromExecutablePath(p));
  }, [regExe]);

  async function resolveRegisterShortcutForPath(
    lnkPath: string,
    options?: { manageBusy?: boolean },
  ) {
    const manageBusy = options?.manageBusy !== false;
    const p = lnkPath.trim();
    if (!p.toLowerCase().endsWith(".lnk")) return;
    if (!tokenTrimmed) {
      setRegisterAppErr("请先填写 Bearer token");
      setRegisterAppPathHint(LNK_RESOLVE_FAIL_HINT);
      return;
    }
    if (manageBusy) setRegisterAppBusy(true);
    setRegisterAppErr(null);
    setRegisterAppPathHint(null);
    try {
      const res = await fetch(apiUrl("/v1/resolve-windows-shortcut"), {
        method: "POST",
        headers,
        body: JSON.stringify({ path: p }),
      });
      const raw = await res.text();
      let parsed: {
        targetPath?: string;
        arguments?: string;
        workingDirectory?: string;
        error?: { code?: string; message?: string };
      };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        const msg = parsed.error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const tp = parsed.targetPath?.trim();
      if (!tp) throw new Error("响应缺少 targetPath");
      setRegExe(tp);
      setRegId(suggestedAppIdFromExecutablePath(tp));
      setRegCwd((c) => (c.trim() ? c : (parsed.workingDirectory?.trim() ?? "")));
      if (parsed.arguments?.trim()) {
        setRegisterAppPathHint(
          `快捷方式含命令行参数（请按需自行填入「启动参数」JSON）：${parsed.arguments.trim()}`,
        );
      } else {
        setRegisterAppPathHint(null);
      }
    } catch (e) {
      setRegisterAppErr(e instanceof Error ? e.message : String(e));
      setRegisterAppPathHint(LNK_RESOLVE_FAIL_HINT);
    } finally {
      if (manageBusy) setRegisterAppBusy(false);
    }
  }

  async function pickExecutableViaSystemDialog() {
    if (!tokenTrimmed) {
      setRegisterAppErr("请先填写 Bearer token");
      return;
    }
    setRegisterAppBusy(true);
    setRegisterAppErr(null);
    setRegisterAppPathHint(null);
    try {
      const shell = getElectronShell();
      if (shell) {
        const picked = await shell.pickExecutableFile();
        if (picked == null || picked.trim() === "") {
          return;
        }
        const originalPicked = picked.trim();
        const normRes = await fetch(apiUrl("/v1/resolve-executable-path"), {
          method: "POST",
          headers,
          body: JSON.stringify({ path: originalPicked }),
        });
        const normRaw = await normRes.text();
        let normParsed: { executable?: string; error?: { message?: string; code?: string } };
        try {
          normParsed = JSON.parse(normRaw) as typeof normParsed;
        } catch {
          throw new Error(normRaw.slice(0, 200));
        }
        if (!normRes.ok) {
          const msg = normParsed.error?.message ?? `HTTP ${normRes.status}`;
          throw new Error(msg);
        }
        const p = normParsed.executable?.trim();
        if (!p) throw new Error("响应缺少 executable");
        setRegExe(p);
        setRegId(suggestedAppIdFromExecutablePath(p));
        if (originalPicked.toLowerCase().endsWith(".lnk")) {
          await resolveRegisterShortcutForPath(originalPicked, { manageBusy: false });
        }
        return;
      }

      const res = await fetch(apiUrl("/v1/pick-executable-path"), {
        method: "POST",
        headers,
      });
      const raw = await res.text();
      let parsed: {
        path?: string;
        cancelled?: boolean;
        error?: { code?: string; message?: string };
      };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        const msg = parsed.error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      if (parsed.cancelled === true) {
        return;
      }
      const p = parsed.path?.trim();
      if (!p) throw new Error("响应缺少 path");
      setRegExe(p);
      setRegId(suggestedAppIdFromExecutablePath(p));
      if (p.toLowerCase().endsWith(".lnk")) {
        await resolveRegisterShortcutForPath(p, { manageBusy: false });
      }
    } catch (e) {
      setRegisterAppErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRegisterAppBusy(false);
    }
  }

  async function submitRegisterApp() {
    if (!tokenTrimmed) {
      setRegisterAppErr("请先填写 Bearer token");
      return;
    }
    const id = regId.trim();
    const exe = regExe.trim();
    if (!id || !exe) {
      setRegisterAppErr("应用 ID 与可执行文件路径为必填");
      return;
    }
    let args: string[];
    try {
      const parsed = JSON.parse(regArgsJson) as unknown;
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
        throw new Error("须为 JSON 字符串数组，例如 [] 或 [\"--flag\",\"value\"]");
      }
      args = parsed;
    } catch (e) {
      setRegisterAppErr(e instanceof Error ? e.message : String(e));
      return;
    }
    setRegisterAppBusy(true);
    setRegisterAppErr(null);
    try {
      const listRes = await fetch(appsUrl, { method: "GET", headers });
      const listRaw = await listRes.text();
      if (!listRes.ok) {
        throw new Error(
          `无法校验调用名是否唯一：GET /v1/apps ${listRes.status} ${listRaw.slice(0, 160)}`,
        );
      }
      if (!listRaw.trimStart().startsWith("{")) {
        throw new Error("无法校验调用名：应用列表返回非 JSON");
      }
      const existing = parseAppIdsFromListJson(listRaw);
      if (appIdExists(existing, id)) {
        throw new Error(
          `应用 id「${id}」已注册。请换一个调用名（须与 yarn oc <appId> 子命令中的名称一致且全局唯一）。`,
        );
      }

      const body: Record<string, unknown> = {
        id,
        name: regName.trim() || id,
        executable: exe,
        args,
        env: {},
        uiRuntime: regUiRuntime,
        injectElectronDebugPort: regInjectCdp,
        headless: regHeadless,
        useDedicatedProxy: regDedicatedProxy,
      };
      if (regCwd.trim()) body.cwd = regCwd.trim();
      const res = await fetch(appsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(raw) as { error?: { message?: string; code?: string } };
          if (j.error?.message) {
            msg = j.error.code ? `${j.error.code}: ${j.error.message}` : j.error.message;
          }
        } catch {
          msg = raw.slice(0, 200);
        }
        throw new Error(msg);
      }

      const defaultProfileId = `${id}-default`;
      const profRes = await fetch(profilesUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: defaultProfileId,
          appId: id,
          name: regName.trim() || defaultProfileId,
          env: {},
          extraArgs: [],
        }),
      });
      const profRaw = await profRes.text();
      if (profRes.status !== 409 && !profRes.ok) {
        let pmsg = `HTTP ${profRes.status}`;
        try {
          const j = JSON.parse(profRaw) as { error?: { message?: string; code?: string } };
          if (j.error?.message) {
            pmsg = j.error.code ? `${j.error.code}: ${j.error.message}` : j.error.message;
          }
        } catch {
          pmsg = profRaw.slice(0, 200);
        }
        setErr(
          `应用「${id}」已注册，但默认启动配置（id ${defaultProfileId}）创建失败：${pmsg}。请在本机用 POST /v1/profiles 补建，或删除应用后改用 yarn oc app create。`,
        );
        void refreshCoreData();
        closeRegisterAppModal();
        return;
      }

      void refreshCoreData();
      closeRegisterAppModal();
    } catch (e) {
      setRegisterAppErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRegisterAppBusy(false);
    }
  }

  /** 应用启动相关开关（CDP / 无头 / 专用代理），与注册表单一致 */
  async function patchAppSetting(
    appId: string,
    patch: Partial<Pick<OdApp, "injectElectronDebugPort" | "headless" | "useDedicatedProxy">>,
  ) {
    if (!tokenTrimmed) return;
    if (Object.keys(patch).length === 0) return;
    setAppBusyId(appId);
    setAppActionMsg((m) => ({ ...m, [appId]: "" }));
    try {
      const res = await fetch(apiUrl(`/v1/apps/${encodeURIComponent(appId)}`), {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      });
      const raw = await res.text();
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(raw) as { error?: { message?: string } };
          msg = j.error?.message ?? msg;
        } catch {
          msg = raw.slice(0, 160);
        }
        throw new Error(msg);
      }
      void refreshCoreData();
    } catch (e) {
      setAppActionMsg((m) => ({
        ...m,
        [appId]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setAppBusyId(null);
    }
  }

  async function removeRegisteredApp(appId: string) {
    if (!tokenTrimmed) {
      setAppActionMsg((m) => ({ ...m, [appId]: "请先填写 Bearer token" }));
      return;
    }
    if (
      !window.confirm(
        `确定删除应用「${appId}」？将停止相关运行中会话，并删除其启动配置与用户脚本记录（不可恢复）。`,
      )
    ) {
      return;
    }
    setAppBusyId(appId);
    setAppActionMsg((m) => ({ ...m, [appId]: "" }));
    try {
      const res = await fetch(apiUrl(`/v1/apps/${encodeURIComponent(appId)}`), {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const raw = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(raw) as { error?: { message?: string } };
          msg = j.error?.message ?? msg;
        } catch {
          msg = raw.slice(0, 200);
        }
        throw new Error(msg);
      }
      void refreshCoreData();
    } catch (e) {
      setAppActionMsg((m) => ({
        ...m,
        [appId]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setAppBusyId(null);
    }
  }

  async function copyCdpGatewayForSession(sessionId: string) {
    const url = cdpGatewayHttpUrl(apiRoot ?? "", sessionId);
    await copyToClipboard(url);
    setCdpCopiedId(sessionId);
    window.setTimeout(() => {
      setCdpCopiedId((cur) => (cur === sessionId ? null : cur));
    }, 2000);
  }

  async function injectUserScriptsForSession(sessionId: string) {
    if (!tokenTrimmed) {
      setUserScriptInjectHint((h) => ({ ...h, [sessionId]: "请先填写 Token" }));
      return;
    }
    setUserScriptInjectBusy(sessionId);
    setUserScriptInjectHint((h) => ({ ...h, [sessionId]: "" }));
    try {
      const res = await fetch(
        apiUrl(`/v1/sessions/${encodeURIComponent(sessionId)}/user-scripts/inject`),
        { method: "POST", headers },
      );
      const raw = await res.text();
      let parsed: {
        injectedScripts?: number;
        targets?: number;
        errors?: unknown[];
        error?: { code?: string; message?: string };
      };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        const msg =
          parsed.error?.message ?? parsed.error?.code ?? `HTTP ${res.status}: ${raw.slice(0, 200)}`;
        throw new Error(msg);
      }
      const inj = parsed.injectedScripts ?? 0;
      const tg = parsed.targets ?? 0;
      const errN = Array.isArray(parsed.errors) ? parsed.errors.length : 0;
      setUserScriptInjectHint((h) => ({
        ...h,
        [sessionId]:
          errN > 0
            ? `已执行 ${inj} 次 / ${tg} 个 page target，${errN} 条错误（详情见 API 响应）`
            : `已注入 ${inj} 次 / ${tg} 个 page target（@match 不参与；多 frame 可能重复）`,
      }));
    } catch (e) {
      setUserScriptInjectHint((h) => ({
        ...h,
        [sessionId]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setUserScriptInjectBusy(null);
    }
  }

  async function domPickArmForTarget(sessionId: string, targetId: string) {
    const key = domPickStateKey(sessionId, targetId);
    if (!tokenTrimmed) {
      setDomPickHint((h) => ({ ...h, [key]: "请先填写 Token" }));
      return;
    }
    setDomPickBusy(key);
    setDomPickHint((h) => ({ ...h, [key]: "" }));
    try {
      const res = await fetch(
        apiUrl(
          `/v1/sessions/${encodeURIComponent(sessionId)}/targets/${encodeURIComponent(targetId)}/dom-pick/arm`,
        ),
        { method: "POST", headers },
      );
      const raw = await res.text();
      let parsed: { armed?: boolean; error?: { message?: string; code?: string } };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        const msg =
          parsed.error?.message ?? parsed.error?.code ?? `HTTP ${res.status}: ${raw.slice(0, 200)}`;
        throw new Error(msg);
      }
      setDomPickHint((h) => ({
        ...h,
        [key]: `已准备拾取 → 请在此 target 对应窗口内点击页面 → 再点「拾取解析」`,
      }));
    } catch (e) {
      setDomPickHint((h) => ({
        ...h,
        [key]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setDomPickBusy(null);
    }
  }

  async function domPickResolveForTarget(sessionId: string, targetId: string) {
    const key = domPickStateKey(sessionId, targetId);
    if (!tokenTrimmed) {
      setDomPickHint((h) => ({ ...h, [key]: "请先填写 Token" }));
      return;
    }
    setDomPickBusy(key);
    setDomPickHint((h) => ({ ...h, [key]: "" }));
    try {
      const res = await fetch(
        apiUrl(
          `/v1/sessions/${encodeURIComponent(sessionId)}/targets/${encodeURIComponent(targetId)}/dom-pick/resolve`,
        ),
        { method: "POST", headers },
      );
      const raw = await res.text();
      let parsed: {
        pick?: { x: number; y: number; ts: number };
        node?: {
          nodeName?: string;
          localName?: string;
          attributes?: Record<string, string>;
          selectorHint?: string;
        };
        highlightApplied?: boolean;
        highlightMethod?: string;
        highlightOverlayError?: string;
        highlightPersistNote?: string;
        error?: { message?: string; code?: string };
      };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        const msg =
          parsed.error?.message ?? parsed.error?.code ?? `HTTP ${res.status}: ${raw.slice(0, 200)}`;
        throw new Error(msg);
      }
      const name = parsed.node?.localName ?? parsed.node?.nodeName ?? "?";
      const attrs = parsed.node?.attributes;
      const attrPreview =
        attrs && Object.keys(attrs).length > 0
          ? ` ${Object.entries(attrs)
              .slice(0, 4)
              .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
              .join(" ")}`
          : "";
      const xy = parsed.pick ? ` (${Math.round(parsed.pick.x)}, ${Math.round(parsed.pick.y)})` : "";
      const method =
        parsed.highlightMethod === "cdp-overlay"
          ? "CDP Overlay（断连后即消失）"
          : parsed.highlightMethod === "page-inject"
            ? "页面注入描边（持久）"
            : "";
      const hl =
        parsed.highlightApplied === true
          ? ` · 已高亮（${method || "未知方式"}）`
          : parsed.highlightApplied === false
            ? " · 未持久高亮（拾取数据仍有效；若曾显示 CDP Overlay，断连后会消失）"
            : "";
      const note =
        parsed.highlightPersistNote && parsed.highlightPersistNote.length > 0
          ? ` · ${parsed.highlightPersistNote.slice(0, 220)}${parsed.highlightPersistNote.length > 220 ? "…" : ""}`
          : "";
      const dbg =
        parsed.highlightOverlayError && parsed.highlightMethod === "page-inject" && parsed.highlightApplied
          ? ` · Overlay 诊断: ${parsed.highlightOverlayError.slice(0, 200)}${parsed.highlightOverlayError.length > 200 ? "…" : ""}`
          : parsed.highlightOverlayError && !parsed.highlightApplied
            ? ` · 高亮: ${parsed.highlightOverlayError.slice(0, 280)}${parsed.highlightOverlayError.length > 280 ? "…" : ""}`
            : "";
      const sel = parsed.node?.selectorHint?.trim();
      const devtools =
        sel && sel.length > 0
          ? ` · DevTools：在被测窗口打开开发者工具（或经 remote-debugging 附加）→ Elements → 点搜索图标或 Ctrl/Cmd+F，在「按选择器查找」中粘贴试：${sel}（页面主窗口 Ctrl+F 搜的是正文，不是标签）`
          : "";
      setDomPickHint((h) => ({
        ...h,
        [key]: `拾取「${name}」${xy}${attrPreview ? ` · ${attrPreview.slice(0, 120)}` : ""}${hl}${note}${dbg}${devtools}`,
      }));
    } catch (e) {
      setDomPickHint((h) => ({
        ...h,
        [key]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setDomPickBusy(null);
    }
  }

  async function domPickCancelForTarget(sessionId: string, targetId: string) {
    const key = domPickStateKey(sessionId, targetId);
    if (!tokenTrimmed) {
      setDomPickHint((h) => ({ ...h, [key]: "请先填写 Token" }));
      return;
    }
    setDomPickBusy(key);
    setDomPickHint((h) => ({ ...h, [key]: "" }));
    try {
      const res = await fetch(
        apiUrl(
          `/v1/sessions/${encodeURIComponent(sessionId)}/targets/${encodeURIComponent(targetId)}/dom-pick/cancel`,
        ),
        { method: "POST", headers },
      );
      const raw = await res.text();
      let parsed: { cleared?: boolean; error?: { message?: string; code?: string } };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        const msg =
          parsed.error?.message ?? parsed.error?.code ?? `HTTP ${res.status}: ${raw.slice(0, 200)}`;
        throw new Error(msg);
      }
      setDomPickHint((h) => ({
        ...h,
        [key]: "已结束拾取，页面监听与标注已清除",
      }));
    } catch (e) {
      setDomPickHint((h) => ({
        ...h,
        [key]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setDomPickBusy(null);
    }
  }

  async function startSessionForApp(appId: string) {
    const profs = profiles.filter((p) => p.appId === appId);
    if (profs.length === 0) {
      setAppActionMsg((m) => ({
        ...m,
        [appId]: `无可用启动配置：若仅用旧版 Web 注册过应用，请补建配置（POST /v1/profiles，例如 id 为 ${appId}-default）；或使用 yarn oc app create 重新注册。`,
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

  const enableQtAxShellCapture = useCallback(async () => {
    const sh = getElectronShell();
    if (!sh?.startQtAxOverlay || !sh.subscribeQtAxCursor) {
      setErr("需要 Electron 壳且 preload 包含 startQtAxOverlay / subscribeQtAxCursor。");
      return;
    }
    if (!isLikelyDarwinPlatform()) {
      setErr("屏幕十字线覆盖层仅支持 macOS。");
      return;
    }
    setErr(null);
    try {
      const res = (await sh.startQtAxOverlay()) as { ok?: boolean; error?: string };
      if (!res?.ok) {
        throw new Error(res?.error ?? "启动失败");
      }
      qtAxCursorUnsubRef.current?.();
      qtAxCursorUnsubRef.current = sh.subscribeQtAxCursor((p) => {
        qtAxCursorRef.current = p;
      });
      setQtAxShellCaptureOn(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const disableQtAxShellCapture = useCallback(() => {
    qtAxCursorUnsubRef.current?.();
    qtAxCursorUnsubRef.current = null;
    qtAxCursorRef.current = null;
    void getElectronShell()?.setQtAxHitHighlight?.(null);
    void getElectronShell()?.stopQtAxOverlay?.();
    setQtAxShellCaptureOn(false);
  }, []);

  async function loadDetail(sessionId: string, kind: DetailKind, options?: { silent?: boolean }) {
    const silent = Boolean(options?.silent && kind === "native-a11y-point");
    if (!tokenTrimmed) {
      const msg =
        "未填写 token：请先粘贴 Bearer。缺 token 时 Core 会返回 401，而不是你看到的 404。";
      if (!silent) {
        if (kind === "list-window") setDetailTopo(msg);
        if (kind === "metrics") setDetailMetrics(msg);
        if (kind === "snapshot") setDetailSnap(msg);
        if (kind === "native-a11y") setDetailNativeA11y(msg);
        if (kind === "native-a11y-point") setDetailNativeA11yPoint(msg);
      }
      return;
    }
    const path =
      kind === "list-window"
        ? `/v1/sessions/${sessionId}/list-window`
        : kind === "metrics"
          ? `/v1/sessions/${sessionId}/metrics`
          : kind === "native-a11y"
            ? `/v1/sessions/${sessionId}/native-accessibility-tree?maxDepth=12&maxNodes=5000`
            : kind === "native-a11y-point"
              ? buildNativeAccessibilityAtPointPath(
                  sessionId,
                  qtAxShellCaptureOnRef.current && qtAxCursorRef.current
                    ? { x: qtAxCursorRef.current.x, y: qtAxCursorRef.current.y }
                    : undefined,
                )
              : `/v1/agent/sessions/${sessionId}/snapshot`;
    if (!silent) {
      setDetailTopo(null);
      setDetailMetrics(null);
      setDetailSnap(null);
      setDetailNativeA11y(null);
      setDetailNativeA11yPoint(null);
      setDetailLoading(kind);
    }
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
      if (kind === "native-a11y") setDetailNativeA11y(pretty);
      if (kind === "native-a11y-point") {
        setDetailNativeA11yPoint(pretty);
        const sh = getElectronShell();
        if (qtAxShellCaptureOnRef.current && sh?.setQtAxHitHighlight) {
          const raw = json as Record<string, unknown>;
          const hf = raw.hitFrame;
          if (
            hf &&
            typeof hf === "object" &&
            typeof (hf as { x?: unknown }).x === "number" &&
            typeof (hf as { y?: unknown }).y === "number" &&
            typeof (hf as { width?: unknown }).width === "number" &&
            typeof (hf as { height?: unknown }).height === "number"
          ) {
            void sh.setQtAxHitHighlight({
              x: (hf as { x: number }).x,
              y: (hf as { y: number }).y,
              width: (hf as { width: number }).width,
              height: (hf as { height: number }).height,
            });
          } else {
            void sh.setQtAxHitHighlight(null);
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (kind === "list-window") setDetailTopo(msg);
      if (kind === "metrics") setDetailMetrics(msg);
      if (kind === "snapshot") setDetailSnap(msg);
      if (kind === "native-a11y") setDetailNativeA11y(msg);
      if (kind === "native-a11y-point") {
        setDetailNativeA11yPoint(msg);
        const sh = getElectronShell();
        if (qtAxShellCaptureOnRef.current && sh?.setQtAxHitHighlight) {
          void sh.setQtAxHitHighlight(null);
        }
      }
    } finally {
      if (!silent) setDetailLoading(null);
    }
  }

  const loadDetailRef = useRef(loadDetail);
  loadDetailRef.current = loadDetail;
  const detailIdPollRef = useRef<string | null>(null);
  detailIdPollRef.current = detailId;

  useEffect(() => {
    if (!tokenTrimmed || !nativeA11yPointPanelOpen || !detailId) return;
    if (qtAxShellCaptureOn) return;
    const sid = detailId;
    const id = window.setInterval(() => {
      if (detailIdPollRef.current !== sid) return;
      void loadDetailRef.current(sid, "native-a11y-point", { silent: true });
    }, NATIVE_A11Y_POINT_POLL_MS);
    return () => window.clearInterval(id);
  }, [tokenTrimmed, nativeA11yPointPanelOpen, detailId, qtAxShellCaptureOn]);

  useEffect(() => {
    if (!tokenTrimmed || !nativeA11yPointPanelOpen || !detailId || !qtAxShellCaptureOn) return;
    const sid = detailId;
    const id = window.setInterval(() => {
      if (detailIdPollRef.current !== sid) return;
      void loadDetailRef.current(sid, "native-a11y-point", { silent: true });
    }, QT_AX_SHELL_CURSOR_POLL_MS);
    return () => window.clearInterval(id);
  }, [tokenTrimmed, nativeA11yPointPanelOpen, detailId, qtAxShellCaptureOn]);

  useEffect(() => {
    disableQtAxShellCapture();
  }, [detailId, disableQtAxShellCapture]);

  useEffect(() => {
    if (!nativeA11yPointPanelOpen) {
      disableQtAxShellCapture();
    }
  }, [nativeA11yPointPanelOpen, disableQtAxShellCapture]);

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
              flexWrap: "wrap",
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
            <span
              style={{
                fontSize: 12,
                color: OBS_PALETTE.textMuted,
                fontWeight: 400,
                flex: "1 1 200px",
                minWidth: 0,
                lineHeight: 1.45,
              }}
            >
              Web「注册应用」会创建应用与默认启动配置；CLI 可用{" "}
              <code style={{ fontSize: 11 }}>yarn oc app create</code>。
            </span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", flexShrink: 0 }}>
              <button
                type="button"
                disabled={!tokenTrimmed}
                title={
                  !tokenTrimmed
                    ? "请先填写 Bearer token"
                    : "依次 POST 应用与默认启动配置，与 yarn oc app create 行为一致"
                }
                onClick={() => openRegisterAppModal()}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: `1px solid ${OBS_PALETTE.borderActive}`,
                  background: !tokenTrimmed ? "#f1f5f9" : "#eff6ff",
                  color: !tokenTrimmed ? OBS_PALETTE.textMuted : "#1d4ed8",
                  cursor: !tokenTrimmed ? "not-allowed" : "pointer",
                }}
              >
                注册应用
              </button>
            </div>
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
                {profilesErr}（启动与脚本等依赖上述配置数据；可检查 Core 与 token）
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
                    minWidth: 680,
                    borderCollapse: "collapse",
                    background: "#fff",
                    tableLayout: "fixed",
                  }}
                >
                  <colgroup>
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "64px" }} />
                    <col style={{ width: "24%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "auto", minWidth: 200 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {["ID", "名称", "UI", "可执行与工作目录", "启动配置", "启动参数", "操作"].map((h) => (
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
                          暂无已注册应用。可点击上方「注册应用」，或使用 CLI，例如{" "}
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
                              style={{
                                padding: "10px 12px",
                                borderBottom: `1px solid #f1f5f9`,
                                verticalAlign: "middle",
                              }}
                            >
                              <Badge tone={a.uiRuntime === "qt" ? "amber" : "blue"}>
                                {a.uiRuntime === "qt" ? "Qt" : "Electron"}
                              </Badge>
                            </td>
                            <td
                              style={{
                                padding: "8px 10px",
                                borderBottom: `1px solid #f1f5f9`,
                                verticalAlign: "top",
                              }}
                            >
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "100%" }}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    minWidth: 0,
                                  }}
                                >
                                  <span
                                    style={{
                                      flexShrink: 0,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      color: OBS_PALETTE.textMuted,
                                      width: 28,
                                    }}
                                  >
                                    exe
                                  </span>
                                  <span
                                    title={a.executable}
                                    style={{
                                      flex: "1 1 0",
                                      minWidth: 0,
                                      fontSize: 11,
                                      color: "#334155",
                                      fontFamily: "ui-monospace, monospace",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {a.executable}
                                  </span>
                                  <button
                                    type="button"
                                    title="复制可执行文件完整路径"
                                    onClick={() => void copyToClipboard(a.executable)}
                                    style={{
                                      flexShrink: 0,
                                      padding: "2px 6px",
                                      fontSize: 10,
                                      borderRadius: 4,
                                      border: `1px solid ${OBS_PALETTE.border}`,
                                      background: "#fff",
                                      color: "#475569",
                                      cursor: "pointer",
                                    }}
                                  >
                                    复制
                                  </button>
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    minWidth: 0,
                                  }}
                                >
                                  <span
                                    style={{
                                      flexShrink: 0,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      color: OBS_PALETTE.textMuted,
                                      width: 28,
                                    }}
                                  >
                                    cwd
                                  </span>
                                  <span
                                    title={a.cwd}
                                    style={{
                                      flex: "1 1 0",
                                      minWidth: 0,
                                      fontSize: 11,
                                      color: "#64748b",
                                      fontFamily: "ui-monospace, monospace",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {a.cwd}
                                  </span>
                                  <button
                                    type="button"
                                    title="复制工作目录完整路径"
                                    onClick={() => void copyToClipboard(a.cwd)}
                                    style={{
                                      flexShrink: 0,
                                      padding: "2px 6px",
                                      fontSize: 10,
                                      borderRadius: 4,
                                      border: `1px solid ${OBS_PALETTE.border}`,
                                      background: "#fff",
                                      color: "#475569",
                                      cursor: "pointer",
                                    }}
                                  >
                                    复制
                                  </button>
                                </div>
                              </div>
                            </td>
                            <td
                              style={{
                                padding: "10px 12px",
                                borderBottom: `1px solid #f1f5f9`,
                                verticalAlign: "top",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 8,
                                  alignItems: "flex-start",
                                }}
                              >
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    cursor: busy ? "not-allowed" : "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={a.injectElectronDebugPort}
                                    disabled={busy}
                                    onChange={(e) =>
                                      void patchAppSetting(a.id, {
                                        injectElectronDebugPort: e.target.checked,
                                      })
                                    }
                                  />
                                  <span style={{ fontSize: 11, color: "#475569" }}>CDP 注入</span>
                                </label>
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    cursor: busy ? "not-allowed" : "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={a.headless === true}
                                    disabled={busy}
                                    onChange={(e) =>
                                      void patchAppSetting(a.id, { headless: e.target.checked })
                                    }
                                  />
                                  <span style={{ fontSize: 11, color: "#475569" }}>无头模式</span>
                                </label>
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    cursor: busy ? "not-allowed" : "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={a.useDedicatedProxy === true}
                                    disabled={busy}
                                    onChange={(e) =>
                                      void patchAppSetting(a.id, {
                                        useDedicatedProxy: e.target.checked,
                                      })
                                    }
                                  />
                                  <span style={{ fontSize: 11, color: "#475569" }}>专用代理</span>
                                </label>
                              </div>
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
                                  启动配置（多选一时）
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
                                      ? "需先有该应用的启动配置（注册应用时会自动创建默认配置）"
                                      : "POST /v1/sessions，每次新建一条会话；CLI 为 yarn oc session start"
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
                                  aria-label={activeForApp.length === 0 ? "停止会话" : "停止该应用下活跃会话"}
                                  title={
                                    activeForApp.length === 0
                                      ? "该应用下无运行中或启动中的会话"
                                      : "对该应用下各活跃会话依次 POST /v1/sessions/:id/stop"
                                  }
                                  onClick={() => void stopSessionsForApp(a.id)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
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
                                    <IconSessionStop
                                      color={activeForApp.length === 0 ? OBS_PALETTE.textMuted : "#b91c1c"}
                                    />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || !tokenTrimmed}
                                  title="按应用保存 UserScript；@match 不参与注入决策。运行中会话请在列表「注入用户脚本」显式注入"
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
                                <button
                                  type="button"
                                  disabled={busy || !tokenTrimmed}
                                  title="DELETE /v1/apps/:id，移除应用及其启动配置与用户脚本；会先停止相关运行中会话"
                                  onClick={() => void removeRegisteredApp(a.id)}
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
                                    border: `1px solid #fecaca`,
                                    background: busy || !tokenTrimmed ? "#f1f5f9" : "#fef2f2",
                                    color: busy || !tokenTrimmed ? OBS_PALETTE.textMuted : "#b91c1c",
                                  }}
                                >
                                  移除
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
                  title="创建会话时选用的启动配置 id；与 POST /v1/sessions 中 profileId 一致"
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
                  启动配置
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
                  <SessionStateTag state={s.state} error={s.error} />
                  {(s.state || "").toLowerCase() === "failed" && s.error ? (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        lineHeight: 1.45,
                        color: "#991b1b",
                        wordBreak: "break-word",
                        fontFamily: "ui-monospace, monospace",
                      }}
                      title={s.error}
                    >
                      {s.error.length > 280 ? `${s.error.slice(0, 280)}…` : s.error}
                    </div>
                  ) : null}
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
                  {(s.state || "").toLowerCase() === "running" && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        title="将该会话对应应用下的用户脚本正文注入当前 CDP 全部 page target（需 allowScriptExecution）"
                        disabled={userScriptInjectBusy === s.id}
                        onClick={() => void injectUserScriptsForSession(s.id)}
                        style={{
                          fontSize: 11,
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: `1px solid ${OBS_PALETTE.borderActive}`,
                          background: userScriptInjectBusy === s.id ? "#f1f5f9" : "#fff7ed",
                          color: "#9a3412",
                          cursor: userScriptInjectBusy === s.id ? "wait" : "pointer",
                          maxWidth: "100%",
                        }}
                      >
                        {userScriptInjectBusy === s.id ? "注入中…" : "注入用户脚本"}
                      </button>
                      {userScriptInjectHint[s.id] ? (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 10,
                            color: userScriptInjectHint[s.id].includes("已注入") || userScriptInjectHint[s.id].includes("已执行")
                              ? "#15803d"
                              : "#b91c1c",
                            lineHeight: 1.35,
                            wordBreak: "break-word",
                          }}
                        >
                          {userScriptInjectHint[s.id]}
                        </div>
                      ) : null}
                    </div>
                  )}
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
                    sessionUiRuntime={s.uiRuntime ?? "electron"}
                    loadingKind={detailLoading}
                    detailId={detailId}
                    detailTopo={detailTopo}
                    detailMetrics={detailMetrics}
                    detailSnap={detailSnap}
                    detailNativeA11y={detailNativeA11y}
                    detailNativeA11yPoint={detailNativeA11yPoint}
                    nativeA11yDisabledReason={nativeAccessibilityTreeDisabledReason(coreCapabilities, {
                      state: s.state,
                      pid: s.pid,
                    })}
                    nativeA11yPointDisabledReason={nativeAccessibilityAtPointDisabledReason(coreCapabilities, {
                      state: s.state,
                      pid: s.pid,
                    })}
                    onAction={(id, kind) => void loadDetail(id, kind)}
                  />
                </td>
              </tr>
              {detailId === s.id &&
                (detailLoading ||
                  detailTopo ||
                  detailMetrics ||
                  detailSnap ||
                  detailNativeA11y ||
                  detailNativeA11yPoint) && (
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
                              : detailNativeA11y
                                ? "native-a11y"
                                : detailNativeA11yPoint
                                  ? "native-a11y-point"
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
                        {panelKind === "native-a11y-point" && !detailLoading ? (
                          <span
                            style={{
                              fontWeight: 400,
                              color: OBS_PALETTE.textMuted,
                              fontSize: 12,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 10,
                              flexWrap: "wrap",
                            }}
                          >
                            {detailSession?.uiRuntime === "qt" &&
                            nativeAccessibilityAtPointDisabledReason(coreCapabilities, {
                              state: detailSession.state,
                              pid: detailSession.pid,
                            }) === null ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    qtAxShellCaptureOn
                                      ? disableQtAxShellCapture()
                                      : void enableQtAxShellCapture()
                                  }
                                  disabled={
                                    !getElectronShell()?.startQtAxOverlay ||
                                    !isLikelyDarwinPlatform()
                                  }
                                  title={
                                    !isLikelyDarwinPlatform()
                                      ? "仅 macOS"
                                      : !getElectronShell()?.startQtAxOverlay
                                        ? "需使用 Electron 壳"
                                        : qtAxShellCaptureOn
                                          ? "关闭全屏透明十字线并恢复 nut-js 轮询"
                                          : "主屏透明层 + 与 at-point 同源的屏幕坐标（无控件矩形）"
                                  }
                                  style={{
                                    fontSize: 11,
                                    padding: "3px 8px",
                                    borderRadius: 6,
                                    border: `1px solid ${OBS_PALETTE.borderActive}`,
                                    background: qtAxShellCaptureOn ? "#e0f2fe" : "#fff",
                                    cursor:
                                      !getElectronShell()?.startQtAxOverlay || !isLikelyDarwinPlatform()
                                        ? "not-allowed"
                                        : "pointer",
                                  }}
                                >
                                  {qtAxShellCaptureOn ? "关闭十字线捕获" : "十字线捕获（Electron）"}
                                </button>
                                <span>
                                  {qtAxShellCaptureOn
                                    ? `显式屏幕坐标，约每 ${QT_AX_SHELL_CURSOR_POLL_MS}ms 刷新树（与覆盖层同源）`
                                    : `未开启时约每 ${NATIVE_A11Y_POINT_POLL_MS / 1000}s 用 nut-js 读全局鼠标`}
                                </span>
                              </>
                            ) : (
                              <span>
                                每 {NATIVE_A11Y_POINT_POLL_MS / 1000} 秒自动刷新（使用当前全局鼠标坐标；可先把指针移到目标上再在
                                Studio 内操作）
                              </span>
                            )}
                          </span>
                        ) : null}
                        {detailLoading && (
                          <span style={{ fontWeight: 400, color: OBS_PALETTE.textMuted, fontSize: 12 }}>
                            加载中…
                          </span>
                        )}
                      </div>
                      <ObservationBody
                        kind={panelKind}
                        text={
                          detailTopo ??
                          detailMetrics ??
                          detailSnap ??
                          detailNativeA11y ??
                          detailNativeA11yPoint
                        }
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
                        domPick={
                          panelKind === "list-window" && detailId
                            ? {
                                busyKey: domPickBusy,
                                hints: domPickHint,
                                onArm: domPickArmForTarget,
                                onResolve: domPickResolveForTarget,
                                onCancel: domPickCancelForTarget,
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
      {registerAppOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="od-register-app-title"
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
            if (e.target === e.currentTarget) closeRegisterAppModal();
          }}
        >
          <div
            style={{
              width: "min(480px, 100%)",
              maxHeight: "min(92vh, 720px)",
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
                <div id="od-register-app-title" style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                  注册应用
                </div>
              </div>
              <button
                type="button"
                disabled={registerAppBusy}
                onClick={() => closeRegisterAppModal()}
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  borderRadius: 8,
                  border: `1px solid ${OBS_PALETTE.border}`,
                  background: "#fff",
                  cursor: registerAppBusy ? "not-allowed" : "pointer",
                }}
              >
                关闭
              </button>
            </div>
            <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              {registerAppErr && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#991b1b",
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}
                >
                  {registerAppErr}
                </div>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#334155" }}>
                可执行文件路径（必填）
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "stretch" }}>
                  <input
                    className="od-input"
                    value={regExe}
                    onChange={(e) => {
                      setRegExe(e.target.value);
                      setRegisterAppPathHint(null);
                    }}
                    onBlur={(e) => {
                      const t = e.target.value.trim();
                      if (!t) return;
                      if (t.toLowerCase().endsWith(".lnk")) {
                        if (looksLikeWindowsAbsolutePath(t) && tokenTrimmed) {
                          void resolveRegisterShortcutForPath(t, { manageBusy: true });
                        }
                        return;
                      }
                      setRegId((cur) =>
                        cur.trim() === "" ? suggestedAppIdFromExecutablePath(t) : cur,
                      );
                    }}
                    placeholder={registerExeInputPlaceholder}
                    autoComplete="off"
                    style={{
                      flex: "1 1 200px",
                      minWidth: 0,
                      boxSizing: "border-box",
                      fontSize: 13,
                    }}
                  />
                  <button
                    type="button"
                    disabled={registerAppBusy || !tokenTrimmed}
                    title={registerExePickButtonTitle}
                    onClick={() => void pickExecutableViaSystemDialog()}
                    style={{
                      flexShrink: 0,
                      padding: "0 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 8,
                      border: `1px solid #059669`,
                      background:
                        registerAppBusy || !tokenTrimmed ? "#f1f5f9" : "#ecfdf5",
                      color: registerAppBusy || !tokenTrimmed ? OBS_PALETTE.textMuted : "#047857",
                      cursor: registerAppBusy || !tokenTrimmed ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {registerExePickButtonLabel}
                  </button>
                </div>
                {registerAppPathHint && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#b45309",
                      lineHeight: 1.45,
                      marginTop: 2,
                    }}
                  >
                    {registerAppPathHint}
                  </div>
                )}
                {regExe.trim().toLowerCase().endsWith(".lnk") &&
                  !looksLikeWindowsAbsolutePath(regExe) && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#b45309",
                        lineHeight: 1.45,
                        marginTop: 4,
                      }}
                    >
                      当前为文件名或相对路径，本机 Core 无法定位磁盘上的 .lnk。请 Shift+右键快捷方式选择「复制为路径」，将带盘符的完整路径粘贴到上方后再解析。
                    </div>
                  )}
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "#334155" }}>调用名 / 应用 ID（必填）</span>
                  <button
                    type="button"
                    disabled={registerAppBusy || !regExe.trim()}
                    title="按当前路径重新生成：短 slug + 至多 6 位字母数字后缀"
                    onClick={() => regenerateAppIdFromExe()}
                    style={{
                      padding: "4px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: `1px solid ${OBS_PALETTE.border}`,
                      background: registerAppBusy || !regExe.trim() ? "#f1f5f9" : "#fff",
                      color: registerAppBusy || !regExe.trim() ? OBS_PALETTE.textMuted : "#475569",
                      cursor: registerAppBusy || !regExe.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    按路径重新生成
                  </button>
                </div>
                <input
                  className="od-input"
                  value={regId}
                  onChange={(e) => setRegId(e.target.value)}
                  placeholder="选择文件后自动生成，也可手改"
                  autoComplete="off"
                  style={{ width: "100%", boxSizing: "border-box", fontSize: 13 }}
                />
                <div style={{ fontSize: 11, color: OBS_PALETTE.textMuted, lineHeight: 1.4 }}>
                  规则：文件名（去扩展名）转成小写与连字符，再附加至多 6 位随机字母数字。提交前会请求{" "}
                  <code style={{ fontSize: 10 }}>GET /v1/apps</code> 校验是否已被占用。
                </div>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#334155" }}>
                显示名称（可选，默认同 ID）
                <input
                  className="od-input"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="留空则使用应用 ID"
                  autoComplete="off"
                  style={{ width: "100%", boxSizing: "border-box", fontSize: 13 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#334155" }}>
                工作目录（可选）
                <input
                  className="od-input"
                  value={regCwd}
                  onChange={(e) => setRegCwd(e.target.value)}
                  placeholder="留空则使用 Core 服务端当前工作目录"
                  autoComplete="off"
                  style={{ width: "100%", boxSizing: "border-box", fontSize: 13 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#334155" }}>
                启动参数（JSON 字符串数组）
                <textarea
                  className="od-input"
                  value={regArgsJson}
                  onChange={(e) => setRegArgsJson(e.target.value)}
                  rows={3}
                  placeholder='例如 [] 或 ["./main.js"]'
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 12,
                    fontFamily: "ui-monospace, monospace",
                    resize: "vertical",
                  }}
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#334155" }}>UI 运行时</span>
                <div
                  role="radiogroup"
                  aria-label="UI 运行时"
                  style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}
                >
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: "#334155",
                      cursor: registerAppBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="od-reg-ui-runtime"
                      checked={regUiRuntime === "electron"}
                      disabled={registerAppBusy}
                      onChange={() => setRegUiRuntime("electron")}
                    />
                    electron
                  </label>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: "#334155",
                      cursor: registerAppBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="od-reg-ui-runtime"
                      checked={regUiRuntime === "qt"}
                      disabled={registerAppBusy}
                      onChange={() => setRegUiRuntime("qt")}
                    />
                    qt
                  </label>
                </div>
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "#475569",
                  cursor: registerAppBusy ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={regInjectCdp}
                  disabled={registerAppBusy}
                  onChange={(e) => setRegInjectCdp(e.target.checked)}
                />
                注入远程调试端口（与 CLI 默认一致，Electron 调试用）
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "#475569",
                  cursor: registerAppBusy ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={regHeadless}
                  disabled={registerAppBusy}
                  onChange={(e) => setRegHeadless(e.target.checked)}
                />
                无头模式（追加 <code style={{ fontSize: 10 }}>--headless=new</code>，无窗口；Chromium/Electron 系，默认关）
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "#475569",
                  cursor: registerAppBusy ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={regDedicatedProxy}
                  disabled={registerAppBusy}
                  onChange={(e) => setRegDedicatedProxy(e.target.checked)}
                />
                专用本地转发代理（下次启动会话时注入 HTTP(S)_PROXY）
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  disabled={registerAppBusy}
                  onClick={() => closeRegisterAppModal()}
                  style={{
                    padding: "8px 14px",
                    fontSize: 13,
                    borderRadius: 8,
                    border: `1px solid ${OBS_PALETTE.border}`,
                    background: "#fff",
                    cursor: registerAppBusy ? "not-allowed" : "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={registerAppBusy || !regId.trim() || !regExe.trim()}
                  onClick={() => void submitRegisterApp()}
                  style={{
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 700,
                    borderRadius: 8,
                    border: `1px solid ${OBS_PALETTE.borderActive}`,
                    background:
                      registerAppBusy || !regId.trim() || !regExe.trim() ? "#e2e8f0" : "#2563eb",
                    color: registerAppBusy || !regId.trim() || !regExe.trim() ? "#94a3b8" : "#fff",
                    cursor:
                      registerAppBusy || !regId.trim() || !regExe.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  {registerAppBusy ? "提交中…" : "注册"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </LiveConsoleDockLayout>
    </div>
  );
}
