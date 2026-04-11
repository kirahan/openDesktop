import { readFile } from "node:fs/promises";
import process from "node:process";
import { loadConfig } from "../config.js";
import { CoreUnreachableError } from "./coreUnreachable.js";
import { EX_CONFIG, EX_NOPERM, EX_UNAVAILABLE } from "./exitCodes.js";
import { buildCliHttpContext, fetchPublicBase, fetchWithBearer } from "./httpClient.js";
import { pickLatestActiveSessionForApp, type ProfileRow, type SessionRow } from "./sessionResolve.js";

export interface DoctorOpts {
  apiUrl?: string;
  tokenFile?: string;
  format: "table" | "json";
  app?: string;
}

async function readJson(res: Response): Promise<unknown> {
  const t = await res.text();
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return { raw: t };
  }
}

export async function runDoctor(
  opts: DoctorOpts,
  writeOut: (s: string) => void,
  _writeErr: (s: string) => void,
): Promise<number> {
  const baseUrl = (opts.apiUrl ?? process.env.OPENDESKTOP_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

  let coreOk = false;
  let coreDetail = "";
  try {
    const res = await fetchPublicBase(baseUrl, "/v1/version");
    coreOk = res.ok;
    coreDetail = coreOk ? `HTTP ${res.status}` : `HTTP ${res.status}`;
    if (!res.ok) {
      const t = await res.text();
      coreDetail = `${coreDetail} ${t.slice(0, 200)}`;
    }
  } catch (e) {
    coreDetail =
      e instanceof CoreUnreachableError ? "无法连接（请先启动 Core）" : e instanceof Error ? e.message : String(e);
  }

  let tokenPath = "";
  let tokenReadOk = false;
  let tokenErr = "";
  try {
    const cfg = loadConfig({ tokenFile: opts.tokenFile });
    tokenPath = cfg.tokenFile;
    await readFile(cfg.tokenFile, "utf8");
    tokenReadOk = true;
  } catch (e) {
    tokenErr = e instanceof Error ? e.message : String(e);
  }

  let authOk = false;
  let authDetail = "";
  if (tokenReadOk) {
    try {
      const ctx = await buildCliHttpContext({ apiUrl: opts.apiUrl, tokenFile: opts.tokenFile });
      const res = await fetchWithBearer(ctx, "GET", "/v1/apps");
      authOk = res.ok;
      authDetail = `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        authDetail = "Bearer 无效或缺失";
      }
    } catch (e) {
      authDetail =
        e instanceof CoreUnreachableError ? "无法连接（请先启动 Core）" : e instanceof Error ? e.message : String(e);
    }
  }

  let appSessionOk: boolean | null = null;
  let appSessionDetail = "";
  if (opts.app && tokenReadOk && authOk) {
    try {
      const ctx = await buildCliHttpContext({ apiUrl: opts.apiUrl, tokenFile: opts.tokenFile });
      const [sRes, pRes] = await Promise.all([
        fetchWithBearer(ctx, "GET", "/v1/sessions"),
        fetchWithBearer(ctx, "GET", "/v1/profiles"),
      ]);
      if (!sRes.ok || !pRes.ok) {
        appSessionOk = false;
        appSessionDetail = `sessions=${sRes.ok} profiles=${pRes.ok}`;
      } else {
        const sdata = (await readJson(sRes)) as { sessions?: SessionRow[] };
        const pdata = (await readJson(pRes)) as { profiles?: ProfileRow[] };
        const picked = pickLatestActiveSessionForApp(sdata.sessions ?? [], pdata.profiles ?? [], opts.app);
        appSessionOk = picked !== null;
        appSessionDetail = picked ? `sessionId=${picked.id}` : "无活跃会话";
      }
    } catch (e) {
      appSessionOk = false;
      appSessionDetail =
        e instanceof CoreUnreachableError ? "无法连接（请先启动 Core）" : e instanceof Error ? e.message : String(e);
    }
  }

  const checks = {
    core: { ok: coreOk, url: baseUrl, detail: coreDetail },
    token: { ok: tokenReadOk, path: tokenPath, detail: tokenErr || "ok" },
    auth: { ok: authOk && tokenReadOk, detail: authDetail },
    ...(opts.app
      ? {
          appSession: {
            ok: appSessionOk === true,
            appId: opts.app,
            detail: appSessionDetail,
            skipped: false,
          },
        }
      : {}),
  };

  if (opts.format === "json") {
    writeOut(`${JSON.stringify({ checks }, null, 2)}\n`);
  } else {
    writeOut(`Core  ${coreOk ? "ok" : "FAIL"}  ${baseUrl}  ${coreDetail}\n`);
    writeOut(`Token ${tokenReadOk ? "ok" : "FAIL"}  ${tokenPath || "(unknown)"}  ${tokenErr || ""}\n`);
    writeOut(`Auth  ${authOk && tokenReadOk ? "ok" : "FAIL"}  ${authDetail}\n`);
    if (opts.app) {
      writeOut(
        `App   ${appSessionOk ? "ok" : "FAIL"}  ${opts.app}  ${appSessionDetail}\n`,
      );
    }
  }

  if (!coreOk) return EX_UNAVAILABLE;
  if (!tokenReadOk) return EX_CONFIG;
  if (!authOk) return EX_NOPERM;
  if (opts.app && appSessionOk === false) return EX_UNAVAILABLE;

  return 0;
}
