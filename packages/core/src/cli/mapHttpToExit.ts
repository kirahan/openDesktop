import { EX_CONFIG, EX_NOINPUT, EX_NOPERM, EX_UNAVAILABLE } from "./exitCodes.js";

/** 将 HTTP 状态码映射为 CLI 退出码（粗粒度） */
export function exitCodeForHttpStatus(status: number): number {
  if (status === 401 || status === 403) return EX_NOPERM;
  if (status === 404) return EX_NOINPUT;
  if (status === 503 || status === 502) return EX_UNAVAILABLE;
  if (status >= 500) return EX_UNAVAILABLE;
  return 1;
}

/** fetch 抛错或 TypeError（网络不可达） */
export function exitCodeForFetchError(e: unknown): number {
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES") return EX_CONFIG;
  }
  return EX_UNAVAILABLE;
}
