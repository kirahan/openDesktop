/**
 * 全局鼠标屏幕坐标：darwin 使用 nut-js；win32 使用 PowerShell 调 GetCursorPos。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MousePositionResult =
  | { ok: true; x: number; y: number }
  | { ok: false; code: "MOUSE_POSITION_UNAVAILABLE"; message: string };

const WIN_GET_CURSOR_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OdCursorPos {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
}
"@
$p = New-Object OdCursorPos+POINT
[void][OdCursorPos]::GetCursorPos([ref]$p)
Write-Output ($p.X.ToString() + "," + $p.Y.ToString())
`.trim();

export async function getGlobalMousePosition(): Promise<MousePositionResult> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", WIN_GET_CURSOR_PS],
        { windowsHide: true, timeout: 5000, maxBuffer: 4096 },
      );
      const line = stdout.trim().replace(/^\uFEFF/, "");
      const parts = line.split(",");
      const x = Number.parseInt(parts[0] ?? "", 10);
      const y = Number.parseInt(parts[1] ?? "", 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return {
          ok: false,
          code: "MOUSE_POSITION_UNAVAILABLE",
          message: "无法解析 GetCursorPos 输出",
        };
      }
      return { ok: true, x, y };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        code: "MOUSE_POSITION_UNAVAILABLE",
        message: msg.slice(0, 240) || "GetCursorPos failed",
      };
    }
  }

  if (process.platform !== "darwin") {
    return {
      ok: false,
      code: "MOUSE_POSITION_UNAVAILABLE",
      message: "全局鼠标坐标仅在 macOS 与 Windows 上可用",
    };
  }
  try {
    const { mouse } = await import("@nut-tree/nut-js");
    const p = await mouse.getPosition();
    return { ok: true, x: Math.round(p.x), y: Math.round(p.y) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      code: "MOUSE_POSITION_UNAVAILABLE",
      message: msg.slice(0, 240) || "mouse.getPosition failed",
    };
  }
}
