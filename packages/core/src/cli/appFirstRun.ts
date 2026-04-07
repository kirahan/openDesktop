import { EX_NOINPUT, EX_USAGE } from "./exitCodes.js";
import type { CliHttpContext } from "./httpClient.js";
import { buildCliHttpContext, fetchWithBearer } from "./httpClient.js";
import { exitCodeForFetchError, exitCodeForHttpStatus } from "./mapHttpToExit.js";
import type { AppFirstParseOk } from "./parseAppFirstArgv.js";
import { printStructured } from "./output.js";
import { pickLatestActiveSessionForApp, type ProfileRow, type SessionRow } from "./sessionResolve.js";

async function readJson(res: Response): Promise<unknown> {
  const t = await res.text();
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return { raw: t };
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

  const path =
    parsed.command === "snapshot"
      ? `/v1/agent/sessions/${sessionId}/snapshot`
      : parsed.command === "metrics"
        ? `/v1/sessions/${sessionId}/metrics`
        : `/v1/sessions/${sessionId}/list-window`;

  try {
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
    writeErr(e instanceof Error ? e.message : String(e));
    return exitCodeForFetchError(e);
  }
}
