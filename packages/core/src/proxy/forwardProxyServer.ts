import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import type { ForwardProxyRuleExtension, LocalProxyRule, ProxyRequestCompleteEvent } from "./localProxyTypes.js";
import { matchProxyRules } from "./matchProxyRules.js";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
]);

function filterHeaders(h: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(h)) {
    if (!k || HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

/** 供启动子进程时设置 NO_PROXY，避免回连 Core 与 loopback 走代理 */
export function buildDefaultNoProxy(coreHost: string, corePort: number): string {
  const safe =
    coreHost.includes(":") && !coreHost.startsWith("[") ? `[${coreHost}]` : coreHost;
  return `localhost,127.0.0.1,::1,${safe}:${corePort}`;
}

/**
 * 若设置 `OPENDESKTOP_LOCAL_PROXY_PORT`（1～65535），本地转发代理固定监听该端口（默认动态分配）。
 * 用于与应用内写死的 `127.0.0.1:端口` 对齐做联调；多会话同时开专用代理时会端口冲突。
 */
export function parseFixedLocalProxyPortFromEnv(): number | undefined {
  const raw = process.env.OPENDESKTOP_LOCAL_PROXY_PORT?.trim();
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return undefined;
  return n;
}

/**
 * 本地 HTTP(S) 转发代理：HTTP 明文可解析 URL；HTTPS 仅 CONNECT 隧道（不解密 TLS）。
 * Phase 2 MITM 前，不得在协议层终止 HTTPS（见 design.md）。
 */
export async function startLocalForwardProxy(options: {
  rules: LocalProxyRule[];
  onComplete: (ev: ProxyRequestCompleteEvent) => void;
  ruleExtension?: ForwardProxyRuleExtension;
  /** 未指定或为 0 时由系统分配端口 */
  listenPort?: number;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const { rules, onComplete, ruleExtension, listenPort: listenPortOpt } = options;

  const server = http.createServer((req, res) => {
    void handleHttpProxy(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(err instanceof Error ? err.message : err));
    });
  });

  server.on("connect", (req, clientSocket, head) => {
    handleConnect(req, clientSocket, head);
  });

  async function handleHttpProxy(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const start = Date.now();
    const requestId = randomUUID();
    let emitted = false;
    const urlStr = req.url ?? "";
    let target: URL;
    try {
      if (/^https?:\/\//i.test(urlStr)) {
        target = new URL(urlStr);
      } else {
        const host = req.headers.host ?? "";
        target = new URL(urlStr, `http://${host}`);
      }
    } catch {
      res.writeHead(400);
      res.end("bad proxy url");
      return;
    }

    const host = target.hostname;
    const path = `${target.pathname}${target.search}`;
    const method = (req.method ?? "GET").toUpperCase();
    const tags = [...matchProxyRules(host, path, rules)];
    const ext = ruleExtension?.apply
      ? await ruleExtension.apply({ host, path, method, tlsTunnel: false })
      : undefined;
    if (Array.isArray(ext)) tags.push(...ext);

    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;
    const opts: http.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers: filterHeaders(req.headers),
    };

    const emitOk = (status: number): void => {
      if (emitted) return;
      emitted = true;
      const durationMs = Math.max(0, Date.now() - start);
      onComplete({
        kind: "proxyRequestComplete",
        source: "proxy",
        tlsTunnel: false,
        method,
        url: target.toString(),
        status,
        durationMs,
        requestId,
        tags: tags.length ? tags : undefined,
      });
    };

    const preq = lib.request(opts, (pres) => {
      const status = pres.statusCode ?? 0;
      res.writeHead(status, filterHeaders(pres.headers));
      pres.pipe(res);
      pres.on("end", () => emitOk(status));
    });
    preq.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
      emitOk(502);
    });
    req.pipe(preq);
  }

  function handleConnect(req: http.IncomingMessage, clientSocket: Duplex, head: Buffer): void {
    const start = Date.now();
    const requestId = randomUUID();
    const raw = req.url ?? "";
    let host: string;
    let port: number;
    if (raw.startsWith("[")) {
      const end = raw.indexOf("]");
      if (end < 0) {
        clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        clientSocket.end();
        return;
      }
      host = raw.slice(1, end);
      const rest = raw.slice(end + 1);
      port = rest.startsWith(":") ? parseInt(rest.slice(1), 10) : 443;
    } else {
      const colon = raw.lastIndexOf(":");
      host = colon > 0 ? raw.slice(0, colon) : raw;
      port = colon > 0 ? parseInt(raw.slice(colon + 1), 10) : 443;
    }
    if (!host || !Number.isFinite(port) || port <= 0) {
      clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      clientSocket.end();
      return;
    }

    const tunnelUrl = `https://${host}:${port}/`;
    const tags = [...matchProxyRules(host, "", rules)];
    void ruleExtension?.apply?.({ host, path: "", method: "CONNECT", tlsTunnel: true });

    let bytesIn = 0;
    let bytesOut = 0;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      const durationMs = Math.max(0, Date.now() - start);
      onComplete({
        kind: "proxyRequestComplete",
        source: "proxy",
        tlsTunnel: true,
        method: "CONNECT",
        url: tunnelUrl,
        durationMs,
        requestId,
        tags: tags.length ? tags : undefined,
        bytesIn,
        bytesOut,
      });
    };

    const upstream = net.connect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) {
        upstream.write(head);
        bytesOut += head.length;
      }
      clientSocket.on("data", (c: Buffer) => {
        bytesIn += c.length;
      });
      upstream.on("data", (c: Buffer) => {
        bytesOut += c.length;
      });
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    upstream.on("error", () => {
      try {
        clientSocket.destroy();
      } catch {
        /* noop */
      }
      finish();
    });
    clientSocket.on("close", finish);
    upstream.on("close", finish);
  }

  const bindPort = listenPortOpt !== undefined && listenPortOpt > 0 ? listenPortOpt : 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(bindPort, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
