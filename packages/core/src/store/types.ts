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
