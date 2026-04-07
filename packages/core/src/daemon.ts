import http from "node:http";
import type { Socket } from "node:net";
import { loadConfig, type CoreConfig } from "./config.js";
import { createApp } from "./http/createApp.js";
import { JsonFileStore } from "./store/jsonStore.js";
import { SessionManager } from "./session/manager.js";
import { readOrCreateToken } from "./token.js";
import { writePidFile, removePidFile } from "./pidfile.js";

export interface RunningDaemon {
  server: http.Server;
  config: CoreConfig;
  token: string;
  stop: () => Promise<void>;
}

export async function startDaemon(overrides: Partial<CoreConfig> = {}): Promise<RunningDaemon> {
  const config = loadConfig(overrides);
  const store = new JsonFileStore(config.dataDir);
  await store.ensureDir();
  const token = await readOrCreateToken(config.tokenFile);
  const manager = new SessionManager(store, config.dataDir);
  const { app, cdpProxy } = createApp({ config, token, store, manager });

  const server = http.createServer(app);

  server.on("upgrade", (req, socket, head) => {
    const remote = (socket as Socket).remoteAddress;
    if (
      remote !== "127.0.0.1" &&
      remote !== "::1" &&
      remote !== "::ffff:127.0.0.1" &&
      remote !== undefined
    ) {
      socket.destroy();
      return;
    }
    const url = req.url ?? "";
    const m = url.match(/^\/v1\/sessions\/([^/]+)\/cdp(.*)$/);
    if (!m) {
      socket.destroy();
      return;
    }
    const sessionId = m[1];
    const pathSuffix = m[2] || "/";
    const session = manager.get(sessionId);
    if (!session?.cdpPort || session.state !== "running") {
      socket.destroy();
      return;
    }
    const qs = url.includes("?") ? "?" + url.split("?").slice(1).join("?") : "";
    req.url = pathSuffix + qs;
    cdpProxy.ws(req, socket, head, {
      target: `http://127.0.0.1:${session.cdpPort}`,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.host, () => resolve());
    server.on("error", reject);
  });

  await writePidFile(config.dataDir, process.pid);

  const stop = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await removePidFile(config.dataDir);
  };

  return { server, config, token, stop };
}
