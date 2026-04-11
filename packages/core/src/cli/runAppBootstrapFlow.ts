import type { Command } from "commander";
import { exitCodeForHttpStatus } from "./mapHttpToExit.js";
import {
  appIdExists,
  formatAppIdConflictMessage,
  parseAppIdsFromListJson,
} from "./appRegistrationHelpers.js";

export type ApiFetchFn = (
  cmd: Command,
  method: string,
  apiPath: string,
  body?: unknown,
) => Promise<Response>;

export interface BootstrapFlowInput {
  appId: string;
  executable: string;
  cwd: string;
  args: string[];
  injectElectronDebugPort: boolean;
  /** 默认 Profile 的 id，例如 myapp-default */
  profileId: string;
  profileDisplayName: string;
  startSession: boolean;
}

/**
 * 顺序执行：校验 id 未占用 → POST /v1/apps → POST /v1/profiles → 可选 POST /v1/sessions。
 * 供 CLI `app create` 与单测注入 `apiFetch`。
 */
export async function runAppBootstrapFlow(
  apiFetch: ApiFetchFn,
  program: Command,
  input: BootstrapFlowInput,
): Promise<
  | { ok: true; messages: string[]; sessionResponseText?: string }
  | { ok: false; exitCode: number; messages: string[] }
> {
  const messages: string[] = [];

  const listRes = await apiFetch(program, "GET", "/v1/apps");
  const listRaw = await listRes.text();
  if (!listRes.ok) {
    return {
      ok: false,
      exitCode: exitCodeForHttpStatus(listRes.status),
      messages: [`拉取应用列表失败: HTTP ${listRes.status} ${listRaw.slice(0, 200)}`],
    };
  }
  if (appIdExists(parseAppIdsFromListJson(listRaw), input.appId)) {
    return {
      ok: false,
      exitCode: 2,
      messages: [formatAppIdConflictMessage(input.appId)],
    };
  }

  const appRes = await apiFetch(program, "POST", "/v1/apps", {
    id: input.appId,
    name: input.appId,
    executable: input.executable,
    cwd: input.cwd,
    args: input.args,
    env: {},
    injectElectronDebugPort: input.injectElectronDebugPort,
  });
  const appRaw = await appRes.text();
  if (!appRes.ok) {
    return {
      ok: false,
      exitCode: exitCodeForHttpStatus(appRes.status),
      messages: [appRaw.slice(0, 400)],
    };
  }
  messages.push("已创建应用");
  // 与 `app create` 一致，将 Core 返回体打印到 stdout
  console.log(appRaw);

  const profRes = await apiFetch(program, "POST", "/v1/profiles", {
    id: input.profileId,
    appId: input.appId,
    name: input.profileDisplayName,
    env: {},
    extraArgs: [],
  });
  const profRaw = await profRes.text();
  if (profRes.status === 409) {
    messages.push(`Profile ${input.profileId} 已存在，跳过创建`);
  } else if (!profRes.ok) {
    return {
      ok: false,
      exitCode: exitCodeForHttpStatus(profRes.status),
      messages: [profRaw.slice(0, 400)],
    };
  } else {
    messages.push(`已创建默认 Profile（profileId=${input.profileId}）`);
    console.log(profRaw);
  }


  let sessionResponseText: string | undefined;
  if (input.startSession) {
    const sessRes = await apiFetch(program, "POST", "/v1/sessions", {
      profileId: input.profileId,
    });
    sessionResponseText = await sessRes.text();
    if (!sessRes.ok) {
      return {
        ok: false,
        exitCode: exitCodeForHttpStatus(sessRes.status),
        messages: [...messages, `创建会话失败: ${sessionResponseText.slice(0, 400)}`],
      };
    }
    messages.push("已创建会话");
    console.log(sessionResponseText);
  } else {
    messages.push(`下一步：yarn oc session start ${input.profileId}`);
  }

  return { ok: true, messages, sessionResponseText };
}
