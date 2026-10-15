@echo off
REM ACE Results Portal — boot/service launcher (run by ACEMCC-ACERPTS scheduled task)
REM Waits for disk, logs output, runs node so the portal stays up after reboot.
setlocal EnableExtensions
cd /d "%~dp0"

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
for %%I in ("%APP_DIR%\..") do set "ROOT_DIR=%%~fI"
set "LOG_DIR=%ROOT_DIR%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
set "LOG=%LOG_DIR%\service.log"
set "ENTRY=%APP_DIR%\server\index.mjs"

set "NODE_EXE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE (
  for /f "delims=" %%P in ('where node.exe 2^>nul') do (
    set "NODE_EXE=%%P"
    goto :HAVE_NODE
  )
)
:HAVE_NODE

>>"%LOG%" echo.
>>"%LOG%" echo ========== %DATE% %TIME% ACEMCC-ACERPTS start ==========
>>"%LOG%" echo APP_DIR=%APP_DIR%
>>"%LOG%" echo ENTRY=%ENTRY%
>>"%LOG%" echo NODE_EXE=%NODE_EXE%

if not defined NODE_EXE (
  >>"%LOG%" echo ERROR: node.exe not found
  exit /b 1
)
if not exist "%NODE_EXE%" (
  >>"%LOG%" echo ERROR: node.exe missing at %NODE_EXE%
  exit /b 1
)

REM After long power-off, D: may not be mounted yet. Wait up to 3 minutes.
REM ping works when this cmd runs with no console (Task Scheduler / SYSTEM).
set /a WAIT_TRIES=0
:WAIT_ENTRY
if exist "%ENTRY%" goto :READY
set /a WAIT_TRIES+=1
if %WAIT_TRIES% GEQ 36 (
  >>"%LOG%" echo ERROR: missing %ENTRY% after 180s — retrying entry wait
  set /a WAIT_TRIES=0
)
ping -n 6 127.0.0.1 >nul
goto :WAIT_ENTRY

:READY
>>"%LOG%" echo Entry ready (wait_tries=%WAIT_TRIES%). Launcher will restart node whenever it exits.
cd /d "%APP_DIR%"

:RUN
>>"%LOG%" echo Starting node at %DATE% %TIME%
"%NODE_EXE%" "%ENTRY%" >>"%LOG%" 2>&1
set "EC=%ERRORLEVEL%"
>>"%LOG%" echo Exited with code %EC% at %DATE% %TIME% — restarting in 15 seconds
ping -n 16 127.0.0.1 >nul
goto :RUN
