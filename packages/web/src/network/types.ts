/**
 * Network 列表行（与 Core SSE / 未来代理层对齐的归一化模型）。
 */
export type NetworkRequestRow = {
  id: string;
  /** HTTP 状态码或 0 */
  status: number;
  method: string;
  host: string;
  /** 路径 + query 展示用 */
  url: string;
  /** 资源类型，如 xhr / fetch / document */
  type: string;
  /** 请求耗时（毫秒），SSE 提供 */
  durationMs?: number;
};
