import type { ChildProcess } from "node:child_process";
import { launchDebuggedApp } from "../process/launcher.js";
import type { JsonFileStore } from "../store/jsonStore.js";
import type { AppDefinition } from "../store/types.js";
import { appendAudit } from "../audit.js";
import { pickFreePort } from "../net/pickPort.js";
import { assertTransition, canTransition } from "./fsm.js";
import type { LogLine, SessionRecord } from "./types.js";
import { waitForCdpReady } from "./waitCdp.js";
import {
  buildDefaultNoProxy,
  parseFixedLocalProxyPortFromEnv,
  startLocalForwardProxy,
} from "../proxy/forwardProxyServer.js";
import type { ProxyRequestCompleteEvent } from "../proxy/localProxyTypes.js";

type Internal = SessionRecord & {
  child?: ChildProcess;
  logs: LogLine[];
  logSubscribers: Set<(line: LogLine) => void>;
  proxySubscribers?: Set<(ev: ProxyRequestCompleteEvent) => void>;
  localProxyClose?: () => Promise<void>;
};

export class SessionManager {
  private readonly sessions = new Map<string, Internal>();

  constructor(
    private readonly store: JsonFileStore,
    private readonly dataDir: string,
    /** Core HTTP 监听地址，用于 NO_PROXY 排除，避免子进程经代理访问 Core 形成回环 */
    private readonly coreHttp: { host: string; port: number } = {
      host: "127.0.0.1",
      port: 8787,
    },
  ) {}

  list(): SessionRecord[] {
    return [...this.sessions.values()].map((s) => this.publicRecord(s));
  }

  get(id: string): SessionRecord | undefined {
    const s = this.sessions.get(id);
    return s ? this.publicRecord(s) : undefined;
  }

  private publicRecord(s: Internal): SessionRecord {
    const {
      logs: _l,
      logSubscribers: _s,
      child: _c,
      proxySubscribers: _p,
      localProxyClose: _x,
      ...rest
    } = s;
    return rest;
  }

  async create(profileId: string): Promise<SessionRecord> {
    const { profiles } = await this.store.readProfiles();
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) {
      throw Object.assign(new Error("Profile not found"), { code: "PROFILE_NOT_FOUND" });
    }
    const { apps } = await this.store.readApps();
    const app = apps.find((a) => a.id === profile.appId);
    if (!app) {
      throw Object.assign(new Error("App not found"), { code: "APP_NOT_FOUND" });
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const internal: Internal = {
      id,
      profileId,
      state: "pending",
      createdAt,
      allowScriptExecution: profile.allowScriptExecution ?? true,
      logs: [],
      logSubscribers: new Set(),
    };
    this.sessions.set(id, internal);
    assertTransition("pending", "starting");
    internal.state = "starting";

    void this.runSession(id, app, profile).catch((err) => {
      const cur = this.sessions.get(id);
      if (!cur) return;
      if (canTransition(cur.state, "failed")) {
        cur.state = "failed";
        cur.error = err instanceof Error ? err.message : String(err);
      }
    });

    await appendAudit(this.dataDir, { type: "session.create", sessionId: id, profileId });
    return this.publicRecord(internal);
  }

  private pushLog(s: Internal, stream: "stdout" | "stderr", chunk: string): void {
    const ts = new Date().toISOString();
    const line: LogLine = {
      ts,
      stream,
      line: chunk,
      level: stream === "stderr" ? "error" : "info",
      source: "unknown",
    };
    s.logs.push(line);
    if (s.logs.length > 5000) s.logs.splice(0, s.logs.length - 5000);
    for (const fn of s.logSubscribers) fn(line);
  }

  private async runSession(id: string, app: AppDefinition, profile: import("../store/types.js").ProfileDefinition): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;

    const cdpPort = await pickFreePort();
    s.cdpPort = cdpPort;

    let localProxyClose: (() => Promise<void>) | undefined;
    if (app.useDedicatedProxy) {
      const rules = app.proxyRules ?? [];
      s.proxySubscribers = new Set();
      const subs = s.proxySubscribers;
      try {
        const fixedListen = parseFixedLocalProxyPortFromEnv();
        const { port, close } = await startLocalForwardProxy({
          rules,
          listenPort: fixedListen,
          onComplete: (ev) => {
            for (const fn of subs) fn(ev);
          },
        });
        s.localProxyPort = port;
        localProxyClose = close;
      } catch (e) {
        assertTransition(s.state, "failed");
        s.state = "failed";
        s.error = e instanceof Error ? e.message : String(e);
        return;
      }
    }

    const proxyEnv =
      s.localProxyPort !== undefined
        ? {
            httpProxyUrl: `http://127.0.0.1:${s.localProxyPort}`,
            httpsProxyUrl: `http://127.0.0.1:${s.localProxyPort}`,
            noProxy: buildDefaultNoProxy(this.coreHttp.host, this.coreHttp.port),
          }
        : undefined;

    s.localProxyClose = localProxyClose;

    let launched;
    try {
      launched = launchDebuggedApp(app, profile, cdpPort, proxyEnv);
    } catch (e) {
      assertTransition(s.state, "failed");
      s.state = "failed";
      s.error = e instanceof Error ? e.message : String(e);
      if (localProxyClose) {
        try {
          await localProxyClose();
        } catch {
          /* noop */
        }
      }
      s.localProxyPort = undefined;
      s.proxySubscribers = undefined;
      s.localProxyClose = undefined;
      return;
    }

    const { child } = launched;
    s.child = child;
    s.pid = child.pid;

    child.stdout?.on("data", (buf: Buffer) => this.pushLog(s, "stdout", buf.toString("utf8")));
    child.stderr?.on("data", (buf: Buffer) => this.pushLog(s, "stderr", buf.toString("utf8")));
    child.on("error", (err) => this.pushLog(s, "stderr", `child error: ${err.message}`));

    child.on("exit", (code, signal) => {
      const cur = this.sessions.get(id);
      if (!cur) return;
      if (cur.state === "running" && canTransition(cur.state, "killed")) {
        cur.state = "killed";
        cur.error = signal ? `signal ${signal}` : `exit ${code}`;
      } else if (cur.state === "starting" && canTransition(cur.state, "failed")) {
        cur.state = "failed";
        cur.error = `child exited during startup: code=${code} signal=${signal ?? ""}`;
      }
    });

    try {
      await waitForCdpReady(cdpPort, 20000);
    } catch (e) {
      assertTransition(s.state, "failed");
      s.state = "failed";
      s.error = e instanceof Error ? e.message : String(e);
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      if (localProxyClose) {
        try {
          await localProxyClose();
        } catch {
          /* noop */
        }
      }
      s.localProxyPort = undefined;
      s.proxySubscribers = undefined;
      s.localProxyClose = undefined;
      return;
    }

    assertTransition(s.state, "running");
    s.state = "running";
    await appendAudit(this.dataDir, { type: "session.running", sessionId: id, cdpPort });
  }

  async stop(id: string): Promise<SessionRecord | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.state === "failed") {
      return this.publicRecord(s);
    }
    if (s.state === "killed") {
      return this.publicRecord(s);
    }
    if (!canTransition(s.state, "killed")) {
      throw Object.assign(new Error("Cannot stop session in current state"), {
        code: "INVALID_STATE",
      });
    }
    try {
      s.child?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    if (s.localProxyClose) {
      void s.localProxyClose().catch(() => undefined);
    }
    s.localProxyPort = undefined;
    s.proxySubscribers = undefined;
    s.localProxyClose = undefined;
    s.state = "killed";
    s.error = s.error ?? "stopped by user";
    await appendAudit(this.dataDir, { type: "session.stop", sessionId: id });
    return this.publicRecord(s);
  }

  subscribeLogs(sessionId: string, fn: (line: LogLine) => void): (() => void) | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    s.logSubscribers.add(fn);
    return () => s.logSubscribers.delete(fn);
  }

  /** 订阅本地转发代理产生的请求完成事件（仅 useDedicatedProxy 会话有数据） */
  subscribeProxyNetwork(
    sessionId: string,
    fn: (ev: ProxyRequestCompleteEvent) => void,
  ): (() => void) | undefined {
    const s = this.sessions.get(sessionId);
    if (!s?.proxySubscribers) return undefined;
    s.proxySubscribers.add(fn);
    return () => s.proxySubscribers?.delete(fn);
  }

  getLogs(sessionId: string): LogLine[] {
    return [...(this.sessions.get(sessionId)?.logs ?? [])];
  }

  /**
   * 供 HTTP 层拉取 CDP/指标（不暴露 child 引用）。
   */
  getOpsContext(id: string):
    | {
        state: SessionRecord["state"];
        cdpPort?: number;
        localProxyPort?: number;
        pid?: number;
        allowScriptExecution: boolean;
      }
    | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    return {
      state: s.state,
      cdpPort: s.cdpPort,
      localProxyPort: s.localProxyPort,
      pid: s.pid,
      allowScriptExecution: s.allowScriptExecution ?? true,
    };
  }
}
