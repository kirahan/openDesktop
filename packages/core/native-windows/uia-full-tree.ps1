#Requires -Version 5.1
# Input: JSON in env OD_UIA_FULL_TREE_INPUT (sessionPid, maxDepth, maxNodes)
# Output: single JSON line (Mac-compatible ok shape with root, or ok:false)

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

try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop | Out-Null
  Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop | Out-Null
  Add-Type -AssemblyName WindowsBase -ErrorAction Stop | Out-Null
} catch {
  $err = @{ ok = $false; code = "ACCESSIBILITY_DISABLED"; message = "Failed to load UI Automation assemblies: $($_.Exception.Message)" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($err)
  exit 1
}

$raw = $env:OD_UIA_FULL_TREE_INPUT
if (-not $raw) {
  $e = @{ ok = $false; code = "PARSE_FAILED"; message = "OD_UIA_FULL_TREE_INPUT missing" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($e)
  exit 1
}

$opts = $raw | ConvertFrom-Json
$sessionPid = [int]$opts.sessionPid
$maxDepth = [int][Math]::Max(1, [Math]::Min(50, $opts.maxDepth))
$maxNodes = [int][Math]::Max(1, [Math]::Min(50000, $opts.maxNodes))

$pidProp = [System.Windows.Automation.AutomationElement]::ProcessIdProperty
$cond = New-Object System.Windows.Automation.PropertyCondition($pidProp, $sessionPid)
try {
  $roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    $cond
  )
} catch {
  $err = @{ ok = $false; code = "ACCESSIBILITY_DISABLED"; message = $_.Exception.Message } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($err)
  exit 1
}

if ($null -eq $roots -or $roots.Count -lt 1) {
  $e = @{ ok = $false; code = "NO_UI_ROOT"; message = "No top-level UIA elements for this process id" } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($e)
  exit 0
}

$nc = 0
$childTrees = @()
for ($i = 0; $i -lt $roots.Count; $i++) {
  if ($nc -ge $maxNodes) { break }
  $el = $roots[$i]
  $sub = ElemToNode $el $maxDepth ([ref]$nc) $maxNodes
  if ($null -ne $sub) { $childTrees += $sub }
}

$truncated = ($nc -ge $maxNodes)
$root = [ordered]@{
  role = "Application"
  title = "PID $sessionPid"
  value = $null
  children = $childTrees
}
$out = [ordered]@{ ok = $true; truncated = $truncated; root = $root }
$json = ($out | ConvertTo-Json -Depth 30 -Compress)
[Console]::Out.WriteLine($json)
exit 0
