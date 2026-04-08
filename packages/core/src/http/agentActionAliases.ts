/**
 * Agent `POST .../actions` 的 `action` 字段：优先使用与 OpenCLI operate 对齐的动词；
 * `topology` / `dom` 等为历史别名，运行时归一为 canonical 再分发。
 */

/** 历史名 → 当前 canonical 动词（小写键） */
const LEGACY_TO_CANONICAL: Record<string, string> = {
  topology: "state",
  dom: "get",
};

/**
 * 当前实现已支持的 canonical `action` 值（与 OpenCLI README 动词表对齐，另含 `console-messages`）。
 */
export const SUPPORTED_AGENT_ACTIONS = [
  "open",
  "state",
  "click",
  "type",
  "select",
  "keys",
  "wait",
  "get",
  "screenshot",
  "scroll",
  "back",
  "eval",
  "network",
  "init",
  "verify",
  "close",
  "console-messages",
  "window-state",
  "focus-window",
  "renderer-globals",
] as const;

/** 仍接受但已归一化的历史 `action` 名（见 {@link LEGACY_TO_CANONICAL}） */
export const LEGACY_AGENT_ACTION_NAMES = ["topology", "dom"] as const;

/**
 * 将客户端传入的 `action` 归一为内部使用的 canonical 名（小写）。
 * 未知字符串原样返回（由路由层再判 UNKNOWN_ACTION）。
 */
export function normalizeAgentAction(raw: string): string {
  const key = raw.trim().toLowerCase();
  return LEGACY_TO_CANONICAL[key] ?? key;
}

/** 是否曾使用别名（用于审计 `canonicalAction` 字段） */
export function isLegacyAgentActionAlias(raw: string): boolean {
  const key = raw.trim().toLowerCase();
  return key in LEGACY_TO_CANONICAL;
}

/** 归一化后的名是否为当前已实现的 action */
export function isSupportedAgentCanonical(c: string): boolean {
  return (SUPPORTED_AGENT_ACTIONS as readonly string[]).includes(c);
}

/** `GET /v1/version` 的 `agentActions`：canonical + 仍接受的旧名 */
export function listAgentActionNamesForVersion(): string[] {
  return [...SUPPORTED_AGENT_ACTIONS, ...LEGACY_AGENT_ACTION_NAMES].sort();
}
