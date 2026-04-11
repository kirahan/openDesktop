import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type ResolveWindowsShortcutResult =
  | {
      targetPath: string;
      arguments: string;
      workingDirectory: string;
    }
  | { error: string; message: string };

/** 去掉首尾空白与成对引号（用户从资源管理器复制时常带引号） */
export function normalizeWindowsShortcutInput(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/^[\u201c\u201f\u201d]+|[\u201c\u201f\u201d]+$/g, "").trim();
}

/**
 * 使用本机 PowerShell + WScript.Shell 解析 Windows `.lnk` 快捷方式（需 Core 跑在 Windows 上）。
 */
export function resolveWindowsShortcutFromPath(lnkPath: string): Promise<ResolveWindowsShortcutResult> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ error: "PLATFORM_UNSUPPORTED", message: "仅支持在 Windows 上解析 .lnk" });
      return;
    }
    const trimmed = normalizeWindowsShortcutInput(lnkPath);
    if (!trimmed.toLowerCase().endsWith(".lnk")) {
      resolve({ error: "NOT_LNK", message: "路径须以 .lnk 结尾" });
      return;
    }
    if (!path.win32.isAbsolute(trimmed)) {
      resolve({
        error: "PATH_NOT_ABSOLUTE",
        message:
          "需要快捷方式的完整绝对路径（须含盘符，例如 C:\\\\Users\\\\你的名字\\\\Desktop\\\\应用.lnk）。若「浏览」后只有文件名，请在资源管理器中 Shift+右键快捷方式选择「复制为路径」，或打开快捷方式所在文件夹从地址栏复制后粘贴。",
      });
      return;
    }
    if (!existsSync(trimmed)) {
      resolve({
        error: "NOT_FOUND",
        message:
          "在当前路径下找不到该 .lnk 文件。请确认路径正确、文件未被移动；若从网页「浏览」只得到文件名，也必须改为上述完整路径。",
      });
      return;
    }

    const ps = `
$ErrorActionPreference = 'Stop'
try {
  $p = $env:OPENDESKTOP_LNK_RESOLVE_PATH
  $wsh = New-Object -ComObject WScript.Shell
  $sc = $wsh.CreateShortcut($p)
  $o = @{
    targetPath = [string]$sc.TargetPath
    arguments = [string]$sc.Arguments
    workingDirectory = [string]$sc.WorkingDirectory
  }
  $o | ConvertTo-Json -Compress
} catch {
  $e = @{ error = 'RESOLVE_FAILED'; message = $_.Exception.Message } | ConvertTo-Json -Compress
  Write-Output $e
}
`.trim();

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NoLogo", "-NonInteractive", "-STA", "-Command", ps],
      {
        env: { ...process.env, OPENDESKTOP_LNK_RESOLVE_PATH: trimmed },
        windowsHide: true,
      },
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let finished = false;

    const done = (result: ResolveWindowsShortcutResult) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      done({ error: "TIMEOUT", message: "解析超时" });
    }, 15_000);

    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "ENOENT") {
        done({ error: "POWERSHELL_UNAVAILABLE", message: "未找到 powershell.exe" });
        return;
      }
      done({ error: "SPAWN_FAILED", message: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      const errText = Buffer.concat(errChunks).toString("utf8").trim();
      if (!raw) {
        done({
          error: "EMPTY_OUTPUT",
          message: errText || (code !== 0 ? `退出码 ${code ?? "unknown"}` : "无输出"),
        });
        return;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed.error === "string" && parsed.error === "RESOLVE_FAILED") {
          done({
            error: "RESOLVE_FAILED",
            message: typeof parsed.message === "string" ? parsed.message : "解析失败",
          });
          return;
        }
        if (typeof parsed.error === "string") {
          done({
            error: parsed.error,
            message: typeof parsed.message === "string" ? parsed.message : "解析失败",
          });
          return;
        }
        const targetPath = parsed.targetPath;
        if (typeof targetPath !== "string" || !targetPath.trim()) {
          done({ error: "NO_TARGET", message: "快捷方式未指向有效目标路径" });
          return;
        }
        done({
          targetPath: targetPath.trim(),
          arguments: typeof parsed.arguments === "string" ? parsed.arguments : "",
          workingDirectory: typeof parsed.workingDirectory === "string" ? parsed.workingDirectory : "",
        });
      } catch {
        done({ error: "PARSE_FAILED", message: raw.slice(0, 200) });
      }
    });
  });
}
