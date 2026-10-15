# Registers ACEMCC-ACERPTS as a boot-time service-like task:
# SYSTEM / Highest / At startup / run-acerpts-service.cmd (restarts node on every exit)
# plus ACEMCC-ACERPTS-Watchdog, which starts the task again if the launcher itself is gone.
param(
  [ValidateSet("Stop", "Register", "Start", "Verify")]
  [string]$Mode = "Register",
  [string]$TaskName = "ACEMCC-ACERPTS",
  [string]$WatchdogTaskName = "ACEMCC-ACERPTS-Watchdog",
  [string[]]$RetiredTaskNames = @("ACEMCC-ACERPTS-Startup", "ACEMCC-ACERPTS-PM2-Startup"),
  [string]$NodeExe = "",
  [string]$AppDir = "C:\ACERPTS\app",
  [string]$Entry = "C:\ACERPTS\app\server\index.mjs",
  [string]$BootDelay = "PT30S"
)

$ErrorActionPreference = "Stop"

function Normalize-Path([string]$value) {
  return (($value -replace "/", "\").TrimEnd("\"))
}

function Normalize-ComparePath([string]$value) {
  return (Normalize-Path $value).ToLowerInvariant()
}

$AppDir = Normalize-Path $AppDir
$Entry = Normalize-Path $Entry
$LauncherName = "run-acerpts-service.cmd"
$WatchdogName = "watch-acerpts-service.ps1"
$LauncherPath = Join-Path $AppDir $LauncherName
$WatchdogPath = Join-Path $AppDir $WatchdogName

function Sync-TaskPaths {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $exec = Normalize-Path ([string]$task.Actions[0].Execute)
  $args = [string]$task.Actions[0].Arguments
  $taskAppDir = Normalize-Path ([string]$task.Actions[0].WorkingDirectory)
  if ($taskAppDir) { $script:AppDir = $taskAppDir }
  $script:Entry = Join-Path $script:AppDir "server\index.mjs"
  $script:LauncherPath = Join-Path $script:AppDir $LauncherName
  if ($exec -match '(?i)run-acerpts-service\.cmd$') {
    $script:LauncherPath = $exec
  } elseif ($args -match '(?i)(.*?run-acerpts-service\.cmd)') {
    $script:LauncherPath = Normalize-Path $Matches[1].Trim('"')
  }
}

function Get-AcerptsPortFromEnv {
  param([string]$Root = $AppDir)
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path -LiteralPath $envFile)) { return 3003 }
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*PORT\s*=\s*(\d+)\s*$') { return [int]$Matches[1] }
  }
  return 3003
}

function Test-CommandLineMatchesEntry {
  param(
    [string]$CommandLine,
    [string]$ExpectedEntry,
    [string]$ExpectedAppDir
  )
  if (-not $CommandLine) { return $false }
  $cl = $CommandLine.Replace('/', '\')
  $entryNorm = Normalize-ComparePath $ExpectedEntry
  $appNorm = Normalize-ComparePath $ExpectedAppDir
  $clNorm = $cl.ToLowerInvariant()
  if ($clNorm.Contains($entryNorm)) { return $true }
  if ($clNorm -match '(?i)run-acerpts-service\.cmd') { return $true }
  if ($clNorm -match '(?i)(^|\s|")server\\index\.mjs(\s|"|$)') {
    if ($clNorm.Contains($appNorm)) { return $true }
  }
  if ($clNorm.Contains($appNorm) -and $clNorm.Contains('index.mjs')) { return $true }
  return $false
}

function Get-AcerptsNodeProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { Test-CommandLineMatchesEntry -CommandLine ([string]$_.CommandLine) -ExpectedEntry $Entry -ExpectedAppDir $AppDir }
}

function Get-AcerptsListeningNodeProcesses {
  $port = Get-AcerptsPortFromEnv
  $pids = @(
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
  foreach ($procId in $pids) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
    if ($proc -and [string]$proc.Name -ieq 'node.exe') {
      return @($proc)
    }
  }
  return @()
}

function Install-ServiceFile {
  param(
    [string]$FileName,
    [string]$Destination
  )
  $srcCandidates = @(
    (Join-Path $PSScriptRoot $FileName),
    (Join-Path (Split-Path $PSScriptRoot -Parent) "scripts\$FileName")
  )
  $src = $srcCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $src) {
    throw "Missing service script ($FileName)"
  }
  if (-not (Test-Path -LiteralPath $AppDir)) {
    throw "Missing application directory: $AppDir"
  }
  Copy-Item -LiteralPath $src -Destination $Destination -Force
  Write-Host "[register-acerpts-startup] Installed $Destination"
}

function Install-ServiceLauncher {
  Install-ServiceFile -FileName $LauncherName -Destination $LauncherPath
  Install-ServiceFile -FileName $WatchdogName -Destination $WatchdogPath
}

function Set-WatchdogEnabled {
  param([bool]$Enabled)
  $existing = Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue
  if (-not $existing) { return }
  if ($Enabled) {
    Enable-ScheduledTask -TaskName $WatchdogTaskName | Out-Null
    Write-Host "[register-acerpts-startup] Enabled $WatchdogTaskName"
  } else {
    Disable-ScheduledTask -TaskName $WatchdogTaskName | Out-Null
    try { Stop-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue } catch { }
    Write-Host "[register-acerpts-startup] Disabled $WatchdogTaskName"
  }
}

function Stop-AcerptsNode {
  Set-WatchdogEnabled -Enabled $false
  foreach ($name in @($TaskName) + @($RetiredTaskNames)) {
    try { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue } catch { }
  }
  $legacyPaths = @(
    "C:\ACERPTS\app\server\index.mjs",
    "D:\ACERPTS\app\server\index.mjs",
    $Entry
  )
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $cl = [string]$_.CommandLine
      foreach ($legacy in $legacyPaths) {
        if (Test-CommandLineMatchesEntry -CommandLine $cl -ExpectedEntry $legacy -ExpectedAppDir $AppDir) { return $true }
      }
      return $false
    } |
    ForEach-Object {
      Write-Host ("[register-acerpts-startup] Stopping node.exe PID " + $_.ProcessId)
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  # Also stop cmd wrappers for the launcher
  Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.CommandLine -match '(?i)run-acerpts-service\.cmd' } |
    ForEach-Object {
      Write-Host ("[register-acerpts-startup] Stopping launcher cmd PID " + $_.ProcessId)
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  Start-Sleep -Seconds 1
}

function Unregister-RetiredTasks {
  foreach ($name in @($RetiredTaskNames)) {
    try {
      Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue |
        Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
    } catch { }
    cmd.exe /c "schtasks /Delete /TN `"$name`" /F >nul 2>&1"
  }
}

function Register-AcerptsTask {
  if (-not $NodeExe) {
    $NodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
  }
  if (-not $NodeExe) {
    $fallback = Join-Path $env:ProgramFiles "nodejs\node.exe"
    if (Test-Path -LiteralPath $fallback) { $NodeExe = $fallback }
  }
  if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) {
    throw "node.exe path missing or not found: $NodeExe"
  }
  if (-not (Test-Path -LiteralPath $Entry)) {
    throw "Missing production entry: $Entry"
  }
  if (-not (Test-Path -LiteralPath $AppDir)) {
    throw "Missing application directory: $AppDir"
  }

  Install-ServiceLauncher
  Stop-AcerptsNode
  Unregister-RetiredTasks
  try {
    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue |
      Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
  } catch { }
  cmd.exe /c "schtasks /Delete /TN `"$TaskName`" /F >nul 2>&1"

  # Run launcher via cmd.exe so stdout/stderr redirection in the .cmd works under SYSTEM.
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument ("/c `"{0}`"" -f $LauncherPath) -WorkingDirectory $AppDir
  $trigger = New-ScheduledTaskTrigger -AtStartup
  try { $trigger.Delay = $BootDelay } catch { }
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew
  # Keep running indefinitely; restart if the process exits.
  try { $settings.DisallowStartOnRemoteAppSession = $false } catch { }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host "[register-acerpts-startup] OK $TaskName -> $LauncherPath (boot delay $BootDelay, SYSTEM, launcher restarts node)"
  Register-AcerptsWatchdog
}

function Register-AcerptsWatchdog {
  if (-not (Test-Path -LiteralPath $WatchdogPath)) {
    throw "Missing watchdog script: $WatchdogPath"
  }
  try {
    Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue |
      Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
  } catch { }
  cmd.exe /c "schtasks /Delete /TN `"$WatchdogTaskName`" /F >nul 2>&1"

  $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $action = New-ScheduledTaskAction -Execute $ps -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`"" -f $WatchdogPath) -WorkingDirectory $AppDir
  $boot = New-ScheduledTaskTrigger -AtStartup
  try { $boot.Delay = "PT1M" } catch { }
  # Daily boundary re-arms a 1-minute repeat for the whole day. A single -Once
  # repetition expires, which is how a boot failure previously stayed down.
  $repeat = New-ScheduledTaskTrigger -Daily -At "00:00"
  $seed = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 1)
  $repeat.Repetition = $seed.Repetition
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $WatchdogTaskName -Action $action -Trigger @($boot, $repeat) -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host "[register-acerpts-startup] OK $WatchdogTaskName every 1 minute"
}

function Start-AcerptsTask {
  Sync-TaskPaths
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[register-acerpts-startup] Started $TaskName"
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    $procs = @(Get-AcerptsNodeProcesses)
    if ($procs.Count -lt 1) { $procs = @(Get-AcerptsListeningNodeProcesses) }
    if ($procs.Count -ge 1) {
      Write-Host ("[register-acerpts-startup] node.exe PID " + $procs[0].ProcessId + " running $Entry")
      return
    }
    Start-Sleep -Seconds 1
  }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  $last = if ($info) { $info.LastTaskResult } else { "unknown" }
  $serviceLog = Join-Path (Split-Path $AppDir -Parent) "logs\service.log"
  $hint = if (Test-Path -LiteralPath $serviceLog) { " See $serviceLog" } else { "" }
  throw "Scheduled task started but node.exe did not appear within 60s (LastTaskResult=$last, expected $Entry).$hint"
}

function Verify-AcerptsTask {
  Sync-TaskPaths
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if (-not $t.Settings.Enabled) { throw "task is disabled" }
  $uid = [string]$t.Principal.UserId
  if ($uid -notmatch "SYSTEM" -and $uid -ne "S-1-5-18") { throw "RunAs is $uid" }
  if ([string]$t.Principal.RunLevel -notmatch "Highest") { throw "RunLevel is $($t.Principal.RunLevel)" }
  $boot = @($t.Triggers | Where-Object { $_.CimClass.CimClassName -match "Boot" })
  if ($boot.Count -lt 1) { throw "missing At startup trigger" }
  $exec = [string]$t.Actions[0].Execute
  $args = [string]$t.Actions[0].Arguments
  $cwd = Normalize-Path ([string]$t.Actions[0].WorkingDirectory)
  $runsLauncher = ($exec -match '(?i)cmd\.exe$') -and ($args -match '(?i)run-acerpts-service\.cmd')
  $runsNodeDirect = ($exec -match '(?i)node\.exe$') -and ($args -like "*$Entry*")
  if (-not $runsLauncher -and -not $runsNodeDirect) {
    throw "action does not launch service wrapper or node.exe: $exec $args"
  }
  if ($cwd -ne $AppDir) { throw "working directory is $cwd (expected $AppDir)" }
  $watch = Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction Stop
  if (-not $watch.Settings.Enabled) { throw "$WatchdogTaskName is disabled" }
  $watchBoot = @($watch.Triggers | Where-Object { $_.CimClass.CimClassName -match "Boot" })
  if ($watchBoot.Count -lt 1) { throw "$WatchdogTaskName missing At startup trigger" }
  $watchRepeat = @($watch.Triggers | Where-Object { $_.Repetition -and $_.Repetition.Interval })
  if ($watchRepeat.Count -lt 1) { throw "$WatchdogTaskName missing a repeating trigger" }
  Write-Host "[VERIFY] $TaskName OK: Enabled, SYSTEM, Highest, At startup, launcher/node, cwd=$AppDir"
  Write-Host "[VERIFY] $WatchdogTaskName OK: Enabled, At startup, repeats $($watchRepeat[0].Repetition.Interval)"
}

function Verify-AcerptsProcess {
  Sync-TaskPaths
  $procs = @(Get-AcerptsNodeProcesses)
  if ($procs.Count -lt 1) { $procs = @(Get-AcerptsListeningNodeProcesses) }
  if ($procs.Count -lt 1) { throw "node.exe is not running $Entry" }
  Write-Host ("[VERIFY] node.exe PID " + $procs[0].ProcessId + " running $Entry")
}

switch ($Mode) {
  "Stop" {
    try {
      Stop-AcerptsNode
      Unregister-RetiredTasks
    } catch {
      Write-Host ("[register-acerpts-startup] Stop warning: " + $_.Exception.Message)
    }
    Write-Host "[register-acerpts-startup] Stopped ACERPTS node process"
    exit 0
  }
  "Register" { Register-AcerptsTask }
  "Start" { Start-AcerptsTask }
  "Verify" {
    Verify-AcerptsTask
    Verify-AcerptsProcess
  }
}
