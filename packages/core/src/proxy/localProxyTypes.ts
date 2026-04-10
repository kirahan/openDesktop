/**
 * 已注册应用上的本地转发代理规则（host 后缀 + path 前缀），用于打标签。
 * Phase 2 MITM 时可扩展「解密 / 仅隧道」等动作（见 `openspec/specs/local-forward-proxy/spec.md`；历史任务见 archive）。
 */
export interface LocalProxyRule {
  /** 匹配请求 host 的后缀，如 `.google.com` 或完整 `api.example.com` */
  hostSuffix?: string;
  /** 仅对 HTTP 明文请求匹配 path 前缀；CONNECT 隧道无 path 时不参与匹配 */
  pathPrefix?: string;
  /** 命中规则时附加到观测事件的标签 */
  tags?: string[];
}

/** SSE / 内部管道：与 Web `NetworkRequestRow.source` 对齐 */
export type ProxyEventSource = "proxy";

/**
 * 本地转发代理产生的请求完成事件（与 CDP `NetworkSseRequestCompleteEvent` 可并列消费）。
 * HTTPS CONNECT 不解密时 **tlsTunnel** 为 true，url 仅含 scheme://host:port/ 形式。
 */
export type ProxyRequestCompleteEvent = {
  kind: "proxyRequestComplete";
  source: ProxyEventSource;
  tlsTunnel: boolean;
  method: string;
  url: string;
  status?: number;
  durationMs: number;
  requestId: string;
  tags?: string[];
  /** CONNECT 隧道累计字节（可选） */
  bytesIn?: number;
  bytesOut?: number;
};

/** 后续 Whistle 式脚本规则占位（本期 noop） */
export interface ForwardProxyRuleExtension {
  /** 返回额外标签；可异步 */
  apply?(ctx: {
    host: string;
    path: string;
    method: string;
    tlsTunnel: boolean;
  }): Promise<string[] | void> | string[] | void;
}
