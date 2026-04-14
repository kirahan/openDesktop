import { execFile, spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { AppDefinition, ProfileDefinition } from "../store/types.js";

const execFileAsync = promisify(execFile);

function isPgrepNoMatch(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const o = e as { code?: number | string; status?: number };
  return o.code === 1 || o.status === 1 || o.code === "1";
}

/** `pgrep` 将 pattern 视为扩展正则；对可执行路径做转义，避免 `.` 等被当作元字符导致误匹配 */
function escapePgrepExtendedRegex(literal: string): string {
  return literal.replace(/[.^$*+?()[\]{}|\\]/g, "\\$&");
}

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

/**
 * 父进程为「Electron 壳 spawn 的 Core」时，`process.env` 可能含 `ELECTRON_RUN_AS_NODE=1`（见 studio-electron-shell）。
 * 若原样传给被测 **Electron 应用**可执行文件，会按 Node 解释导致秒退（如 code=9）；终端手动启动无此变量故正常。
 */
function envWithoutElectronRunAsNode(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ELECTRON_RUN_AS_NODE: _era, ...rest } = base;
  return rest;
}

function mergeEnv(
  base: NodeJS.ProcessEnv,
  appEnv: Record<string, string>,
  profileEnv: Record<string, string>,
  cdpPort: number,
  proxy?: LaunchProxyEnv,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {
    ...envWithoutElectronRunAsNode(base),
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

function stableExecutablePath(executable: string): string {
  try {
    return realpathSync(executable);
  } catch {
    return path.resolve(executable);
  }
}

/**
 * 结束仍占用同一可执行文件的既有进程（常见于 Electron 单例锁：不先结束则新实例无法独占调试端口）。
 * 仅应在「Electron + 远程调试端口」类启动路径上调用；勿对通用解释器（如 node）在未限定场景下使用。
 */
export async function killExistingProcessesForExecutable(executable: string): Promise<void> {
  const target = stableExecutablePath(executable);
  const selfPid = process.pid;

  if (process.platform === "win32") {
    await killWindowsByExecutablePath(target);
    return;
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("pgrep", ["-f", escapePgrepExtendedRegex(target)], {
      encoding: "utf8",
    }));
  } catch (e: unknown) {
    if (isPgrepNoMatch(e)) return;
    throw e;
  }

  const pids = stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n !== selfPid);

  for (const pid of [...new Set(pids)]) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ESRCH 等：进程已退出 */
    }
  }
}

async function killWindowsByExecutablePath(executable: string): Promise<void> {
  const cmd = `$p='${executable.replace(/'/g, "''")}'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $p } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], {
    windowsHide: true,
  });
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
