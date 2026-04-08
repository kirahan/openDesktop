import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { attachToTargetSession, BrowserCdp } from "./browserClient.js";

describe("BrowserCdp", () => {
  it("send times out when no CDP response", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    const port = (wss.address() as AddressInfo).port;
    wss.on("connection", (s) => {
      s.on("message", () => {
        /* intentionally no JSON reply */
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const cdp = new BrowserCdp(ws);
    await expect(cdp.send("Foo.bar", { x: 1 }, undefined, 60)).rejects.toThrow("cdp_timeout");
    cdp.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("send resolves when server returns result", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    const port = (wss.address() as AddressInfo).port;
    wss.on("connection", (s) => {
      s.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { id?: number };
        if (msg.id !== undefined) {
          s.send(JSON.stringify({ id: msg.id, result: { v: 42 } }));
        }
      });
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const cdp = new BrowserCdp(ws);
    const r = (await cdp.send("X.y", {}, undefined, 2000)) as { v?: number };
    expect(r.v).toBe(42);
    cdp.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("rejectAll pending on socket close", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    const port = (wss.address() as AddressInfo).port;
    wss.on("connection", (s) => {
      s.on("message", () => {
        s.close();
      });
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const cdp = new BrowserCdp(ws);
    const p = cdp.send("No.reply", {}, undefined, 5000);
    await expect(p).rejects.toThrow();
    cdp.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("waitForProtocolEvent resolves on matching notification", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    const port = (wss.address() as AddressInfo).port;
    wss.on("connection", (s) => {
      s.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { id?: number; method?: string };
        if (msg.id !== undefined && msg.method === "Page.navigate") {
          s.send(JSON.stringify({ method: "Page.loadEventFired", params: {}, sessionId: "sess1" }));
          s.send(JSON.stringify({ id: msg.id, result: {} }));
        }
      });
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const cdp = new BrowserCdp(ws);
    const wait = cdp.waitForProtocolEvent("Page.loadEventFired", 2000, "sess1");
    await cdp.send("Page.navigate", { url: "https://example.com" }, "sess1", 2000);
    const ev = await wait;
    expect(ev).toEqual({});
    cdp.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("attachToTargetSession throws when no sessionId in result", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    const port = (wss.address() as AddressInfo).port;
    wss.on("connection", (s) => {
      s.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { id?: number };
        if (msg.id !== undefined) {
          s.send(JSON.stringify({ id: msg.id, result: {} }));
        }
      });
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const cdp = new BrowserCdp(ws);
    await expect(attachToTargetSession(cdp, "t1", 1000)).rejects.toThrow("attach_no_session");
    cdp.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });
});
