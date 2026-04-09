import WebSocket from "ws";
import {
  parseExceptionDetailsFromThrown,
  type RuntimeStackFrame,
} from "./runtimeExceptionStack.js";
import { BrowserCdp, attachToTargetSession, getBrowserWsUrl } from "./browserClient.js";

/** 每分钟最多推送的异常条数（超出则丢弃并触发 onDropped）。 */
export const MAX_RUNTIME_EXCEPTION_SSE_PER_MINUTE = 120;

type MinuteWindow = { minuteEpoch: number; count: number };

function allowEmitPerMinute(state: MinuteWindow, maxPerMinute: number): { allowed: boolean; state: MinuteWindow } {
  const m = Math.floor(Date.now() / 60_000);
  if (m !== state.minuteEpoch) {
    return { allowed: true, state: { minuteEpoch: m, count: 1 } };
  }
  if (state.count >= maxPerMinute) {
    return { allowed: false, state };
  }
  return { allowed: true, state: { minuteEpoch: m, count: state.count + 1 } };
}

export type RuntimeExceptionSsePayload = {
  text: string;
  textTruncated: boolean;
  frames: RuntimeStackFrame[];
};

/**
 * 持续订阅 `Runtime.exceptionThrown`，直到 `signal` abort；每条异常单独推送（与短时 action 仅首条不同）。
 */
export async function runRuntimeExceptionStream(
  cdpPort: number,
  targetId: string,
  opts: {
    maxPerMinute: number;
    onException: (payload: RuntimeExceptionSsePayload) => void;
    onDropped: (delta: number) => void;
  },
  signal: AbortSignal,
): Promise<{ error?: string }> {
  const wsUrl = await getBrowserWsUrl(cdpPort);
  if (!wsUrl) return { error: "no_browser_ws" };

  const ws = new WebSocket(wsUrl);
  const closeWs = (): void => {
    try {
      ws.close();
    } catch {
      /* noop */
    }
  };

  const abortPromise = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const cdp = new BrowserCdp(ws);
  let flatSessionId: string | undefined;
  let minuteState: MinuteWindow = { minuteEpoch: 0, count: 0 };

  cdp.onProtocolEvent = (method, params, eventSessionId) => {
    if (method !== "Runtime.exceptionThrown") return;
    if (flatSessionId !== undefined && eventSessionId !== undefined && eventSessionId !== flatSessionId) {
      return;
    }
    const parsed = parseExceptionDetailsFromThrown(params);
    const { allowed, state } = allowEmitPerMinute(minuteState, opts.maxPerMinute);
    minuteState = state;
    if (!allowed) {
      opts.onDropped(1);
      return;
    }
    opts.onException(parsed);
  };

  try {
    flatSessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, flatSessionId);
    await abortPromise;
    return {};
  } catch (e) {
    if (signal.aborted) return {};
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    closeWs();
  }
}
