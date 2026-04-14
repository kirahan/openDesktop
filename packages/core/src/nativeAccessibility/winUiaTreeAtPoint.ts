import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MacAxDumpResult } from "./macAxTree.js";
import { parseMacAxTreeStdout } from "./macAxTree.js";
import type { MacAxAtPointResult } from "./macAxTreeAtPoint.js";
import { parseMacAxAtPointStdout } from "./macAxTreeAtPoint.js";

/** Resolved path to `native-windows/uia-at-point.ps1` (next to package root). */
export function resolveUiaAtPointScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, "..", "..");
  return path.join(pkgRoot, "native-windows", "uia-at-point.ps1");
}

/** Resolved path to `native-windows/uia-full-tree.ps1` (next to package root). */
export function resolveUiaFullTreeScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, "..", "..");
  return path.join(pkgRoot, "native-windows", "uia-full-tree.ps1");
}

/**
 * Windows: enumerate UI Automation tree for top-level windows of the given process (see PowerShell script).
 * JSON shape matches macOS `dumpMacAccessibilityTree` for HTTP responses.
 */
export function dumpWinAccessibilityTree(
  pid: number,
  options: { maxDepth: number; maxNodes: number },
): Promise<MacAxDumpResult> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ ok: false, code: "PLATFORM_UNSUPPORTED", message: "Windows UI Automation 整树仅支持 win32" });
      return;
    }
    if (!Number.isFinite(pid) || pid <= 0) {
      resolve({ ok: false, code: "INVALID_PID", message: "invalid pid" });
      return;
    }
    const scriptPath = resolveUiaFullTreeScriptPath();
    if (!existsSync(scriptPath)) {
      resolve({
        ok: false,
        code: "SCRIPT_MISSING",
        message: `缺少脚本 ${scriptPath}`,
      });
      return;
    }

    const payload = JSON.stringify({
      sessionPid: pid,
      maxDepth: options.maxDepth,
      maxNodes: options.maxNodes,
    });

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        env: { ...process.env, OD_UIA_FULL_TREE_INPUT: payload },
        windowsHide: true,
      },
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let finished = false;
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, code: "TIMEOUT", message: "整树无障碍采集超时（120s）" });
    }, 120_000);

    const done = (r: MacAxDumpResult) => {
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
      const parsed = parseMacAxTreeStdout(raw);
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

/**
 * Windows: UI Automation hit-test at screen point, scoped by session PID (see PowerShell script).
 */
export function dumpWinAccessibilityAtPoint(
  pid: number,
  options: {
    screenX: number;
    screenY: number;
    maxAncestorDepth: number;
    maxLocalDepth: number;
    maxNodes: number;
  },
): Promise<MacAxAtPointResult> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ ok: false, code: "PLATFORM_UNSUPPORTED", message: "Windows UI Automation 仅支持 win32" });
      return;
    }
    if (!Number.isFinite(pid) || pid <= 0) {
      resolve({ ok: false, code: "INVALID_PID", message: "invalid pid" });
      return;
    }
    const scriptPath = resolveUiaAtPointScriptPath();
    if (!existsSync(scriptPath)) {
      resolve({
        ok: false,
        code: "SCRIPT_MISSING",
        message: `缺少脚本 ${scriptPath}`,
      });
      return;
    }

    const payload = JSON.stringify({
      sessionPid: pid,
      screenX: options.screenX,
      screenY: options.screenY,
      maxAncestorDepth: options.maxAncestorDepth,
      maxLocalDepth: options.maxLocalDepth,
      maxNodes: options.maxNodes,
    });

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        env: { ...process.env, OD_UIA_INPUT: payload },
        windowsHide: true,
      },
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let finished = false;
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, code: "TIMEOUT", message: "按点无障碍采集超时（120s）" });
    }, 120_000);

    const done = (r: MacAxAtPointResult) => {
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
      const parsed = parseMacAxAtPointStdout(raw);
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
