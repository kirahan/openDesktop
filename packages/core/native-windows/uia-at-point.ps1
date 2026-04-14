#Requires -Version 5.1
# Input: JSON in env OD_UIA_INPUT (sessionPid, screenX, screenY, maxAncestorDepth, maxLocalDepth, maxNodes)
# Output: single JSON line to stdout (Mac-compatible ok shape or ok:false)

$ErrorActionPreference = "Stop"

function ElemToNode($el, $depthRemaining, [ref]$nodeCounter, $maxNodes) {
  if ($null -eq $el) { return $null }
  if ($nodeCounter.Value -ge $maxNodes) { return $null }
  $nodeCounter.Value++

  $role = ""
  $title = $null
  $value = $null
  try { $role = $el.Current.LocalizedControlType } catch { $role = "unknown" }
  try { $title = $el.Current.Name } catch { }
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($null -ne $vp) { $value = $vp.Current.Value }
  } catch { }

  $children = @()
  if ($depthRemaining -gt 0 -and $nodeCounter.Value -lt $maxNodes) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $ch = $walker.GetFirstChild($el)
    while ($null -ne $ch -and $nodeCounter.Value -lt $maxNodes) {
      $sub = ElemToNode $ch ($depthRemaining - 1) $nodeCounter $maxNodes
      if ($null -ne $sub) { $children += $sub }
      $ch = $walker.GetNextSibling($ch)
    }
  }

  return [ordered]@{
    role  = $role
    title = $title
    value = $value
    children = $children
  }
}

function ElemToShallow($el) {
  if ($null -eq $el) { return $null }
  $role = ""
  $title = $null
  $value = $null
  try { $role = $el.Current.LocalizedControlType } catch { $role = "unknown" }
  try { $title = $el.Current.Name } catch { }
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($null -ne $vp) { $value = $vp.Current.Value }
  } catch { }
  return [ordered]@{ role = $role; title = $title; value = $value }
}

try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop | Out-Null
  Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop | Out-Null
  Add-Type -AssemblyName WindowsBase -ErrorAction Stop | Out-Null
} catch {
  $err = @{ ok = $false; code = "ACCESSIBILITY_DISABLED"; message = "Failed to load UI Automation assemblies: $($_.Exception.Message)" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($err)
  exit 1
}

$raw = $env:OD_UIA_INPUT
if (-not $raw) {
  $e = @{ ok = $false; code = "PARSE_FAILED"; message = "OD_UIA_INPUT missing" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($e)
  exit 1
}

$opts = $raw | ConvertFrom-Json
$sessionPid = [int]$opts.sessionPid
$screenX = [double]$opts.screenX
$screenY = [double]$opts.screenY
$maxAncestorDepth = [int][Math]::Max(0, [Math]::Min(32, $opts.maxAncestorDepth))
$maxLocalDepth = [int][Math]::Max(1, [Math]::Min(50, $opts.maxLocalDepth))
$maxNodes = [int][Math]::Max(1, [Math]::Min(50000, $opts.maxNodes))

try {
  $pt = New-Object System.Windows.Point($screenX, $screenY)
  $hit = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
} catch {
  $err = @{ ok = $false; code = "ACCESSIBILITY_DISABLED"; message = $_.Exception.Message } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($err)
  exit 1
}

if ($null -eq $hit) {
  $e = @{ ok = $false; code = "PARSE_FAILED"; message = "FromPoint returned null" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($e)
  exit 1
}

try {
  $hitPid = [int]$hit.Current.ProcessId
} catch {
  $e = @{ ok = $false; code = "ACCESSIBILITY_DISABLED"; message = "Cannot read ProcessId" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($e)
  exit 1
}

if ($hitPid -ne $sessionPid) {
  $e = @{ ok = $false; code = "HIT_OUTSIDE_SESSION"; message = "hit process $hitPid does not match session pid $sessionPid" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($e)
  exit 0
}

$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
$ancestors = @()
$p = $walker.GetParent($hit)
$ad = 0
while ($null -ne $p -and $ad -lt $maxAncestorDepth) {
  $ancestors += ,$(ElemToShallow $p)
  $p = $walker.GetParent($p)
  $ad++
}

$hitFrame = $null
try {
  $r = $hit.Current.BoundingRectangle
  if ($null -ne $r -and $r.Width -gt 0 -and $r.Height -gt 0) {
    $hitFrame = @{ x = [double]$r.X; y = [double]$r.Y; width = [double]$r.Width; height = [double]$r.Height }
  }
} catch { }

$nc = 0
$at = ElemToNode $hit ($maxLocalDepth) ([ref]$nc) $maxNodes
$truncated = ($nc -ge $maxNodes)

$out = [ordered]@{
  ok = $true
  truncated = $truncated
  screenX = $screenX
  screenY = $screenY
  ancestors = $ancestors
  at = $at
}
if ($null -ne $hitFrame) { $out.hitFrame = $hitFrame }
$json = ($out | ConvertTo-Json -Depth 30 -Compress)
[Console]::Out.WriteLine($json)
exit 0
