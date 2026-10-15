# Resolves production ACE Results Portal root.
# Preference: explicit -PreferredRoot / $env:ACERPTS_ROOT → D:\ACERPTS → C:\ACERPTS
param(
  [string]$PreferredRoot = ""
)

$ErrorActionPreference = "Stop"

function Normalize-Root([string]$root) {
  return (($root -replace "/", "\").TrimEnd("\"))
}

function Test-LiveApp([string]$root) {
  $entryMjs = Join-Path $root "app\server\index.mjs"
  $entryJs = Join-Path $root "app\server\index.js"
  return (Test-Path -LiteralPath $entryMjs) -or (Test-Path -LiteralPath $entryJs)
}

$candidates = @()
if ($PreferredRoot) { $candidates += (Normalize-Root $PreferredRoot) }
if ($env:ACERPTS_ROOT) { $candidates += (Normalize-Root $env:ACERPTS_ROOT) }
if (Test-Path -LiteralPath "D:\") { $candidates += "D:\ACERPTS" }
$candidates += "C:\ACERPTS"

$live = @()
foreach ($c in $candidates) {
  if (Test-LiveApp $c) { $live += $c }
}
if ($live.Count -gt 0) {
  $dLive = $live | Where-Object { $_ -ieq "D:\ACERPTS" } | Select-Object -First 1
  if ($dLive) { Write-Output $dLive; exit 0 }
  Write-Output $live[0]
  exit 0
}

if (Test-Path -LiteralPath "D:\") {
  Write-Output "D:\ACERPTS"
  exit 0
}
Write-Output "C:\ACERPTS"
exit 0
