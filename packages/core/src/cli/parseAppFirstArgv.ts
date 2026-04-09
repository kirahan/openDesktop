import { EX_USAGE } from "./exitCodes.js";

export const RESERVED_TOP_LEVEL = new Set([
  "core",
  "app",
  "session",
  "open",
  "doctor",
  "cdp",
  "agent",
  "-h",
  "--help",
  "-V",
  "--version",
]);

/** 推荐 `list-window`；`topology` 为兼容别名 */
export const APP_FIRST_COMMANDS = new Set([
  "snapshot",
  "list-window",
  "topology",
  "metrics",
  "list-global",
  "explore",
]);

export type AppFirstSubcommand =
  | "snapshot"
  | "list-window"
  | "metrics"
  | "topology"
  | "list-global"
  | "explore";

export interface AppFirstParseOk {
  kind: "ok";
  apiUrl?: string;
  tokenFile?: string;
  format: "table" | "json";
  sessionId?: string;
  appId: string;
  command: AppFirstSubcommand;
  /** list-global / explore：可省略，运行时从 list-window 拓扑取第一个 page target */
  targetId?: string;
  interestPattern?: string;
  maxKeys?: number;
  /** explore：最多返回候选条数 */
  maxCandidates?: number;
  /** explore：最低 score（0～1） */
  minScore?: number;
  /** explore：纳入类按钮 `<a href>`（启发式） */
  includeAnchorButtons?: boolean;
}

export interface AppFirstParseErr {
  kind: "error";
  message: string;
  exitCode: number;
}

export type AppFirstParseResult = AppFirstParseOk | AppFirstParseErr | { kind: "not-app-first" };

/**
 * 自 process.argv.slice(2) 解析 App-first：`od [flags] <appId> <snapshot|list-window|metrics|list-global|explore>`（`topology` 为别名）
 */
export function tryParseAppFirstArgv(argv: string[]): AppFirstParseResult {
  const opts: {
    apiUrl?: string;
    tokenFile?: string;
    format?: "table" | "json";
    sessionId?: string;
    targetId?: string;
    interestPattern?: string;
    maxKeys?: number;
    maxCandidates?: number;
    minScore?: number;
    includeAnchorButtons?: boolean;
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
    if (a === "--target") {
      const v = argv[i + 1];
      if (!v) return { kind: "error", message: "--target 需要参数", exitCode: EX_USAGE };
      opts.targetId = v;
      i += 2;
      continue;
    }
    if (a === "--interest") {
      const v = argv[i + 1];
      if (!v) return { kind: "error", message: "--interest 需要参数", exitCode: EX_USAGE };
      opts.interestPattern = v;
      i += 2;
      continue;
    }
    if (a === "--max-keys") {
      const v = argv[i + 1];
      if (!v) return { kind: "error", message: "--max-keys 需要参数", exitCode: EX_USAGE };
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) {
        return { kind: "error", message: "--max-keys 须为正数", exitCode: EX_USAGE };
      }
      opts.maxKeys = Math.floor(n);
      i += 2;
      continue;
    }
    if (a === "--max-candidates") {
      const v = argv[i + 1];
      if (!v) return { kind: "error", message: "--max-candidates 需要参数", exitCode: EX_USAGE };
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) {
        return { kind: "error", message: "--max-candidates 须为 1～128 的正整数", exitCode: EX_USAGE };
      }
      opts.maxCandidates = Math.min(128, Math.max(1, Math.floor(n)));
      i += 2;
      continue;
    }
    if (a === "--min-score") {
      const v = argv[i + 1];
      if (!v) return { kind: "error", message: "--min-score 需要参数", exitCode: EX_USAGE };
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        return { kind: "error", message: "--min-score 须为 0～1", exitCode: EX_USAGE };
      }
      opts.minScore = n;
      i += 2;
      continue;
    }
    if (a === "--include-anchor-buttons") {
      opts.includeAnchorButtons = true;
      i += 1;
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
  if (!APP_FIRST_COMMANDS.has(cmd)) {
    return {
      kind: "error",
      message:
        `未知 App-first 子命令「${cmd}」。可用: list-window | metrics | snapshot | list-global | explore（topology 与 list-window 等价）`,
      exitCode: EX_USAGE,
    };
  }

  return {
    kind: "ok",
    apiUrl: opts.apiUrl,
    tokenFile: opts.tokenFile,
    format: opts.format ?? "table",
    sessionId: opts.sessionId,
    appId,
    command: cmd as AppFirstSubcommand,
    targetId: opts.targetId?.trim(),
    interestPattern: opts.interestPattern,
    maxKeys: opts.maxKeys,
    maxCandidates: opts.maxCandidates,
    minScore: opts.minScore,
    includeAnchorButtons: opts.includeAnchorButtons,
  };
}
