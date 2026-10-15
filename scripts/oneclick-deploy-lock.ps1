# ACE Results Portal — OneClick deployment mutex.
param(
  [string]$LockAction = "Acquire",
  [string]$LockFile = "",
  [string]$DeployRunId = "",
  [int]$StaleMinutes = 90
)

$ErrorActionPreference = "Stop"

if ($LockAction -ne "Acquire" -and $LockAction -ne "Release") {
  Write-Error "LockAction must be Acquire or Release"
  exit 1
}
if (-not $LockFile) {
  Write-Error "LockFile is required"
  exit 1
}

function Get-OwnerCmdPid {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
  if (-not $proc) { return $PID }
  $parentId = $proc.ParentProcessId
  if (-not $parentId) { return $PID }
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue
  if ($parent -and $parent.Name -ieq "cmd.exe") { return $parent.ProcessId }
  return $parentId
}

function Test-DeployProcessActive([int]$ownerPid) {
  if ($ownerPid -le 0) { return $false }
  return [bool](Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)
}

if ($LockAction -eq "Acquire") {
  $ownerPid = Get-OwnerCmdPid
  $lockDir = [System.IO.Path]::GetDirectoryName($LockFile)
  if ($lockDir -and -not (Test-Path -LiteralPath $lockDir)) {
    New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
  }

  if (Test-Path -LiteralPath $LockFile) {
    $raw = (Get-Content -LiteralPath $LockFile -Raw -ErrorAction SilentlyContinue).Trim()
    $parts = $raw -split "\|", 3
    $existingPid = 0
    if ($parts.Length -ge 1) { [void][int]::TryParse($parts[0].Trim(), [ref]$existingPid) }
    $existingRun = if ($parts.Length -ge 2) { $parts[1].Trim() } else { "" }
    $existingTime = if ($parts.Length -ge 3) { $parts[2].Trim() } else { "" }

    $stale = $false
    if ($existingTime) {
      try {
        $started = [datetime]::Parse($existingTime)
        $ageMin = ((Get-Date) - $started).TotalMinutes
        if ($ageMin -gt $StaleMinutes) { $stale = $true }
      } catch {
        $stale = $true
      }
    }

    if (-not $stale -and (Test-DeployProcessActive $existingPid)) {
      Write-Host "[oneclick-deploy-lock] Another deployment is active (PID=$existingPid RUN_ID=$existingRun)."
      exit 2
    }

    Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
  }

  $stamp = (Get-Date).ToString("o")
  $line = "$ownerPid|$DeployRunId|$stamp"
  Set-Content -LiteralPath $LockFile -Value $line -Encoding ASCII -NoNewline
  Write-Host "[oneclick-deploy-lock] Acquired lock PID=$ownerPid RUN_ID=$DeployRunId"
  exit 0
}

if (-not (Test-Path -LiteralPath $LockFile)) {
  exit 0
}
$ownerPid = Get-OwnerCmdPid
$raw = (Get-Content -LiteralPath $LockFile -Raw -ErrorAction SilentlyContinue).Trim()
$parts = $raw -split "\|", 3
$existingPid = 0
if ($parts.Length -ge 1) { [void][int]::TryParse($parts[0].Trim(), [ref]$existingPid) }
$existingRun = if ($parts.Length -ge 2) { $parts[1].Trim() } else { "" }

if ($existingPid -eq $ownerPid -or ($DeployRunId -and $existingRun -eq $DeployRunId)) {
  Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
  Write-Host "[oneclick-deploy-lock] Released lock RUN_ID=$DeployRunId"
}
exit 0
