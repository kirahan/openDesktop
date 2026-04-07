import { EX_USAGE } from "./exitCodes.js";

export const RESERVED_TOP_LEVEL = new Set([
  "core",
  "app",
  "session",
  "open",
  "doctor",
  "-h",
  "--help",
  "-V",
  "--version",
]);

/** 推荐 `list-window`；`topology` 为兼容别名 */
export const APP_FIRST_COMMANDS = new Set(["snapshot", "list-window", "topology", "metrics"]);

export type AppFirstSubcommand = "snapshot" | "list-window" | "metrics" | "topology";

export interface AppFirstParseOk {
  kind: "ok";
  apiUrl?: string;
  tokenFile?: string;
  format: "table" | "json";
  sessionId?: string;
  appId: string;
  command: AppFirstSubcommand;
}

export interface AppFirstParseErr {
  kind: "error";
  message: string;
  exitCode: number;
}

export type AppFirstParseResult = AppFirstParseOk | AppFirstParseErr | { kind: "not-app-first" };

/**
 * 自 process.argv.slice(2) 解析 App-first：`od [flags] <appId> <snapshot|list-window|metrics>`（`topology` 为别名）
 */
export function tryParseAppFirstArgv(argv: string[]): AppFirstParseResult {
  const opts: {
    apiUrl?: string;
    tokenFile?: string;
    format?: "table" | "json";
    sessionId?: string;
  } = {};
  const pos: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === undefined) break;
    if (a === "--api-url") {
      const v = argv[i + 1];
      if (!v) return { kind: "error", message: "--api-url 需要参数", exitCode: EX_USAGE };
      opts.apiUrl = v;
      i += 2;
      continue;
    }
    if (a === "--token-file") {
      const v = argv[i + 1];
      if (!v) return { kind: "error", message: "--token-file 需要参数", exitCode: EX_USAGE };
      opts.tokenFile = v;
      i += 2;
      continue;
    }
    if (a === "--session") {
      const v = argv[i + 1];
      if (!v) return { kind: "error", message: "--session 需要参数", exitCode: EX_USAGE };
      opts.sessionId = v;
      i += 2;
      continue;
    }
    if (a === "-f" || a === "--format") {
      const v = argv[i + 1];
      if (!v) return { kind: "error", message: "--format 需要参数 (table|json)", exitCode: EX_USAGE };
      if (v !== "table" && v !== "json") {
        return { kind: "error", message: "仅支持 --format table|json", exitCode: EX_USAGE };
      }
      opts.format = v;
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      return { kind: "not-app-first" };
    }
    pos.push(a);
    i += 1;
  }

  if (pos.length < 2) return { kind: "not-app-first" };

  const [appId, cmd, ...rest] = pos;
  if (!appId || !cmd) return { kind: "not-app-first" };
  /** 必须先判断：session create <profileId> 等整段交给 Commander，避免误当成 App-first 且被「多余参数」拦截 */
  if (RESERVED_TOP_LEVEL.has(appId)) return { kind: "not-app-first" };
  if (rest.length > 0) {
    return { kind: "error", message: `多余参数: ${rest.join(" ")}`, exitCode: EX_USAGE };
  }
  if (!APP_FIRST_COMMANDS.has(cmd)) return { kind: "not-app-first" };

  return {
    kind: "ok",
    apiUrl: opts.apiUrl,
    tokenFile: opts.tokenFile,
    format: opts.format ?? "table",
    sessionId: opts.sessionId,
    appId,
    command: cmd as AppFirstSubcommand,
  };
}
