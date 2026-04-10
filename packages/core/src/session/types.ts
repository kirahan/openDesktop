export type SessionState = "pending" | "starting" | "running" | "killed" | "failed";

export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogSource = "main" | "preload" | "renderer" | "unknown";

export interface SessionRecord {
  id: string;
  profileId: string;
  state: SessionState;
  cdpPort?: number;
  /** 本会话为 useDedicatedProxy 应用启动的本地转发代理端口（127.0.0.1） */
  localProxyPort?: number;
  pid?: number;
  error?: string;
  createdAt: string;
  /** 是否允许 Agent/CDP 语义层执行脚本类动作（默认 true：新建 Profile 未指定时；由 Profile 继承） */
  allowScriptExecution?: boolean;
}

export interface LogLine {
  ts: string;
  stream: "stdout" | "stderr";
  line: string;
  /** 扩展字段；未开启扩展日志时响应中可省略 */
  level?: LogLevel;
  source?: LogSource;
  webContentsId?: number;
}
