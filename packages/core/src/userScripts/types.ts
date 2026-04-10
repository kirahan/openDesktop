import type { ParsedUserScriptMetadata } from "./parseUserScriptMetadata.js";

export const USER_SCRIPTS_STORE_SCHEMA_VERSION = 1;

/** 单条用户脚本持久化记录（按 app 过滤；@match 已存不用） */
export interface UserScriptRecord {
  id: string;
  appId: string;
  /** 完整 .user.js 源文 */
  source: string;
  metadata: ParsedUserScriptMetadata;
  updatedAt: string;
}

export interface UserScriptsFile {
  schemaVersion: number;
  scripts: UserScriptRecord[];
}
