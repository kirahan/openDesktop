import { spawn, type ChildProcess } from "node:child_process";
import type { AppDefinition, ProfileDefinition } from "../store/types.js";

export interface LaunchedProcess {
  child: ChildProcess;
  cdpPort: number;
}

function mergeEnv(
  base: NodeJS.ProcessEnv,
  appEnv: Record<string, string>,
  profileEnv: Record<string, string>,
  cdpPort: number,
): NodeJS.ProcessEnv {
  return {
    ...base,
    ...appEnv,
    ...profileEnv,
    CDP_PORT: String(cdpPort),
  };
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
): LaunchedProcess {
  const env = mergeEnv(process.env, app.env, profile.env, cdpPort);
  const argv = buildArgv(app, profile, cdpPort);
  const child = spawn(app.executable, argv, {
    cwd: app.cwd || process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return { child, cdpPort };
}
