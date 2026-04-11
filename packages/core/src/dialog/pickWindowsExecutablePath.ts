import { spawn } from "node:child_process";

export type PickWindowsExecutablePathResult =
  | { path: string }
  | { cancelled: true }
  | { error: string; message: string };

/**
 * 在本机图形会话中弹出 Windows「打开文件」对话框（PowerShell + WinForms）。
 * 仅 `win32`；无桌面/服务会话可能失败。
 */
export function pickWindowsExecutablePath(): Promise<PickWindowsExecutablePathResult> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ error: "PLATFORM_UNSUPPORTED", message: "仅 Windows 支持系统文件对话框" });
      return;
    }

    const ps = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $ofd = New-Object System.Windows.Forms.OpenFileDialog
  $ofd.Filter = '可执行文件与快捷方式|*.exe;*.lnk;*.bat;*.cmd;*.ps1|所有文件|*.*'
  $ofd.Title = 'OpenDesktop：选择可执行文件或快捷方式'
  [void][System.Windows.Forms.Application]::EnableVisualStyles()
  $dr = $ofd.ShowDialog()
  if ($dr -ne [System.Windows.Forms.DialogResult]::OK) {
    @{ cancelled = $true } | ConvertTo-Json -Compress
  } else {
    $fp = [string]$ofd.FileName
    if (-not $fp) {
      @{ error = 'EMPTY_PATH'; message = '未选择文件' } | ConvertTo-Json -Compress
    } else {
      @{ path = $fp } | ConvertTo-Json -Compress
    }
  }
} catch {
  @{ error = 'DIALOG_FAILED'; message = $_.Exception.Message } | ConvertTo-Json -Compress
}
`.trim();

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NoLogo", "-NonInteractive", "-STA", "-Command", ps],
      { windowsHide: true },
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let finished = false;

    const done = (result: PickWindowsExecutablePathResult) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      done({ error: "TIMEOUT", message: "等待对话框超时（10 分钟）" });
    }, 600_000);

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
    child.on("close", () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      const errText = Buffer.concat(errChunks).toString("utf8").trim();
      if (!raw) {
        done({
          error: "EMPTY_OUTPUT",
          message: errText || "无输出",
        });
        return;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.cancelled === true) {
          done({ cancelled: true });
          return;
        }
        if (typeof parsed.error === "string") {
          done({
            error: parsed.error,
            message: typeof parsed.message === "string" ? parsed.message : "对话框失败",
          });
          return;
        }
        if (typeof parsed.path === "string" && parsed.path.trim()) {
          done({ path: parsed.path.trim() });
          return;
        }
        done({ error: "PARSE_FAILED", message: raw.slice(0, 200) });
      } catch {
        done({ error: "PARSE_FAILED", message: raw.slice(0, 200) });
      }
    });
  });
}
