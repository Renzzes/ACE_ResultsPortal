# Starts ACEMCC-ACERPTS when the portal port is down and the boot task is not running.
# Task Scheduler's own RestartOnFailure did not relaunch after the Sep 25 exit, so this
# minute-by-minute check is the backstop. It does nothing while the launcher is already running.
$ErrorActionPreference = "Continue"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = "ACEMCC-ACERPTS"
$RootDir = Split-Path -Parent $AppDir
$LogDir = Join-Path $RootDir "logs"
$Log = Join-Path $LogDir "watchdog.log"

function Write-Watch([string]$Message) {
  if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
  }
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $Log -Value $line -Encoding utf8
}

$port = 3003
$envFile = Join-Path $AppDir ".env"
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*PORT\s*=\s*(\d+)\s*$') {
      $port = [int]$Matches[1]
      break
    }
  }
}

$listening = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
if ($listening.Count -ge 1) { exit 0 }

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { exit 0 }
if (-not $task.Settings.Enabled) { exit 0 }
if ([string]$task.State -eq "Running") { exit 0 }

Write-Watch "port $port is down and $TaskName is $($task.State); starting task"
try {
  Start-ScheduledTask -TaskName $TaskName
  Write-Watch "started $TaskName"
} catch {
  Write-Watch ("start failed: " + $_.Exception.Message)
  exit 1
}
exit 0
