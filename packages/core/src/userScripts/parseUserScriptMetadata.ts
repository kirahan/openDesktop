/**
 * 解析油猴风格 UserScript 元数据块；`@match` 原样收集，不做 URL 匹配。
 * @see openspec/specs/app-user-scripts/spec.md
 */

export type ParseUserScriptErrorCode =
  | "USER_SCRIPT_PARSE_ERROR"
  | "USER_SCRIPT_GRANT_NOT_SUPPORTED"
  | "USER_SCRIPT_VALIDATION_ERROR";

export interface ParsedUserScriptMetadata {
  name: string;
  namespace?: string;
  version?: string;
  description?: string;
  author?: string;
  /** 与源文 `@match` 行一一对应，不规范化 */
  matches: string[];
  /** 本阶段仅 `none` */
  grant: "none";
}

export type ParseUserScriptResult =
  | { ok: true; metadata: ParsedUserScriptMetadata; body: string }
  | { ok: false; code: ParseUserScriptErrorCode; message: string };

const START_RE = /^\/\/\s*==UserScript==\s*$/;
const END_RE = /^\/\/\s*==\/UserScript==\s*$/;
const META_RE = /^\/\/\s*@(\S+)\s*(.*)$/;

/**
 * 从完整 `.user.js` 源文解析元数据块与正文（元数据块之后的代码）。
 */
export function parseUserScriptSource(source: string): ParseUserScriptResult {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (START_RE.test(lines[i]!.trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return {
      ok: false,
      code: "USER_SCRIPT_PARSE_ERROR",
      message: "未找到 // ==UserScript== 块起始行",
    };
  }
  for (let i = start + 1; i < lines.length; i++) {
    if (END_RE.test(lines[i]!.trim())) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    return {
      ok: false,
      code: "USER_SCRIPT_PARSE_ERROR",
      message: "未找到 // ==/UserScript== 块结束行",
    };
  }

  const headerLines = lines.slice(start + 1, end);
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");

  let name: string | undefined;
  let namespace: string | undefined;
  let version: string | undefined;
  let description: string | undefined;
  let author: string | undefined;
  const matches: string[] = [];
  const grantLines: string[] = [];

  for (const raw of headerLines) {
    const m = META_RE.exec(raw.trim());
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = (m[2] ?? "").trim();
    switch (key) {
      case "name":
        if (val) name = val;
        break;
      case "namespace":
        if (val) namespace = val;
        break;
      case "version":
        if (val) version = val;
        break;
      case "description":
        if (val) description = val;
        break;
      case "author":
        if (val) author = val;
        break;
      case "match":
        if (val) matches.push(val);
        break;
      case "grant":
        grantLines.push(val);
        break;
      default:
        break;
    }
  }

  if (!name?.trim()) {
    return {
      ok: false,
      code: "USER_SCRIPT_VALIDATION_ERROR",
      message: "缺少必填 @name",
    };
  }

  for (const g of grantLines) {
    const normalized = g.trim().toLowerCase();
    if (normalized !== "none") {
      return {
        ok: false,
        code: "USER_SCRIPT_GRANT_NOT_SUPPORTED",
        message: `本阶段仅支持 @grant none，当前为: ${g}`,
      };
    }
  }

  const metadata: ParsedUserScriptMetadata = {
    name: name.trim(),
    namespace,
    version,
    description,
    author,
    matches,
    grant: "none",
  };

  return { ok: true, metadata, body };
}
