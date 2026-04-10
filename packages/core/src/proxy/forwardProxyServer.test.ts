import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { ProxyRequestCompleteEvent } from "./localProxyTypes.js";
import { startLocalForwardProxy } from "./forwardProxyServer.js";

describe("startLocalForwardProxy", () => {
  it("forwards HTTP and emits proxyRequestComplete with tlsTunnel false", async () => {
    const done: ProxyRequestCompleteEvent[] = [];
    const target = http.createServer((_, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const tport = (target.address() as AddressInfo).port;

    const { port: pport, close } = await startLocalForwardProxy({
      rules: [],
      onComplete: (ev) => done.push(ev),
    });

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: pport,
          method: "GET",
          path: `http://127.0.0.1:${tport}/hello`,
          headers: { Host: `127.0.0.1:${tport}` },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve());
        },
      );
      req.on("error", reject);
      req.end();
    });

    await close();
    await new Promise<void>((resolve) => target.close(() => resolve()));

    expect(done.length).toBe(1);
    expect(done[0]?.kind).toBe("proxyRequestComplete");
    expect(done[0]?.tlsTunnel).toBe(false);
    expect(done[0]?.source).toBe("proxy");
    expect(done[0]?.status).toBe(200);
  });
});
