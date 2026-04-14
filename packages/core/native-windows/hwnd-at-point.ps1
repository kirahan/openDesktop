#Requires -Version 5.1
# Input: JSON in env OD_HWND_AT_POINT_INPUT (sessionPid, screenX, screenY)
# Output: single JSON line — WindowFromPoint + PID 校验 + 顶层矩形 + 命中 HWND + RealChildWindowFromPoint

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class OdHwndAtPoint {
  public const uint GA_ROOT = 2;

  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT pt);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);
  [DllImport("user32.dll")] public static extern IntPtr RealChildWindowFromPoint(IntPtr hwndParent, POINT ptClient);

  public static uint GetProcessId(IntPtr hWnd) {
    uint pid = 0;
    GetWindowThreadProcessId(hWnd, out pid);
    return pid;
  }

  public static string WinText(IntPtr h) {
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    return sb.ToString();
  }

  public static string WinClass(IntPtr h) {
    var sb = new StringBuilder(512);
    GetClassName(h, sb, 512);
    return sb.ToString();
  }
}
"@ -ErrorAction Stop

function RectToObj([OdHwndAtPoint+RECT]$r) {
  return [ordered]@{
    x = [double]$r.Left
    y = [double]$r.Top
    width = [double]($r.Right - $r.Left)
    height = [double]($r.Bottom - $r.Top)
  }
}

function HwndShallow($h) {
  if ($h -eq [IntPtr]::Zero) { return $null }
  $rc = New-Object OdHwndAtPoint+RECT
  if (-not [OdHwndAtPoint]::GetWindowRect([IntPtr]$h, [ref]$rc)) { return $null }
  return [ordered]@{
    hwnd = [int64]$h.ToInt64()
    title = [OdHwndAtPoint]::WinText($h)
    className = [OdHwndAtPoint]::WinClass($h)
    rect = (RectToObj $rc)
  }
}

$raw = $env:OD_HWND_AT_POINT_INPUT
if (-not $raw) {
  $e = @{ ok = $false; code = "PARSE_FAILED"; message = "OD_HWND_AT_POINT_INPUT missing" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($e)
  exit 1
}

$opts = $raw | ConvertFrom-Json
$sessionPid = [int]$opts.sessionPid
$screenX = [double]$opts.screenX
$screenY = [double]$opts.screenY

$pt = New-Object OdHwndAtPoint+POINT
$pt.X = [int][Math]::Round($screenX)
$pt.Y = [int][Math]::Round($screenY)

$hLeaf = [OdHwndAtPoint]::WindowFromPoint($pt)
if ($hLeaf -eq [IntPtr]::Zero) {
  $e = @{ ok = $false; code = "NO_HWND_AT_POINT"; message = "WindowFromPoint returned null" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($e)
  exit 0
}

try {
  $hitPid = [int][OdHwndAtPoint]::GetProcessId($hLeaf)
} catch {
  $err = @{ ok = $false; code = "WIN32_FAILED"; message = $_.Exception.Message } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($err)
  exit 1
}

if ($hitPid -ne $sessionPid) {
  $e = @{ ok = $false; code = "HIT_OUTSIDE_SESSION"; message = "hit process $hitPid does not match session pid $sessionPid" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($e)
  exit 0
}

$hRoot = [OdHwndAtPoint]::GetAncestor($hLeaf, [OdHwndAtPoint]::GA_ROOT)
if ($hRoot -eq [IntPtr]::Zero) { $hRoot = $hLeaf }

$top = HwndShallow $hRoot
$leaf = HwndShallow $hLeaf

$realChild = $null
if ($hRoot -ne [IntPtr]::Zero -and $top -ne $null) {
  $pc = New-Object OdHwndAtPoint+POINT
  $pc.X = $pt.X
  $pc.Y = $pt.Y
  if ([OdHwndAtPoint]::ScreenToClient($hRoot, [ref]$pc)) {
    $hRc = [OdHwndAtPoint]::RealChildWindowFromPoint($hRoot, $pc)
    if ($hRc -ne [IntPtr]::Zero) {
      $realChild = HwndShallow $hRc
    }
  }
}

$out = [ordered]@{
  ok = $true
  screenX = $screenX
  screenY = $screenY
  topLevel = $top
  leafAtPoint = $leaf
  realChildOfRoot = $realChild
}
$json = ($out | ConvertTo-Json -Depth 12 -Compress)
[Console]::Out.WriteLine($json)
exit 0
