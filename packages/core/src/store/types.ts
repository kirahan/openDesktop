import type { LocalProxyRule } from "../proxy/localProxyTypes.js";

export const STORE_SCHEMA_VERSION = 1;

/** 应用 UI 技术栈，用于 Studio 观测入口分流 */
export type UiRuntime = "electron" | "qt";

export function normalizeUiRuntime(raw: unknown): UiRuntime {
  if (raw === "qt") return "qt";
  return "electron";
}

export interface AppDefinition {
  id: string;
  name: string;
  /** Executable path or command name on PATH */
  executable: string;
  cwd: string;
  env: Record<string, string>;
  /** Extra argv before injected debugging args */
  args: string[];
  /** Electron / Qt 等；省略时视为 electron */
  uiRuntime?: UiRuntime;
  /** When true, append --remote-debugging-port <cdpPort> (Electron-style) */
  injectElectronDebugPort: boolean;
  /**
   * 为 true 时追加 Chromium 系 `--headless=new`（无窗口）；依赖应用基于 Chromium/Electron 且支持该开关。
   * 与 `injectElectronDebugPort` 独立，但无 CDP 时会话仍无法在 OpenDesktop 内完成观测就绪。
   */
  headless?: boolean;
  /**
   * 为 true 时：本会话启动子进程仅注入进程级 HTTP(S)_PROXY 指向 Core 拉起的本地转发代理（非系统全局代理）。
   * @see packages/core/src/proxy/forwardProxyServer.ts
   */
  useDedicatedProxy?: boolean;
  /** 可选：代理规则（host/path 标签）；未配置视为空数组 */
  proxyRules?: LocalProxyRule[];
}

export interface ProfileDefinition {
  id: string;
  appId: string;
  name: string;
  env: Record<string, string>;
  extraArgs: string[];
  /** 是否允许通过 Agent API 执行脚本类语义动作（默认 false） */
  allowScriptExecution?: boolean;
}

export interface AppsFile {
  schemaVersion: number;
  apps: AppDefinition[];
}

export interface ProfilesFile {
  schemaVersion: number;
  profiles: ProfileDefinition[];
}
