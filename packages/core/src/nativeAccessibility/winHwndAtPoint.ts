import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** HWND 矩形与元数据（屏幕像素）。 */
export type Win32HwndInfo = {
  hwnd: number;
  title: string;
  className: string;
  rect: { x: number; y: number; width: number; height: number };
};

export type WinHwndAtPointOk = {
  ok: true;
  screenX: number;
  screenY: number;
  topLevel: Win32HwndInfo | null;
  leafAtPoint: Win32HwndInfo | null;
  realChildOfRoot: Win32HwndInfo | null;
};

export type WinHwndAtPointErr = { ok: false; code: string; message: string };

export type WinHwndAtPointResult = WinHwndAtPointOk | WinHwndAtPointErr;

export function resolveHwndAtPointScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, "..", "..");
  return path.join(pkgRoot, "native-windows", "hwnd-at-point.ps1");
}

/** 解析 PowerShell stdout（单行 JSON）。 */
export function parseWinHwndAtPointStdout(raw: string): WinHwndAtPointResult {
  const t = raw.replace(/^\uFEFF/, "").trim();
  if (!t.startsWith("{")) {
    return { ok: false, code: "PARSE_FAILED", message: t.slice(0, 200) || "empty stdout" };
  }
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    if (j.ok === true && typeof j.screenX === "number" && typeof j.screenY === "number") {
      return {
        ok: true,
        screenX: j.screenX,
        screenY: j.screenY,
        topLevel: (j.topLevel ?? null) as Win32HwndInfo | null,
        leafAtPoint: (j.leafAtPoint ?? null) as Win32HwndInfo | null,
        realChildOfRoot: (j.realChildOfRoot ?? null) as Win32HwndInfo | null,
      };
    }
    if (j.ok === false && typeof j.code === "string" && typeof j.message === "string") {
      return { ok: false, code: j.code, message: j.message };
    }
    return { ok: false, code: "PARSE_FAILED", message: "unexpected JSON shape" };
  } catch {
    return { ok: false, code: "PARSE_FAILED", message: t.slice(0, 200) };
  }
}

/**
 * Windows：屏幕坐标处 WindowFromPoint，校验 PID，返回顶层与命中 HWND 矩形（user32）。
 */
export function dumpWin32HwndAtPoint(
  pid: number,
  options: { screenX: number; screenY: number },
): Promise<WinHwndAtPointResult> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ ok: false, code: "PLATFORM_UNSUPPORTED", message: "HWND 几何仅支持 win32" });
      return;
    }
    if (!Number.isFinite(pid) || pid <= 0) {
      resolve({ ok: false, code: "INVALID_PID", message: "invalid pid" });
      return;
    }
    const scriptPath = resolveHwndAtPointScriptPath();
    if (!existsSync(scriptPath)) {
      resolve({ ok: false, code: "SCRIPT_MISSING", message: `缺少脚本 ${scriptPath}` });
      return;
    }

    const payload = JSON.stringify({
      sessionPid: pid,
      screenX: options.screenX,
      screenY: options.screenY,
    });

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        env: { ...process.env, OD_HWND_AT_POINT_INPUT: payload },
        windowsHide: true,
      },
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let finished = false;
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, code: "TIMEOUT", message: "HWND 采集超时（60s）" });
    }, 60_000);

    const done = (r: WinHwndAtPointResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(r);
    };

    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));
    child.on("error", (e: NodeJS.ErrnoException) => {
      done({ ok: false, code: "SPAWN_FAILED", message: e.message });
    });
    child.on("close", (code) => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const errText = Buffer.concat(errChunks).toString("utf8").trim();
      if (!raw.trim() && errText) {
        done({ ok: false, code: "POWERSHELL_FAILED", message: errText.slice(0, 400) });
        return;
      }
      const parsed = parseWinHwndAtPointStdout(raw);
      if (!parsed.ok && code !== 0 && parsed.code === "PARSE_FAILED") {
        done({
          ok: false,
          code: "POWERSHELL_FAILED",
          message: errText || raw.slice(0, 200) || `exit ${code}`,
        });
        return;
      }
      done(parsed);
    });
  });
}
