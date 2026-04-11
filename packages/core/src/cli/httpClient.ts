import { readFile } from "node:fs/promises";
import process from "node:process";
import { loadConfig } from "../config.js";
import { CoreUnreachableError, isCoreUnreachableError } from "./coreUnreachable.js";

export interface CliHttpContext {
  baseUrl: string;
  token: string;
  tokenFile: string;
}

export async function buildCliHttpContext(opts: {
  apiUrl?: string;
  tokenFile?: string;
}): Promise<CliHttpContext> {
  const config = loadConfig({ tokenFile: opts.tokenFile });
  const baseUrl = (opts.apiUrl ?? process.env.OPENDESKTOP_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const token = (await readFile(config.tokenFile, "utf8")).trim();
  return { baseUrl, token, tokenFile: config.tokenFile };
}

export async function fetchWithBearer(
  ctx: CliHttpContext,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<Response> {
  const url = `${ctx.baseUrl}${apiPath}`;
  try {
    return await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (isCoreUnreachableError(e)) {
      throw new CoreUnreachableError(ctx.baseUrl);
    }
    throw e;
  }
}

export async function fetchPublicBase(baseUrl: string, apiPath: string): Promise<Response> {
  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}${apiPath}`;
  try {
    return await fetch(url, { method: "GET" });
  } catch (e) {
    if (isCoreUnreachableError(e)) {
      throw new CoreUnreachableError(base);
    }
    throw e;
  }
}
