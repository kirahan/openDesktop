import type { LocalProxyRule } from "../proxy/localProxyTypes.js";

export const STORE_SCHEMA_VERSION = 1;

export interface AppDefinition {
  id: string;
  name: string;
  /** Executable path or command name on PATH */
  executable: string;
  cwd: string;
  env: Record<string, string>;
  /** Extra argv before injected debugging args */
  args: string[];
  /** When true, append --remote-debugging-port <cdpPort> (Electron-style) */
  injectElectronDebugPort: boolean;
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
