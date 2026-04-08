import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { bringTargetPageToFront } from "./browserClient.js";

describe("bringTargetPageToFront (Page.bringToFront)", () => {
  let httpServer: http.Server;
  let wss: WebSocketServer;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (httpServer) httpServer.close(() => resolve());
      else resolve();
    });
    await new Promise<void>((resolve) => {
      if (wss) wss.close(() => resolve());
      else resolve();
    });
  });

  it("issues Target.attachToTarget, Page.enable, Page.bringToFront in order", async () => {
    const cdpMethods: string[] = [];

    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    const wsPort = (wss.address() as AddressInfo).port;
    const wsDebuggerUrl = `ws://127.0.0.1:${wsPort}`;

    wss.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as {
          id?: number;
          method?: string;
          sessionId?: string;
        };
        if (msg.id === undefined || !msg.method) return;
        cdpMethods.push(msg.method);
        if (msg.method === "Target.attachToTarget") {
          socket.send(JSON.stringify({ id: msg.id, result: { sessionId: "flat-session-1" } }));
          return;
        }
        socket.send(JSON.stringify({ id: msg.id, result: {} }));
      });
    });

    httpServer = http.createServer((req, res) => {
      if (req.url?.startsWith("/json/version")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ webSocketDebuggerUrl: wsDebuggerUrl }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
    const httpPort = (httpServer.address() as AddressInfo).port;

    const out = await bringTargetPageToFront(httpPort, "page-target-id");

    expect(out).toEqual({ ok: true });
    expect(cdpMethods).toEqual([
      "Target.attachToTarget",
      "Page.enable",
      "Page.bringToFront",
    ]);
  });
});
