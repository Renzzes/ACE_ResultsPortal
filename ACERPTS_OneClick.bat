@echo off
REM =============================================================================
REM ACE Results Portal - one-click production deployment
REM
REM Double-click, approve Administrator, wait.
REM Starts: Windows Task ACEMCC-ACERPTS -> node.exe %APP_ROOT%\app\server\index.mjs
REM Prefer D:\ACERPTS when present; otherwise C:\ACERPTS.
REM =============================================================================

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "LAUNCH_DIR=%~dp0"
if "%LAUNCH_DIR:~-1%"=="\" set "LAUNCH_DIR=%LAUNCH_DIR:~0,-1%"
set "REPO_DIR=%LAUNCH_DIR%"

set "APP_ROOT=C:\ACERPTS"
if exist "D:\ACERPTS\app\server\index.mjs" set "APP_ROOT=D:\ACERPTS"
if not exist "%APP_ROOT%\app\server\index.mjs" if exist "D:\" set "APP_ROOT=D:\ACERPTS"
set "APP_DIR=%APP_ROOT%\app"
set "APP_DIR_FWD=%APP_DIR:\=/%"
set "APP_ROOT_FWD=%APP_ROOT:\=/%"
set "LOG_DIR=%APP_ROOT%\logs"
set "BACKUP_DIR=%APP_ROOT%\backup"
set "DEPLOYMENTS_DIR=%APP_ROOT%\Deployments"
set "PORT=3003"
set "FW_RULE_NAME=ACEMCC ACERPTS TCP 3003"
set "TASK_NAME=ACEMCC-ACERPTS"
set "DEPLOY_LOG=%LOG_DIR%\oneclick-deploy.log"
set "DEPLOY_LOG=%DEPLOY_LOG:\=/%"
set "FAILED_STEP=unknown"
set "FAIL_REASON="
set "NODE_EXE="
set "NODE_VER="
set "HEALTH_STATUS=unknown"
set "PORT_LISTEN=unknown"
set "PROCESS_OK=0"
set "TASK_OK=0"
set "DEPLOY_RUN_ID="
set "SYNC_OK=0"
set "DEPLOY_VERIFY_OK=0"
set "DEPLOY_LOCK_HELD=0"
set "DEPLOY_SYNC_MARKER="
set "DEPLOY_LOCK="
set "RUN_PHASE=init"

echo.
echo [1] START - Administrator privilege
net session >nul 2>&1
if errorlevel 1 (
  set "FAILED_STEP=Administrator check"
  echo [1] Not elevated - opening an Administrator CMD window that stays open...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Start-Process -FilePath $env:ComSpec -WorkingDirectory '%REPO_DIR%' -Verb RunAs -ArgumentList @('/k','\"%~f0\"')"
  echo.
  echo An Administrator window should now be open. Watch THAT window.
  echo Press any key to close this launcher window...
  if /I "%ACERPTS_ONECLICK_NOPAUSE%"=="1" exit /b 0
  pause
  exit /b 0
)
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
>>"%DEPLOY_LOG%" echo.
>>"%DEPLOY_LOG%" echo ========== %DATE% %TIME% ACERPTS_OneClick START DEPLOY_RUN_ID pending ==========
call :LOG "[1] OK - running as Administrator"

call :IS_SOURCE_REPO "%REPO_DIR%"
if errorlevel 1 (
  echo [1] Launched from %LAUNCH_DIR% - that is not the ACE Results Portal source repository.
  set "FOUND_REPO="
  if exist "%USERPROFILE%\ace-results-portal-source\ACERPTS_OneClick.bat" if exist "%USERPROFILE%\ace-results-portal-source\.env" if exist "%USERPROFILE%\ace-results-portal-source\.env.production" if exist "%USERPROFILE%\ace-results-portal-source\package.json" if exist "%USERPROFILE%\ace-results-portal-source\scripts\apply-production-env.mjs" set "FOUND_REPO=%USERPROFILE%\ace-results-portal-source"
  if not defined FOUND_REPO if exist "E:\ace-results-portal-source\ACERPTS_OneClick.bat" if exist "E:\ace-results-portal-source\.env" if exist "E:\ace-results-portal-source\.env.production" if exist "E:\ace-results-portal-source\package.json" if exist "E:\ace-results-portal-source\scripts\apply-production-env.mjs" set "FOUND_REPO=E:\ace-results-portal-source"
  if not defined FOUND_REPO (
    set "FAIL_REASON=.env.production / source tree not found. Do not run the copy in C:\ACERPTS\Deployments. Double-click ACERPTS_OneClick.bat in the git repository (the folder that contains .env.production and package.json). Launched from: %LAUNCH_DIR%"
    echo [1] ERROR - !FAIL_REASON!
    goto :FAIL
  )
  if /I "!FOUND_REPO!"=="!LAUNCH_DIR!" (
    set "FAIL_REASON=Source repository validation failed at !REPO_DIR!. Ensure .env.production, package.json, and scripts\apply-production-env.mjs exist."
    echo [1] ERROR - !FAIL_REASON!
    goto :FAIL
  )
  echo [1] Relocating to source repository: !FOUND_REPO!
  call :LOG "[1] Relocating to source repository: !FOUND_REPO!"
  cd /d "!FOUND_REPO!"
  call "!FOUND_REPO!\ACERPTS_OneClick.bat"
  exit /b !ERRORLEVEL!
)
cd /d "%REPO_DIR%"

if exist "%REPO_DIR%\scripts\resolve-acerpts-root.ps1" (
  set "APP_ROOT="
  for /f "usebackq delims=" %%R in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_DIR%\scripts\resolve-acerpts-root.ps1"`) do set "APP_ROOT=%%R"
  if not defined APP_ROOT set "APP_ROOT=C:\ACERPTS"
  set "APP_DIR=!APP_ROOT!\app"
  set "APP_DIR_FWD=!APP_DIR:\=/!"
  set "APP_ROOT_FWD=!APP_ROOT:\=/!"
  set "LOG_DIR=!APP_ROOT!\logs"
  set "BACKUP_DIR=!APP_ROOT!\backup"
  set "DEPLOYMENTS_DIR=!APP_ROOT!\Deployments"
  set "DEPLOY_LOG=!LOG_DIR:\=/!/oneclick-deploy.log"
)

set "DEPLOY_RUN_ID="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Date).ToString('yyyyMMddTHHmmssfff')"`) do set "DEPLOY_RUN_ID=%%I"
if not defined DEPLOY_RUN_ID set "DEPLOY_RUN_ID=run!RANDOM!!RANDOM!"
set "ACERPTS_DEPLOY_RUN_ID=!DEPLOY_RUN_ID!"
set "ACERPTS_VERIFY_LOG_DIR=!LOG_DIR!"
set "DEPLOY_LOCK=!LOG_DIR!\oneclick-deploy.lock"
set "DEPLOY_SYNC_MARKER=!LOG_DIR!\deploy-run-!DEPLOY_RUN_ID!.sync.ok"
call :LOG "ACERPTS_OneClick DEPLOY_RUN_ID=!DEPLOY_RUN_ID! target=!APP_DIR:\=/!"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_DIR%\scripts\oneclick-deploy-lock.ps1" -LockAction Acquire -LockFile "%DEPLOY_LOCK%" -DeployRunId "%DEPLOY_RUN_ID%"
if errorlevel 2 (
  set "FAIL_REASON=Another ACERPTS_OneClick deployment is already running. Wait for it to finish before starting a new deploy."
  echo [LOCK] ERROR - !FAIL_REASON!
  goto :FAIL_NO_LOCK
)
if errorlevel 1 (
  set "FAIL_REASON=Failed to acquire deployment lock at %DEPLOY_LOCK%"
  echo [LOCK] ERROR - !FAIL_REASON!
  goto :FAIL_NO_LOCK
)
set "DEPLOY_LOCK_HELD=1"
set "RUN_PHASE=locked"

echo.
echo ===============================================
echo  ACE Results Portal One-Click Deployment
echo  Repo:   %REPO_DIR%
echo  Target: %APP_DIR%
echo  Root:   %APP_ROOT%
echo  Run ID: %DEPLOY_RUN_ID%
echo ===============================================
echo.

set "FAILED_STEP=Node.js check"
echo [2] START - detect node.exe
if exist "%ProgramFiles%\nodejs" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node.exe >nul 2>&1
if errorlevel 1 (
  set "FAIL_REASON=Node.js is not installed. Install Node.js 20+ LTS."
  echo [2] ERROR - !FAIL_REASON!
  goto :FAIL
)
for /f "delims=" %%P in ('where node.exe 2^>nul') do (
  set "NODE_EXE=%%P"
  goto :NODE_FOUND
)
:NODE_FOUND
if not exist "!NODE_EXE!" (
  set "FAIL_REASON=where node.exe resolved a missing path."
  echo [2] ERROR - !FAIL_REASON!
  goto :FAIL
)
for /f "tokens=*" %%V in ('node -v') do set "NODE_VER=%%V"
call :LOG "[2] OK - Node !NODE_VER! executable=!NODE_EXE:\=/!"

set "FAILED_STEP=pnpm check"
echo [3] START - pnpm
set "PNPM_CMD=pnpm"
where pnpm >nul 2>&1
if errorlevel 1 (
  where corepack >nul 2>&1
  if errorlevel 1 (
    set "FAIL_REASON=pnpm is not on PATH. Install pnpm or enable corepack."
    echo [3] ERROR - !FAIL_REASON!
    goto :FAIL
  )
  call :CAPTURE corepack enable
  set "PNPM_CMD=corepack pnpm"
)
call :LOG "[3] OK - pnpm available (%PNPM_CMD%)."

set "FAILED_STEP=.env.production validation"
echo [4] START - .env.production validation
if not exist "%REPO_DIR%\.env.production" (
  set "FAIL_REASON=.env.production is missing at %REPO_DIR%. Run ACERPTS_OneClick.bat from the git repository."
  echo [4] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :CAPTURE node "%REPO_DIR%\scripts\validate-production-env.mjs" "%REPO_DIR%\.env.production"
if errorlevel 1 (
  set "FAIL_REASON=.env.production is incomplete. Secret values are never printed."
  echo [4] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[4] OK - production environment names present."

set "FAILED_STEP=pnpm install"
echo [5] START - repository pnpm install
cd /d "%REPO_DIR%"
call :CAPTURE %PNPM_CMD% install
if errorlevel 1 (
  set "FAIL_REASON=pnpm install failed."
  echo [5] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[5] OK - dependencies ready."

set "FAILED_STEP=frontend build"
echo [6] START - frontend build
call :CAPTURE %PNPM_CMD% --filter @workspace/ace-results-portal run build
if errorlevel 1 (
  set "FAIL_REASON=Frontend build failed."
  echo [6] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[6] OK - frontend built."

set "FAILED_STEP=backend build"
echo [7] START - backend build
call :CAPTURE %PNPM_CMD% run stamp:version
if errorlevel 1 (
  set "FAIL_REASON=stamp:version failed."
  echo [7] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :CAPTURE %PNPM_CMD% --filter @workspace/api-server run build
if errorlevel 1 (
  set "FAIL_REASON=Backend build failed."
  echo [7] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[7] OK - backend built."

set "FAILED_STEP=assemble-dist"
echo [8] START - assemble production dist
call :CAPTURE node scripts/assemble-dist.mjs
if errorlevel 1 (
  set "FAIL_REASON=assemble-dist failed."
  echo [8] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[8] OK - dist assembled."
set "RUN_PHASE=assembled"

set "FAILED_STEP=verify"
echo [9] START - verify production build
call :CAPTURE node scripts/verify-production-build.mjs
if errorlevel 1 (
  set "FAIL_REASON=verify failed."
  echo [9] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not exist "%REPO_DIR%\dist\server\index.mjs" (
  set "FAIL_REASON=Missing dist\server\index.mjs"
  echo [9] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[9] OK - verify passed."

set "FAILED_STEP=create folders"
echo [10] START - %APP_ROOT% folders
if not exist "%APP_ROOT%" mkdir "%APP_ROOT%"
if not exist "%APP_DIR%" mkdir "%APP_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
if not exist "%DEPLOYMENTS_DIR%" mkdir "%DEPLOYMENTS_DIR%"
if not exist "%APP_ROOT%\storage" mkdir "%APP_ROOT%\storage"
call :LOG "[10] OK - folders ready (!APP_ROOT:\=/!)."

set "FAILED_STEP=stop running ACERPTS"
echo [11] START - stop existing ACERPTS process
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_DIR%\scripts\register-acerpts-startup.ps1" -Mode Stop -TaskName "%TASK_NAME%" -AppDir "%APP_DIR%" -Entry "%APP_DIR%\server\index.mjs"
if errorlevel 1 (
  set "FAIL_REASON=Failed to stop the existing ACERPTS process."
  echo [11] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[11] OK - previous ACERPTS stopped."

set "FAILED_STEP=confirm ACERPTS stopped"
echo [11a] START - confirm no ACERPTS node process and port 3003 is free
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$entry='%APP_DIR%\server\index.mjs'; $deadline=(Get-Date).AddSeconds(15); " ^
  "do { " ^
  "  $nodes=@(Get-CimInstance Win32_Process -Filter 'Name = ''node.exe''' -ErrorAction SilentlyContinue | Where-Object { [string]$_.CommandLine -like ('*' + $entry + '*') }); " ^
  "  $listen=@(Get-NetTCPConnection -LocalPort 3003 -State Listen -ErrorAction SilentlyContinue); " ^
  "  if ($nodes.Count -eq 0 -and $listen.Count -eq 0) { exit 0 }; " ^
  "  if ((Get-Date) -ge $deadline) { break }; " ^
  "  Start-Sleep -Seconds 1 " ^
  "} while ($true); " ^
  "Write-Host ('ACERPTS still present. nodePids=' + (($nodes | ForEach-Object ProcessId) -join ',') + ' port3003Listeners=' + $listen.Count); " ^
  "exit 1"
if errorlevel 1 (
  set "FAIL_REASON=Previous ACERPTS node is still running or TCP port 3003 is still listening. Deployment stopped before backup and file replacement."
  echo [11a] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[11a] OK - no ACERPTS node process and port 3003 is not listening."

set "FAILED_STEP=backup"
echo [12] START - backup existing application
if exist "%APP_DIR%\server\index.mjs" goto :DO_BACKUP
if exist "%APP_DIR%\package.json" goto :DO_BACKUP
call :LOG "[12] OK - no previous app to back up."
goto :AFTER_BACKUP

:DO_BACKUP
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd-HHmmss"') do set "STAMP=%%I"
set "SNAP=%BACKUP_DIR%\!STAMP!"
echo [12] Backing up current app to !SNAP!
mkdir "!SNAP!" 2>nul
robocopy "%APP_DIR%" "!SNAP!" /E /XD node_modules /NFL /NDL /NJH /NJS /nc /ns /np >nul
echo !STAMP!> "!SNAP!\BACKUP_INFO.txt"
call :LOG "[12] OK - backup created."

:AFTER_BACKUP
set "PRESERVED_DOTENV=%TEMP%\acerpts-dotenv.preserve"
if exist "%PRESERVED_DOTENV%" del /F /Q "%PRESERVED_DOTENV%" >nul 2>&1
if exist "%APP_DIR%\.env" copy /Y "%APP_DIR%\.env" "%PRESERVED_DOTENV%" >nul

set "FAILED_STEP=install application files"
echo [13] START - install assembled application into %APP_DIR%
cd /d "%REPO_DIR%"
set "ACERPTS_DEPLOY_RUN_ID=!DEPLOY_RUN_ID!"
set "ACERPTS_VERIFY_LOG_DIR=!LOG_DIR!"
call :CAPTURE node scripts/sync-production-app.mjs "%APP_DIR%"
if errorlevel 1 (
  set "FAIL_REASON=Failed to copy the assembled production tree into %APP_DIR%"
  echo [13] ERROR - !FAIL_REASON!
  goto :FAIL
)
if exist "%PRESERVED_DOTENV%" (
  copy /Y "%PRESERVED_DOTENV%" "%APP_DIR%\.env" >nul
  del /F /Q "%PRESERVED_DOTENV%" >nul 2>&1
)
set "SYNC_OK=1"
call :LOG "[13] OK sync-production-app DEPLOY_RUN_ID=!DEPLOY_RUN_ID!"

set "FAILED_STEP=environment files"
echo [14] START - production environment automation
cd /d "%REPO_DIR%"
if not exist "%REPO_DIR%\.env" (
  set "FAIL_REASON=Missing repo .env at %REPO_DIR%\.env — copy your secrets file before deploying."
  echo [14] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :CAPTURE node "%REPO_DIR%\scripts\apply-production-env.mjs" "%APP_DIR%" "%REPO_DIR%\.env.production" "%REPO_DIR%\.env"
if errorlevel 1 (
  set "FAIL_REASON=Failed to create or preserve %APP_DIR%\.env"
  echo [14] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not exist "%APP_DIR%\.env" (
  set "FAIL_REASON=%APP_DIR%\.env does not exist after environment automation."
  echo [14] ERROR - !FAIL_REASON!
  goto :FAIL
)
attrib -H -S "%APP_DIR%\.env" >nul 2>&1
call :ENSURE_ENV_KEY NODE_ENV production
call :ENSURE_ENV_KEY HOST 0.0.0.0
call :SET_ENV_KEY PORT %PORT%
call :SET_ENV_KEY ACERPTS_ROOT !APP_DIR_FWD!
call :SET_ENV_KEY RESULT_STORAGE_ROOT !APP_ROOT_FWD!/storage
attrib -H -S "%APP_DIR%\.env" >nul 2>&1
call :CAPTURE node "%REPO_DIR%\scripts\merge-production-cors.mjs" "%APP_DIR%"
if errorlevel 1 (
  set "FAIL_REASON=Failed to update CORS_ORIGIN."
  echo [14] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[14] OK - .env created from repo .env plus .env.production overlay."

set "FAILED_STEP=deployed production verification"
echo [13a] START - verify deployed production tree DEPLOY_RUN_ID=!DEPLOY_RUN_ID!
set "ACERPTS_DEPLOY_RUN_ID=!DEPLOY_RUN_ID!"
set "ACERPTS_VERIFY_LOG_DIR=!LOG_DIR!"
call :CAPTURE node "%REPO_DIR%\scripts\verify-deployed-production.mjs" "%APP_DIR%" "!DEPLOY_RUN_ID!" "!LOG_DIR!"
if errorlevel 1 (
  set "FAIL_REASON=Deployed production tree verification failed for DEPLOY_RUN_ID=!DEPLOY_RUN_ID!"
  echo [13a] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not exist "!DEPLOY_SYNC_MARKER!" (
  set "FAIL_REASON=Missing sync marker !DEPLOY_SYNC_MARKER! after verification"
  echo [13a] ERROR - !FAIL_REASON!
  goto :FAIL
)
set "DEPLOY_VERIFY_OK=1"
set "RUN_PHASE=synced"
call :LOG "[13a] OK deployed production verification DEPLOY_RUN_ID=!DEPLOY_RUN_ID!"

set "FAILED_STEP=production npm install"
echo [15] START - production npm install in !APP_DIR_FWD!
cd /d "!APP_DIR!"
if exist "%APP_DIR%\node_modules\express" (
  call :LOG "[15] OK - dependencies already installed."
) else (
  call :CAPTURE npm install --omit=dev
  if errorlevel 1 (
    set "FAIL_REASON=npm install --omit=dev failed in %APP_DIR%"
    echo [15] ERROR - !FAIL_REASON!
    goto :FAIL
  )
  call :LOG "[15] OK - dependencies installed."
)

set "FAILED_STEP=runtime validation"
echo [16] START - runtime file validation
if not exist "%APP_DIR%\server\index.mjs" (
  set "FAIL_REASON=Runtime validation failed: missing server entry."
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not exist "%APP_DIR%\.env" (
  set "FAIL_REASON=Runtime validation failed: missing .env."
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not exist "%APP_DIR%\node_modules" (
  set "FAIL_REASON=Runtime validation failed: missing node_modules."
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not exist "%APP_DIR%\client\index.html" (
  set "FAIL_REASON=Runtime validation failed: missing client shell."
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
set "MISSING_ENV="
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%APP_DIR%\.env'; $b=[System.IO.File]::ReadAllBytes($p); if ($b.Length -ge 3 -and $b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191) { [System.IO.File]::WriteAllBytes($p, $b[3..($b.Length-1)]) }"
for %%V in (PORT NODE_ENV CORS_ORIGIN JWT_SECRET DB_SERVER DB_USER DB_PASSWORD DB_DATABASE HOSPITAL_DB_DATABASE HIS_DB_USER HIS_DB_PASSWORD RESULT_STORAGE_ROOT SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS PORTAL_EMAIL_FROM) do (
  findstr /b /i /c:"%%V=" "%APP_DIR%\.env" >nul 2>&1
  if errorlevel 1 set "MISSING_ENV=!MISSING_ENV! %%V"
)
if defined MISSING_ENV (
  set "FAIL_REASON=Missing required environment variable names:!MISSING_ENV!"
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
REM HIS credentials must be non-empty (fail-closed). Names only in errors; never print values.
set "HIS_ENV_CHECK_OUT=%TEMP%\acerpts-his-env-check-!DEPLOY_RUN_ID!.txt"
node "%REPO_DIR%\scripts\check-his-env-nonempty.mjs" "%APP_DIR%\.env" >"!HIS_ENV_CHECK_OUT!" 2>nul
set "HIS_ENV_CHECK_EC=!ERRORLEVEL!"
set "EMPTY_HIS_ENV="
if exist "!HIS_ENV_CHECK_OUT!" set /p EMPTY_HIS_ENV=<"!HIS_ENV_CHECK_OUT!"
del /q "!HIS_ENV_CHECK_OUT!" >nul 2>&1
if not "!HIS_ENV_CHECK_EC!"=="0" (
  if not defined EMPTY_HIS_ENV set "EMPTY_HIS_ENV=HIS_DB_USER HIS_DB_PASSWORD"
  set "FAIL_REASON=Missing or empty required HIS credentials:!EMPTY_HIS_ENV!"
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not "!RUN_PHASE!"=="synced" (
  set "FAIL_REASON=Runtime validation failed: RUN_PHASE is !RUN_PHASE!."
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not "!SYNC_OK!"=="1" (
  set "FAIL_REASON=Runtime validation failed: SYNC_OK is !SYNC_OK!."
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not "!DEPLOY_VERIFY_OK!"=="1" (
  set "FAIL_REASON=Runtime validation failed: DEPLOY_VERIFY_OK is !DEPLOY_VERIFY_OK!."
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
if not exist "!DEPLOY_SYNC_MARKER!" (
  set "FAIL_REASON=Runtime validation failed: missing sync marker."
  echo [16] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[16] OK - runtime files and required env key names present."

set "FAILED_STEP=firewall"
echo [17] START - Windows Firewall TCP %PORT%
netsh advfirewall firewall show rule name="%FW_RULE_NAME%" >nul 2>&1
if not errorlevel 1 (
  call :LOG "[17] OK - firewall rule already exists."
) else (
  netsh advfirewall firewall add rule name="%FW_RULE_NAME%" dir=in action=allow protocol=TCP localport=%PORT% >nul
  if errorlevel 1 (
    set "FAIL_REASON=Failed to create firewall rule for TCP %PORT%"
    echo [17] ERROR - !FAIL_REASON!
    goto :FAIL
  )
  call :LOG "[17] OK - firewall rule created."
)

set "FAILED_STEP=register startup task"
echo [18] START - register %TASK_NAME%
call :ENSURE_NODE_EXE
if errorlevel 1 (
  echo [18] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :CAPTURE powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_DIR%\scripts\register-acerpts-startup.ps1" -Mode Register -TaskName "%TASK_NAME%" -NodeExe "!NODE_EXE!" -AppDir "%APP_DIR%" -Entry "%APP_DIR%\server\index.mjs"
if errorlevel 1 (
  set "FAIL_REASON=Failed to register scheduled task %TASK_NAME%"
  echo [18] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[18] OK - %TASK_NAME% registered."

set "FAILED_STEP=start startup task"
echo [19] START - Start-ScheduledTask %TASK_NAME%
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_DIR%\scripts\register-acerpts-startup.ps1" -Mode Start -TaskName "%TASK_NAME%" -AppDir "%APP_DIR%" -Entry "%APP_DIR%\server\index.mjs"
if errorlevel 1 (
  set "FAIL_REASON=Failed to start scheduled task %TASK_NAME%"
  echo [19] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :LOG "[19] OK - %TASK_NAME% started."
timeout /t 5 /nobreak >nul

set "FAILED_STEP=health check"
echo [20] START - poll http://127.0.0.1:%PORT%/api/healthz for up to 120 seconds
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ok=$false; for ($i=1; $i -le 120; $i++) { " ^
  "  try { " ^
  "    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/healthz' -TimeoutSec 2; " ^
  "    if ($r.StatusCode -eq 200) { Write-Host ('[20] OK - /api/healthz HTTP 200 (attempt ' + $i + ')'); $ok=$true; break } " ^
  "    Write-Host ('[20] /api/healthz HTTP ' + [string]$r.StatusCode + ' (attempt ' + $i + ')') " ^
  "  } catch { Write-Host ('[20] /api/healthz not ready (attempt ' + $i + ')') } " ^
  "  Start-Sleep -Seconds 1 " ^
  "}; if (-not $ok) { Write-Host '[20] ERROR - /api/healthz did not return HTTP 200 within 120 seconds.'; exit 1 }; exit 0" > "%TEMP%\acerpts-health-poll.txt" 2>&1
set "HEALTH_EC=!ERRORLEVEL!"
if exist "%TEMP%\acerpts-health-poll.txt" (
  type "%TEMP%\acerpts-health-poll.txt"
  if exist "%DEPLOY_LOG%" type "%TEMP%\acerpts-health-poll.txt" >> "%DEPLOY_LOG%"
)
if not "!HEALTH_EC!"=="0" (
  set "FAIL_REASON=/api/healthz did not return HTTP 200 within 120 seconds."
  echo [20] ERROR - !FAIL_REASON!
  goto :FAIL
)
set "HEALTH_STATUS=HTTP 200"
call :LOG "[20] OK - /api/healthz HTTP 200"

set "FAILED_STEP=port 3003 LISTENING"
echo [21] START - netstat LISTENING on TCP %PORT%
netstat -ano | findstr /C:":%PORT%" > "%TEMP%\acerpts-netstat.txt" 2>&1
if exist "%TEMP%\acerpts-netstat.txt" type "%TEMP%\acerpts-netstat.txt"
findstr /I "LISTENING" "%TEMP%\acerpts-netstat.txt" >nul 2>&1
if errorlevel 1 (
  set "FAIL_REASON=Port %PORT% is not LISTENING."
  echo [21] ERROR - !FAIL_REASON!
  goto :FAIL
)
set "PORT_LISTEN=LISTENING"
call :LOG "[21] OK - port %PORT% LISTENING"

set "FAILED_STEP=process and task verification"
echo [22] START - verify node.exe and %TASK_NAME%
call :ENSURE_NODE_EXE
if errorlevel 1 (
  echo [22] ERROR - !FAIL_REASON!
  goto :FAIL
)
call :CAPTURE powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_DIR%\scripts\register-acerpts-startup.ps1" -Mode Verify -TaskName "%TASK_NAME%" -NodeExe "!NODE_EXE!" -AppDir "%APP_DIR%" -Entry "%APP_DIR%\server\index.mjs"
if errorlevel 1 (
  set "FAIL_REASON=ACEMCC-ACERPTS task or node.exe verification failed."
  echo [22] ERROR - !FAIL_REASON!
  goto :FAIL
)
set "PROCESS_OK=1"
set "TASK_OK=1"
call :LOG "[22] OK - node.exe is running production server entry"

set "FAILED_STEP=final gate"
echo [23] START - final deployment gate
set "GATE_FAIL_REASON="
if not exist "%APP_DIR%\server\index.mjs" set "GATE_FAIL_REASON=missing server/index.mjs"
if not defined GATE_FAIL_REASON if not exist "%APP_DIR%\.env" set "GATE_FAIL_REASON=missing .env"
if not defined GATE_FAIL_REASON if not exist "%APP_DIR%\node_modules" set "GATE_FAIL_REASON=missing node_modules"
if not defined GATE_FAIL_REASON if not "!TASK_OK!"=="1" set "GATE_FAIL_REASON=TASK_OK is !TASK_OK!"
if not defined GATE_FAIL_REASON if not "!PROCESS_OK!"=="1" set "GATE_FAIL_REASON=PROCESS_OK is !PROCESS_OK!"
if not defined GATE_FAIL_REASON if /I not "!PORT_LISTEN!"=="LISTENING" set "GATE_FAIL_REASON=PORT_LISTEN is !PORT_LISTEN!"
if not defined GATE_FAIL_REASON if /I not "!HEALTH_STATUS!"=="HTTP 200" set "GATE_FAIL_REASON=HEALTH_STATUS is !HEALTH_STATUS!"
if not defined GATE_FAIL_REASON if not "!RUN_PHASE!"=="synced" set "GATE_FAIL_REASON=RUN_PHASE is !RUN_PHASE!"
if not defined GATE_FAIL_REASON if not "!SYNC_OK!"=="1" set "GATE_FAIL_REASON=SYNC_OK is !SYNC_OK!"
if not defined GATE_FAIL_REASON if not "!DEPLOY_VERIFY_OK!"=="1" set "GATE_FAIL_REASON=DEPLOY_VERIFY_OK is !DEPLOY_VERIFY_OK!"
if not defined GATE_FAIL_REASON if not exist "!DEPLOY_SYNC_MARKER!" set "GATE_FAIL_REASON=missing sync marker !DEPLOY_SYNC_MARKER!"
if defined GATE_FAIL_REASON goto :GATE_FAIL
call :LOG "[23] OK - all deployment gates passed DEPLOY_RUN_ID=!DEPLOY_RUN_ID!"
goto :SUCCESS

:GATE_FAIL
set "FAIL_REASON=Final gate failed for DEPLOY_RUN_ID=!DEPLOY_RUN_ID! (!GATE_FAIL_REASON!)."
echo [23] ERROR - !FAIL_REASON!
goto :FAIL

:SUCCESS
echo.
echo ===============================================
echo  ACE RESULTS PORTAL DEPLOYMENT COMPLETE
echo ===============================================
echo.
echo Application:
echo %APP_DIR%
echo.
echo Entry:
echo %APP_DIR%\server\index.mjs
echo.
echo Port:
echo 3003 LISTENING
echo.
echo Health:
echo HTTP 200
echo.
echo Startup Task:
echo ACEMCC-ACERPTS
echo.
echo Portal:
echo http://192.168.10.55:3003/
echo.
echo Log:
echo %DEPLOY_LOG%
echo.
echo ===============================================
echo.
call :LOG "DEPLOYMENT COMPLETE - all gates passed DEPLOY_RUN_ID=!DEPLOY_RUN_ID!"
call :RELEASE_LOCK
echo Press any key to close...
if /I "%ACERPTS_ONECLICK_NOPAUSE%"=="1" exit 0
pause
exit 0

:FAIL_NO_LOCK
echo.
echo ===============================================
echo  ACE RESULTS PORTAL DEPLOYMENT BLOCKED
echo ===============================================
echo.
if defined FAIL_REASON (echo !FAIL_REASON!) else (echo Another deployment may be active.)
echo.
echo Log:
echo %DEPLOY_LOG%
echo.
echo ===============================================
echo.
if /I "%ACERPTS_ONECLICK_NOPAUSE%"=="1" exit 2
pause
exit 2

:IS_SOURCE_REPO
if /I "%~1"=="C:\ACERPTS\Deployments" exit /b 1
if /I "%~1"=="C:\ACERPTS\app" exit /b 1
if /I "%~1"=="D:\ACERPTS\Deployments" exit /b 1
if /I "%~1"=="D:\ACERPTS\app" exit /b 1
if not exist "%~1\.env.production" exit /b 1
if not exist "%~1\.env" exit /b 1
if not exist "%~1\package.json" exit /b 1
if not exist "%~1\scripts\apply-production-env.mjs" exit /b 1
if not exist "%~1\ACERPTS_OneClick.bat" exit /b 1
exit /b 0

:ENSURE_ENV_KEY
findstr /b /i /c:"%~1=" "%APP_DIR%\.env" >nul 2>&1
if errorlevel 1 (
  >>"%APP_DIR%\.env" echo %~1=%~2
  call :LOG "[14] appended missing key %~1"
)
exit /b 0

:SET_ENV_KEY
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%APP_DIR%\.env'; $k='%~1'; $v='%~2'; if (-not (Test-Path -LiteralPath $p)) { exit 1 }; $lines=Get-Content -LiteralPath $p; $found=$false; $out=@(foreach($line in $lines){ if($line -match ('^\s*' + [regex]::Escape($k) + '\s*=')){ $found=$true; ($k + '=' + $v) } else { $line } }); if(-not $found){ $out += ($k + '=' + $v) }; $utf8=New-Object System.Text.UTF8Encoding $false; [System.IO.File]::WriteAllLines($p, $out, $utf8)"
if errorlevel 1 (
  call :LOG "[14] WARN - could not set %~1"
) else (
  call :LOG "[14] set %~1 ok"
)
exit /b 0

:ENSURE_NODE_EXE
if defined NODE_EXE if exist "!NODE_EXE!" exit /b 0
set "NODE_EXE="
if exist "%ProgramFiles%\nodejs" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node.exe >nul 2>&1
if errorlevel 1 (
  set "FAIL_REASON=Node.js executable not found for scheduled task registration."
  exit /b 1
)
for /f "delims=" %%P in ('where node.exe 2^>nul') do (
  set "NODE_EXE=%%P"
  exit /b 0
)
set "FAIL_REASON=where node.exe resolved a missing path."
exit /b 1

:LOG
echo %*
if not defined DEPLOY_LOG exit /b 0
>>"%DEPLOY_LOG%" echo [%DATE% %TIME%] %*
exit /b 0

:RELEASE_LOCK
if not "!DEPLOY_LOCK_HELD!"=="1" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_DIR%\scripts\oneclick-deploy-lock.ps1" -LockAction Release -LockFile "%DEPLOY_LOCK%" -DeployRunId "%DEPLOY_RUN_ID%"
set "DEPLOY_LOCK_HELD=0"
exit /b 0

:CAPTURE
if defined DEPLOY_LOG set "DEPLOY_LOG=%DEPLOY_LOG%"
set "CAP=%TEMP%\acerpts-oneclick-capture.txt"
if exist "%CAP%" del /F /Q "%CAP%" >nul 2>&1
call %* > "%CAP%" 2>&1
set "CAP_EC=!ERRORLEVEL!"
if exist "%CAP%" (
  type "%CAP%"
  if exist "%DEPLOY_LOG%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$src = $env:TEMP + '\acerpts-oneclick-capture.txt'; $dst = $env:DEPLOY_LOG; " ^
      "if (-not $dst) { $dst = 'D:\ACERPTS\logs\oneclick-deploy.log'; if (-not (Test-Path -LiteralPath (Split-Path $dst))) { $dst = 'C:\ACERPTS\logs\oneclick-deploy.log' } }; " ^
      "if ((Test-Path -LiteralPath $src) -and (Test-Path -LiteralPath $dst)) { " ^
      "  Get-Content -LiteralPath $src -ErrorAction SilentlyContinue | ForEach-Object { " ^
      "    $_ -replace '(?i)((?:password|secret|token|jwt|authorization)[^=\s:]*)([:=]\s*)\S+','$1$2***' " ^
      "  } | Add-Content -LiteralPath $dst -ErrorAction SilentlyContinue " ^
      "}"
  )
)
exit /b !CAP_EC!

:FAIL
call :RELEASE_LOCK
echo.
echo ===============================================
echo  ACE RESULTS PORTAL DEPLOYMENT FAILED
echo ===============================================
echo.
echo Failed Step:
echo !FAILED_STEP!
echo.
echo Reason:
if defined FAIL_REASON (echo !FAIL_REASON!) else (echo See the ERROR line above.)
echo.
echo Diagnostics:
echo Application:
echo %APP_DIR%
echo.
echo Startup Task:
echo ACEMCC-ACERPTS
echo.
echo Health:
echo !HEALTH_STATUS!
echo.
echo Port:
echo !PORT_LISTEN!
echo.
echo Log:
echo %DEPLOY_LOG%
echo.
echo ===============================================
echo.
echo DEPLOYMENT FAILED step=!FAILED_STEP! reason=!FAIL_REASON!
if exist "%DEPLOY_LOG%" (
  set "FAILED_STEP=!FAILED_STEP!"
  set "FAIL_REASON=!FAIL_REASON!"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Content -LiteralPath $env:DEPLOY_LOG -Value ('[' + (Get-Date).ToString() + '] DEPLOYMENT FAILED step=' + $env:FAILED_STEP + ' reason=' + $env:FAIL_REASON)"
)
echo Press any key to close...
if /I "%ACERPTS_ONECLICK_NOPAUSE%"=="1" exit 1
pause
exit 1
