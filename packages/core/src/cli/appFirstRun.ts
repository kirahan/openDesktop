import process from "node:process";
import { CoreUnreachableError, isCoreUnreachableError, printCoreUnreachableHelp } from "./coreUnreachable.js";
import { EX_NOINPUT, EX_USAGE } from "./exitCodes.js";
import type { CliHttpContext } from "./httpClient.js";
import { buildCliHttpContext, fetchWithBearer } from "./httpClient.js";
import { exitCodeForFetchError, exitCodeForHttpStatus } from "./mapHttpToExit.js";
import type { AppFirstParseOk } from "./parseAppFirstArgv.js";
import { printStructured } from "./output.js";
import { pickLatestActiveSessionForApp, type ProfileRow, type SessionRow } from "./sessionResolve.js";
import type { TopologyNode } from "../topology/types.js";

async function readJson(res: Response): Promise<unknown> {
  const t = await res.text();
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return { raw: t };
  }
}

/**
 * 未传 --target 时：使用 list-window 拓扑中的 **第一个** target（与 CDP `/json/list` 顺序一致）。
 */
export function pickListGlobalTargetId(nodes: TopologyNode[]): { targetId: string } | { error: string } {
  if (nodes.length === 0) {
    return { error: "list-window 无可用 target（子进程 CDP 未就绪或无调试目标）" };
  }
  return { targetId: nodes[0]!.targetId };
}

async function resolveTargetForAppFirst(
  parsed: AppFirstParseOk,
  httpCtx: CliHttpContext,
  sessionId: string,
  writeErr: (s: string) => void,
): Promise<{ ok: true; targetId: string } | { ok: false; exit: number }> {
  const trimmed = parsed.targetId?.trim() ?? "";
  if (trimmed) return { ok: true, targetId: trimmed };
  const topoRes = await fetchWithBearer(httpCtx, "GET", `/v1/sessions/${sessionId}/list-window`);
  if (!topoRes.ok) {
    const errText = await topoRes.text();
    writeErr(`拉取 list-window 失败 HTTP ${topoRes.status}: ${errText}`);
    return { ok: false, exit: exitCodeForHttpStatus(topoRes.status) };
  }
  const topo = (await readJson(topoRes)) as { nodes?: TopologyNode[] };
  const nodes = Array.isArray(topo.nodes) ? topo.nodes : [];
  const picked = pickListGlobalTargetId(nodes);
  if ("error" in picked) {
    writeErr(picked.error);
    return { ok: false, exit: EX_USAGE };
  }
  return { ok: true, targetId: picked.targetId };
}

async function pumpSseGet(
  url: string,
  token: string,
  writeOut: (s: string) => void,
  writeErr: (s: string) => void,
): Promise<number> {
  const ac = new AbortController();
  const onSig = (): void => {
    ac.abort();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      writeErr(`HTTP ${res.status}: ${errText}`);
      return exitCodeForHttpStatus(res.status);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      writeErr("响应无可读 body 流");
      return 1;
    }
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) writeOut(dec.decode(value, { stream: true }));
    }
    return 0;
  } catch (e) {
    if (ac.signal.aborted) return 130;
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") return 130;
    if (isCoreUnreachableError(e)) {
      const base =
        e instanceof CoreUnreachableError
          ? e.baseUrl
          : (() => {
              try {
                return new URL(url).origin;
              } catch {
                return "http://127.0.0.1:8787";
              }
            })();
      printCoreUnreachableHelp(base, (line) => writeErr(line));
      return exitCodeForFetchError(e);
    }
    writeErr(e instanceof Error ? e.message : String(e));
    return exitCodeForFetchError(e);
  } finally {
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }
}

async function resolveSessionId(
  parsed: AppFirstParseOk,
  httpCtx: CliHttpContext,
): Promise<
  | { ok: true; sessionId: string }
  | { ok: false; exit: number; stderr: string }
> {
  if (parsed.sessionId) {
    const res = await fetchWithBearer(httpCtx, "GET", `/v1/sessions/${parsed.sessionId}`);
    if (!res.ok) {
      const exit = exitCodeForHttpStatus(res.status);
      return { ok: false, exit, stderr: `会话不存在或不可访问: HTTP ${res.status}` };
    }
    const body = (await readJson(res)) as { session?: SessionRow };
    const s = body.session;
    if (!s) return { ok: false, exit: 1, stderr: "响应缺少 session" };

    const pres = await fetchWithBearer(httpCtx, "GET", "/v1/profiles");
    if (!pres.ok) {
      return { ok: false, exit: exitCodeForHttpStatus(pres.status), stderr: `无法拉取 profiles: HTTP ${pres.status}` };
    }
    const pdata = (await readJson(pres)) as { profiles?: ProfileRow[] };
    const prof = pdata.profiles?.find((p) => p.id === s.profileId);
    if (!prof || prof.appId !== parsed.appId) {
      return {
        ok: false,
        exit: EX_USAGE,
        stderr: `--session 与会话所属应用不匹配（期望 appId=${parsed.appId}）`,
      };
    }
    return { ok: true, sessionId: s.id };
  }

  const [sRes, pRes] = await Promise.all([
    fetchWithBearer(httpCtx, "GET", "/v1/sessions"),
    fetchWithBearer(httpCtx, "GET", "/v1/profiles"),
  ]);
  if (!sRes.ok) {
    return { ok: false, exit: exitCodeForHttpStatus(sRes.status), stderr: `GET /v1/sessions: HTTP ${sRes.status}` };
  }
  if (!pRes.ok) {
    return { ok: false, exit: exitCodeForHttpStatus(pRes.status), stderr: `GET /v1/profiles: HTTP ${pRes.status}` };
  }
  const sdata = (await readJson(sRes)) as { sessions?: SessionRow[] };
  const pdata = (await readJson(pRes)) as { profiles?: ProfileRow[] };
  const sessions = sdata.sessions ?? [];
  const profiles = pdata.profiles ?? [];
  const profilesForApp = profiles.filter((p) => p.appId === parsed.appId);
  if (profilesForApp.length === 0) {
    const knownAppIds = [...new Set(profiles.map((p) => p.appId))].sort();
    const hint =
      knownAppIds.length > 0
        ? `Core 已注册的 appId：${knownAppIds.join(", ")}。第一个参数须与注册的应用 id 完全一致（开发脚本名如 xiezuo-dev 未必等于 app id）。可用 yarn oc app list 查看。`
        : "当前无任何 Profile；请先 yarn oc app create 注册应用，再用 yarn oc session start <profileId> 新建会话。";
    return {
      ok: false,
      exit: EX_NOINPUT,
      stderr: `未找到 appId「${parsed.appId}」对应的 Profile。${hint}`,
    };
  }
  const picked = pickLatestActiveSessionForApp(sessions, profiles, parsed.appId);
  if (!picked) {
    return {
      ok: false,
      exit: EX_NOINPUT,
      stderr: `应用 ${parsed.appId} 下无活跃会话（running/starting/pending）。可先创建会话或指定 --session`,
    };
  }
  return { ok: true, sessionId: picked.id };
}

export async function runAppFirst(
  parsed: AppFirstParseOk,
  writeOut: (s: string) => void,
  writeErr: (s: string) => void,
): Promise<number> {
  let httpCtx: CliHttpContext;
  try {
    httpCtx = await buildCliHttpContext({ apiUrl: parsed.apiUrl, tokenFile: parsed.tokenFile });
  } catch (e) {
    writeErr(e instanceof Error ? e.message : String(e));
    return exitCodeForFetchError(e);
  }

  let sessionId: string;
  try {
    const r = await resolveSessionId(parsed, httpCtx);
    if (!r.ok) {
      writeErr(r.stderr);
      return r.exit;
    }
    sessionId = r.sessionId;
  } catch (e) {
    writeErr(e instanceof Error ? e.message : String(e));
    return exitCodeForFetchError(e);
  }

  try {
    if (parsed.command === "network-stream") {
      const rt = await resolveTargetForAppFirst(parsed, httpCtx, sessionId, writeErr);
      if (!rt.ok) return rt.exit;
      const params = new URLSearchParams();
      params.set("targetId", rt.targetId);
      if (parsed.stripQuery === false) params.set("stripQuery", "false");
      if (parsed.maxEventsPerSecond !== undefined) {
        params.set("maxEventsPerSecond", String(parsed.maxEventsPerSecond));
      }
      const url = `${httpCtx.baseUrl}/v1/sessions/${sessionId}/network/stream?${params.toString()}`;
      return await pumpSseGet(url, httpCtx.token, writeOut, writeErr);
    }

    if (parsed.command === "console-stream") {
      const rt = await resolveTargetForAppFirst(parsed, httpCtx, sessionId, writeErr);
      if (!rt.ok) return rt.exit;
      const params = new URLSearchParams({ targetId: rt.targetId });
      const url = `${httpCtx.baseUrl}/v1/sessions/${sessionId}/console/stream?${params.toString()}`;
      return await pumpSseGet(url, httpCtx.token, writeOut, writeErr);
    }

    if (parsed.command === "stack-stream") {
      const rt = await resolveTargetForAppFirst(parsed, httpCtx, sessionId, writeErr);
      if (!rt.ok) return rt.exit;
      const params = new URLSearchParams({ targetId: rt.targetId });
      const url = `${httpCtx.baseUrl}/v1/sessions/${sessionId}/runtime-exception/stream?${params.toString()}`;
      return await pumpSseGet(url, httpCtx.token, writeOut, writeErr);
    }

    if (parsed.command === "network-observe") {
      const rt = await resolveTargetForAppFirst(parsed, httpCtx, sessionId, writeErr);
      if (!rt.ok) return rt.exit;
      const targetId = rt.targetId;

      const body: Record<string, unknown> = {
        action: "network-observe",
        targetId,
      };
      if (parsed.windowMs !== undefined) body.windowMs = parsed.windowMs;
      if (parsed.slowThresholdMs !== undefined) body.slowThresholdMs = parsed.slowThresholdMs;
      if (parsed.stripQuery === false) body.stripQuery = false;
      const res = await fetchWithBearer(
        httpCtx,
        "POST",
        `/v1/agent/sessions/${sessionId}/actions`,
        body,
      );
      if (!res.ok) {
        const errText = await res.text();
        writeErr(`HTTP ${res.status}: ${errText}`);
        return exitCodeForHttpStatus(res.status);
      }
      const data = await readJson(res);
      printStructured(data, parsed.format, writeOut);
      return 0;
    }

    if (parsed.command === "console-observe") {
      const rt = await resolveTargetForAppFirst(parsed, httpCtx, sessionId, writeErr);
      if (!rt.ok) return rt.exit;
      const body: Record<string, unknown> = {
        action: "console-messages",
        targetId: rt.targetId,
      };
      if (parsed.waitMs !== undefined) body.waitMs = parsed.waitMs;
      const res = await fetchWithBearer(httpCtx, "POST", `/v1/agent/sessions/${sessionId}/actions`, body);
      if (!res.ok) {
        const errText = await res.text();
        writeErr(`HTTP ${res.status}: ${errText}`);
        return exitCodeForHttpStatus(res.status);
      }
      const data = await readJson(res);
      printStructured(data, parsed.format, writeOut);
      return 0;
    }

    if (parsed.command === "stack-observe") {
      const rt = await resolveTargetForAppFirst(parsed, httpCtx, sessionId, writeErr);
      if (!rt.ok) return rt.exit;
      const body: Record<string, unknown> = {
        action: "runtime-exception",
        targetId: rt.targetId,
      };
      if (parsed.waitMs !== undefined) body.waitMs = parsed.waitMs;
      const res = await fetchWithBearer(httpCtx, "POST", `/v1/agent/sessions/${sessionId}/actions`, body);
      if (!res.ok) {
        const errText = await res.text();
        writeErr(`HTTP ${res.status}: ${errText}`);
        return exitCodeForHttpStatus(res.status);
      }
      const data = await readJson(res);
      printStructured(data, parsed.format, writeOut);
      return 0;
    }

    if (parsed.command === "list-global") {
      const rt = await resolveTargetForAppFirst(parsed, httpCtx, sessionId, writeErr);
      if (!rt.ok) return rt.exit;
      const targetId = rt.targetId;

      const body: Record<string, unknown> = {
        action: "renderer-globals",
        targetId,
      };
      const ip = parsed.interestPattern?.trim();
      if (ip) body.interestPattern = ip;
      if (parsed.maxKeys !== undefined) body.maxKeys = parsed.maxKeys;
      const res = await fetchWithBearer(
        httpCtx,
        "POST",
        `/v1/agent/sessions/${sessionId}/actions`,
        body,
      );
      if (!res.ok) {
        const errText = await res.text();
        writeErr(`HTTP ${res.status}: ${errText}`);
        return exitCodeForHttpStatus(res.status);
      }
      const data = await readJson(res);
      printStructured(data, parsed.format, writeOut);
      return 0;
    }

    if (parsed.command === "explore") {
      const rt = await resolveTargetForAppFirst(parsed, httpCtx, sessionId, writeErr);
      if (!rt.ok) return rt.exit;
      const targetId = rt.targetId;

      const body: Record<string, unknown> = {
        action: "explore",
        targetId,
      };
      if (parsed.maxCandidates !== undefined) body.maxCandidates = parsed.maxCandidates;
      if (parsed.minScore !== undefined) body.minScore = parsed.minScore;
      if (parsed.includeAnchorButtons) body.includeAnchorButtons = true;
      const res = await fetchWithBearer(httpCtx, "POST", `/v1/agent/sessions/${sessionId}/actions`, body);
      if (!res.ok) {
        const errText = await res.text();
        writeErr(`HTTP ${res.status}: ${errText}`);
        return exitCodeForHttpStatus(res.status);
      }
      const data = await readJson(res);
      printStructured(data, parsed.format, writeOut);
      return 0;
    }

    const path =
      parsed.command === "snapshot"
        ? `/v1/agent/sessions/${sessionId}/snapshot`
        : parsed.command === "metrics"
          ? `/v1/sessions/${sessionId}/metrics`
          : `/v1/sessions/${sessionId}/list-window`;

    const res = await fetchWithBearer(httpCtx, "GET", path);
    if (!res.ok) {
      const errText = await res.text();
      writeErr(`HTTP ${res.status}: ${errText}`);
      return exitCodeForHttpStatus(res.status);
    }
    const data = await readJson(res);
    printStructured(data, parsed.format, writeOut);
    return 0;
  } catch (e) {
    if (e instanceof CoreUnreachableError) {
      printCoreUnreachableHelp(e.baseUrl, (line) => writeErr(line));
      return exitCodeForFetchError(e);
    }
    writeErr(e instanceof Error ? e.message : String(e));
    return exitCodeForFetchError(e);
  }
}
