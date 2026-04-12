import { homedir } from "node:os";
import path from "node:path";

export interface CoreConfig {
  host: string;
  port: number;
  dataDir: string;
  /** 操作配方 JSON 根目录（默认 `<dataDir>/recipes`） */
  recipesDir: string;
  /** 应用侧 JSON 记录根目录（默认 `<dataDir>/app-json`；可用 OPENDESKTOP_APP_JSON_DIR 覆盖整根） */
  appJsonDir: string;
  tokenFile: string;
  logLevel: "debug" | "info" | "warn" | "error";
  /** Absolute path to web SPA static files (optional) */
  webDist?: string;
  /** 默认 true；`OPENDESKTOP_AGENT_API=0` 可关闭 `/v1/agent/*` */
  enableAgentApi: boolean;
  /** 默认 true；`OPENDESKTOP_EXTENDED_LOGS=0` 可在 SSE 中省略扩展日志字段 */
  enableExtendedLogFields: boolean;
  /** Agent 路由每分钟每 token 请求上限 */
  agentRateLimitPerMinute: number;
}

function defaultDataDir(): string {
  const base =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support", "OpenDesktop")
      : process.platform === "win32"
        ? path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "OpenDesktop")
        : path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"), "opendesktop");
  return base;
}

/**
 * Resolve configuration from environment and overrides.
 * OPENDESKTOP_* env vars take precedence over defaults.
 */
export function loadConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  const dataDir = overrides.dataDir ?? process.env.OPENDESKTOP_DATA_DIR ?? defaultDataDir();
  const tokenFile =
    overrides.tokenFile ??
    process.env.OPENDESKTOP_TOKEN_FILE ??
    path.join(dataDir, "token.txt");
  const host = overrides.host ?? process.env.OPENDESKTOP_HOST ?? "127.0.0.1";
  const port = overrides.port ?? Number(process.env.OPENDESKTOP_PORT ?? 8787);
  const logLevel = (overrides.logLevel ??
    (process.env.OPENDESKTOP_LOG_LEVEL as CoreConfig["logLevel"]) ??
    "info") as CoreConfig["logLevel"];
  const webDist = overrides.webDist ?? process.env.OPENDESKTOP_WEB_DIST;
  const recipesDir = path.resolve(
    overrides.recipesDir ??
      process.env.OPENDESKTOP_RECIPES_DIR ??
      path.join(dataDir, "recipes"),
  );
  const appJsonDir = path.resolve(
    overrides.appJsonDir ??
      process.env.OPENDESKTOP_APP_JSON_DIR ??
      path.join(dataDir, "app-json"),
  );

  const agentEnv = process.env.OPENDESKTOP_AGENT_API?.trim().toLowerCase();
  const enableAgentApi =
    overrides.enableAgentApi ?? (agentEnv === "0" || agentEnv === "false" ? false : true);
  const extEnv = process.env.OPENDESKTOP_EXTENDED_LOGS?.trim().toLowerCase();
  const enableExtendedLogFields =
    overrides.enableExtendedLogFields ?? (extEnv === "0" || extEnv === "false" ? false : true);
  const agentRate = overrides.agentRateLimitPerMinute ?? Number(process.env.OPENDESKTOP_AGENT_RPM ?? 120);
  const agentRateLimitPerMinute = Number.isFinite(agentRate) && agentRate > 0 ? agentRate : 120;

  return {
    host,
    port: Number.isFinite(port) ? port : 8787,
    dataDir: path.resolve(dataDir),
    recipesDir,
    appJsonDir,
    tokenFile: path.resolve(tokenFile),
    logLevel: ["debug", "info", "warn", "error"].includes(logLevel) ? logLevel : "info",
    webDist: webDist ? path.resolve(webDist) : undefined,
    enableAgentApi,
    enableExtendedLogFields,
    agentRateLimitPerMinute,
  };
}
