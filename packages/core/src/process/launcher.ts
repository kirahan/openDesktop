import { spawn, type ChildProcess } from "node:child_process";
import type { AppDefinition, ProfileDefinition } from "../store/types.js";

export interface LaunchedProcess {
  child: ChildProcess;
  cdpPort: number;
}

/** 进程级代理环境（非系统全局）；与本地转发代理端口对应 */
export interface LaunchProxyEnv {
  httpProxyUrl: string;
  httpsProxyUrl: string;
  noProxy: string;
}

function mergeEnv(
  base: NodeJS.ProcessEnv,
  appEnv: Record<string, string>,
  profileEnv: Record<string, string>,
  cdpPort: number,
  proxy?: LaunchProxyEnv,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {
    ...base,
    ...appEnv,
    ...profileEnv,
    CDP_PORT: String(cdpPort),
  };
  if (proxy) {
    merged.HTTP_PROXY = proxy.httpProxyUrl;
    merged.HTTPS_PROXY = proxy.httpsProxyUrl;
    merged.NO_PROXY = proxy.noProxy;
  }
  return merged;
}

function buildArgv(
  app: AppDefinition,
  profile: ProfileDefinition,
  cdpPort: number,
): string[] {
  const base = [...app.args, ...profile.extraArgs];
  if (app.injectElectronDebugPort) {
    return [...base, `--remote-debugging-port=${cdpPort}`];
  }
  return base;
}

export function launchDebuggedApp(
  app: AppDefinition,
  profile: ProfileDefinition,
  cdpPort: number,
  proxyEnv?: LaunchProxyEnv,
): LaunchedProcess {
  const env = mergeEnv(process.env, app.env, profile.env, cdpPort, proxyEnv);
  const argv = buildArgv(app, profile, cdpPort);
  const child = spawn(app.executable, argv, {
    cwd: app.cwd || process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return { child, cdpPort };
}
