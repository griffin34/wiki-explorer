# ─────────────────────────────────────────────────────────────────────────────
# start.ps1  —  Install deps and launch Wiki Explorer (Windows)
# Usage:  Right-click → "Run with PowerShell"
#         or in a terminal:  powershell -ExecutionPolicy Bypass -File .\start.ps1
# ─────────────────────────────────────────────────────────────────────────────
#Requires -Version 5.1
param()

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$UI_URL    = "http://localhost:5173"

function Write-Green  { param($msg) Write-Host $msg -ForegroundColor Green  }
function Write-Yellow { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Red    { param($msg) Write-Host $msg -ForegroundColor Red    }

# ── 1. Ensure Node / npm is available ────────────────────────────────────────
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Yellow "npm not found — installing Node.js LTS..."

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Yellow "Installing via winget..."
        winget install --id OpenJS.NodeJS.LTS `
              --accept-package-agreements `
              --accept-source-agreements `
              --silent
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Yellow "Installing via Chocolatey..."
        choco install nodejs-lts --yes
    } else {
        Write-Yellow "Downloading Node.js LTS installer..."
        $indexPage   = Invoke-RestMethod "https://nodejs.org/dist/index.json"
        $lts         = $indexPage | Where-Object { $_.lts } | Select-Object -First 1
        $version     = $lts.version
        $installer   = "$env:TEMP\node-lts-installer.msi"
        $downloadUrl = "https://nodejs.org/dist/$version/node-$version-x64.msi"
        Write-Yellow "Downloading $downloadUrl ..."
        Invoke-WebRequest -Uri $downloadUrl -OutFile $installer -UseBasicParsing
        Write-Yellow "Running installer (this may take a minute)..."
        Start-Process msiexec.exe -ArgumentList "/i `"$installer`" /qn /norestart" -Wait -Verb RunAs
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
    }

    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Red "Node.js installed but npm is still not on PATH. Restart your terminal and re-run."
        exit 1
    }
}

Write-Green "Node $(node -v)  /  npm $(npm -v)"

# ── 2. Stop any previous wiki-explorer processes on our ports ─────────────────
# Checks the full command line of the owning process. Only kills it if it looks
# like our app (contains tsx / vite / wiki-explorer / server\index).
# Leaves unrelated processes alone.
function Stop-IfOurs {
    param([int]$Port)

    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { return }

    foreach ($c in $conn) {
        $procId  = $c.OwningProcess
        $proc    = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if (-not $proc) { continue }

        # Get the full command line (not just the exe name)
        $wmiProc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
        $cmdLine = if ($wmiProc -and $wmiProc.CommandLine) { $wmiProc.CommandLine } else { $proc.ProcessName }

        if ($cmdLine -match 'tsx|vite|wiki.?explorer|server.index') {
            Write-Yellow "Stopping previous wiki-explorer on port $Port (PID $procId)..."
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue

            # Wait up to 3 s for the port to free
            $waited = 0
            while ((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) -and $waited -lt 3) {
                Start-Sleep 1; $waited++
            }
        } else {
            Write-Yellow "Port $Port is already in use by another process — leaving it alone:"
            Write-Yellow "  $cmdLine"
        }
    }
}

Stop-IfOurs 3001
Stop-IfOurs 5173

# ── 3. Install dependencies ───────────────────────────────────────────────────
Set-Location $ScriptDir
Write-Green "`nInstalling dependencies..."
npm install

# ── 4. Start dev server ───────────────────────────────────────────────────────
Write-Green "`nStarting Wiki Explorer..."

$devProc = Start-Process -FilePath "npm" `
    -ArgumentList "run dev" `
    -WorkingDirectory $ScriptDir `
    -PassThru -NoNewWindow

# ── 5. Wait for Vite (port 5173) to be ready ─────────────────────────────────
Write-Yellow "Waiting for dev server to start..."
$ready   = $false
$maxWait = 30

for ($i = 0; $i -lt $maxWait; $i++) {
    if ($devProc.HasExited) {
        Write-Red "Dev process exited unexpectedly. Check the terminal output above."
        exit 1
    }
    try {
        $resp = Invoke-WebRequest -Uri $UI_URL -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        if ($resp.StatusCode -lt 500) { $ready = $true; break }
    } catch { }
    Start-Sleep 1
}

if (-not $ready) {
    Write-Yellow "Server is taking longer than expected — opening browser anyway..."
}

# ── 6. Open browser ───────────────────────────────────────────────────────────
Write-Green "`nOpening $UI_URL"
Start-Process $UI_URL

Write-Green "Wiki Explorer is running."
Write-Green "Close this window or press Ctrl+C to stop.`n"

try {
    Wait-Process -Id $devProc.Id
} finally {
    if (-not $devProc.HasExited) {
        Stop-Process -Id $devProc.Id -Force -ErrorAction SilentlyContinue
    }
}
