# ─────────────────────────────────────────────────────────────────────────────
# start-ai.ps1  —  Start the full wiki-explorer AI stack (Windows)
#
# Installs all prerequisites automatically, then starts:
#   1. ChromaDB server       (port 8001)
#   2. Ollama                (port 11434) + pulls models on first run
#   3. Python agent service  (port 8000)
#   4. wiki-explorer         (Express 3001 + Vite 5173)
#
# Usage:
#   Right-click → "Run with PowerShell"
#   or:  powershell -ExecutionPolicy Bypass -File .\scripts\start-ai.ps1
#
# macOS/Linux users: use ./scripts/start-ai.sh instead
# ─────────────────────────────────────────────────────────────────────────────
#Requires -Version 5.1
param(
    [string]$OllamaModel     = "qwen3:8b",
    [string]$OllamaEmbedModel = "nomic-embed-text"
)

$ErrorActionPreference = "Stop"
# Navigate to project root (script is in scripts/)
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectDir
$AgentsDir  = Join-Path $ProjectDir "agents"
$LogDir     = Join-Path $ProjectDir ".ai-logs"
$null       = New-Item -ItemType Directory -Force -Path $LogDir

function Write-Info    { param($msg) Write-Host "[wiki-ai] $msg" -ForegroundColor Cyan   }
function Write-Success { param($msg) Write-Host "[wiki-ai] $msg" -ForegroundColor Green  }
function Write-Warn    { param($msg) Write-Host "[wiki-ai] $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "[wiki-ai] $msg" -ForegroundColor Red    }

# ─── Track spawned processes for cleanup ────────────────────────────────────
$SpawnedProcs = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Stop-AllSpawned {
    foreach ($proc in $SpawnedProcs) {
        if (-not $proc.HasExited) {
            try {
                # Kill the process tree (handles child processes)
                taskkill /PID $proc.Id /T /F 2>$null | Out-Null
            } catch { }
        }
    }
}

# ─── Check a TCP port is in use ──────────────────────────────────────────────
function Test-PortListening {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
}

# ─── Wait for a port to become available ─────────────────────────────────────
function Wait-ForPort {
    param([int]$Port, [int]$MaxSeconds = 15, [string]$ServiceName = "service")
    for ($i = 0; $i -lt $MaxSeconds; $i++) {
        if (Test-PortListening $Port) { return $true }
        Start-Sleep 1
    }
    return $false
}

# ─── Helper: refresh PATH after installs ────────────────────────────────────
function Update-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

# ─── Stop previous AI processes on our ports ─────────────────────────────────
function Stop-OurPortProcess {
    param([int]$Port, [string]$Pattern)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { return }
    
    foreach ($c in $conn) {
        $procId = $c.OwningProcess
        $proc   = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        
        $wmiProc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
        $cmdLine = if ($wmiProc -and $wmiProc.CommandLine) { $wmiProc.CommandLine } else { $proc.ProcessName }
        
        if ($cmdLine -match $Pattern) {
            Write-Warn "Stopping previous process on port $Port (PID $procId)..."
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            Start-Sleep 1
        }
    }
}

Stop-OurPortProcess 8001 'chroma'
Stop-OurPortProcess 8000 'uvicorn|agents'
Stop-OurPortProcess 3001 'tsx|server.index'
Stop-OurPortProcess 5173 'vite'

# ─── 1. Node / npm ───────────────────────────────────────────────────────────
Write-Info "Checking Node.js..."
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Warn "npm not found — installing Node.js LTS..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install nodejs-lts --yes
    } else {
        # Download MSI directly
        $indexPage = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
        $lts       = $indexPage | Where-Object { $_.lts } | Select-Object -First 1
        $installer = "$env:TEMP\node-lts-installer.msi"
        Invoke-WebRequest -Uri "https://nodejs.org/dist/$($lts.version)/node-$($lts.version)-x64.msi" `
            -OutFile $installer -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$installer`" /qn /norestart" -Wait -Verb RunAs
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
    }
    Update-Path
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Fail "Node.js installed but npm still not on PATH. Restart your terminal and re-run."
        exit 1
    }
}
Write-Success "Node $(node -v)  /  npm $(npm -v)"

# ─── 2. Python ───────────────────────────────────────────────────────────────
Write-Info "Checking Python..."
if (-not (Get-Command python -ErrorAction SilentlyContinue) -and
    -not (Get-Command python3 -ErrorAction SilentlyContinue)) {
    Write-Warn "Python not found — installing..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id Python.Python.3 --accept-package-agreements --accept-source-agreements --silent
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install python --yes
    } else {
        # Download installer
        $pyVer     = '3.12.4'
        $installer = "$env:TEMP\python-installer.exe"
        Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$pyVer/python-$pyVer-amd64.exe" `
            -OutFile $installer -UseBasicParsing
        Start-Process $installer -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1' -Wait -Verb RunAs
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
    }
    Update-Path
}
$Python = if (Get-Command python3 -ErrorAction SilentlyContinue) { 'python3' } else { 'python' }
Write-Success "Python $(& $Python --version)"

# ─── 3. Ollama ───────────────────────────────────────────────────────────────
Write-Info "Checking Ollama..."
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Warn "Ollama not found — installing..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent
    } else {
        # Direct download
        $installer = "$env:TEMP\OllamaSetup.exe"
        Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' `
            -OutFile $installer -UseBasicParsing
        Start-Process $installer -ArgumentList '/S' -Wait
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
    }
    Update-Path
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Write-Fail "Ollama installed but not on PATH. Restart your terminal and re-run."
        exit 1
    }
}
Write-Success "Ollama ready"

# ─── 4. npm install (wiki-explorer deps) ─────────────────────────────────────
Write-Info "Installing Node.js dependencies..."
Set-Location $ProjectDir
if (-not (Test-Path (Join-Path $ProjectDir 'node_modules'))) {
    npm install --silent
}

# ─── 5. Python venv + agent deps (must happen BEFORE starting ChromaDB) ──────
# All Python packages (chromadb, uvicorn, etc.) live in the agents venv.
# This avoids PEP 668 and keeps the system Python clean.
Write-Info "Setting up Python virtual environment..."
$VenvDir     = Join-Path $AgentsDir '.venv'
$VenvPython  = Join-Path $VenvDir 'Scripts\python.exe'
$VenvUvicorn = Join-Path $VenvDir 'Scripts\uvicorn.exe'
$VenvChroma  = Join-Path $VenvDir 'Scripts\chroma.exe'

if (-not (Test-Path $VenvDir)) {
    Write-Info "Creating virtual environment..."
    & $Python -m venv $VenvDir
}

Write-Info "Installing/updating Python dependencies..."
& $VenvPython -m pip install -q --upgrade pip
& $VenvPython -m pip install -q -r (Join-Path $AgentsDir 'requirements.txt')
Write-Success "Python environment ready"

$EnvFile    = Join-Path $AgentsDir '.env'
$EnvExample = Join-Path $AgentsDir '.env.example'
if (-not (Test-Path $EnvFile) -and (Test-Path $EnvExample)) {
    Copy-Item $EnvExample $EnvFile
    Write-Info "Created agents\.env from .env.example"
}

# ─── 6. ChromaDB ─────────────────────────────────────────────────────────────
if (Test-PortListening 8001) {
    Write-Info "ChromaDB already listening on port 8001"
} else {
    Write-Info "Starting ChromaDB on port 8001..."
    $chromaLog  = Join-Path $LogDir "chroma.log"
    $chromaDb   = Join-Path $LogDir "chromadb"
    $chromaProc = Start-Process -FilePath $VenvChroma `
        -ArgumentList "run --host 0.0.0.0 --port 8001 --path `"$chromaDb`"" `
        -RedirectStandardOutput $chromaLog `
        -RedirectStandardError  "$chromaLog.err" `
        -PassThru -NoNewWindow -WorkingDirectory $ProjectDir
    $SpawnedProcs.Add($chromaProc)

    if (-not (Wait-ForPort 8001 15 "ChromaDB")) {
        Write-Fail "ChromaDB failed to start. Check $chromaLog"
        Get-Content $chromaLog -ErrorAction SilentlyContinue | Select-Object -Last 10
        Stop-AllSpawned; exit 1
    }
    Write-Success "ChromaDB running (PID $($chromaProc.Id))"
}

# ─── 7. Ollama ───────────────────────────────────────────────────────────────
$ollamaRunning = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($ollamaRunning) {
    Write-Info "Ollama already running"
} else {
    Write-Info "Starting Ollama..."
    $ollamaLog  = Join-Path $LogDir "ollama.log"
    $ollamaProc = Start-Process -FilePath "ollama" `
        -ArgumentList "serve" `
        -RedirectStandardOutput $ollamaLog `
        -RedirectStandardError  "$ollamaLog.err" `
        -PassThru -NoNewWindow
    $SpawnedProcs.Add($ollamaProc)

    Start-Sleep 3
    if ($ollamaProc.HasExited) {
        Write-Fail "Ollama failed to start. Check $ollamaLog"
        Stop-AllSpawned; exit 1
    }
    Write-Success "Ollama running (PID $($ollamaProc.Id))"
}

$OllamaModelEnv      = if ($env:OLLAMA_MODEL)       { $env:OLLAMA_MODEL }       else { $OllamaModel }
$OllamaEmbedModelEnv = if ($env:OLLAMA_EMBED_MODEL) { $env:OLLAMA_EMBED_MODEL } else { $OllamaEmbedModel }

foreach ($model in @($OllamaModelEnv, $OllamaEmbedModelEnv)) {
    $modelList = ollama list 2>$null
    if ($modelList -notmatch [regex]::Escape($model)) {
        Write-Info "Pulling model: $model (first run — may take several minutes)..."
        ollama pull $model
        Write-Success "Model ready: $model"
    } else {
        Write-Info "Model already present: $model"
    }
}

# ─── 8. Python agent service ──────────────────────────────────────────────────
Write-Info "Starting Python agent service on port 8000..."
$agentLog  = Join-Path $LogDir "agents.log"
$agentProc = Start-Process -FilePath $VenvUvicorn `
    -ArgumentList "main:app --host 0.0.0.0 --port 8000 --reload" `
    -RedirectStandardOutput $agentLog `
    -RedirectStandardError  "$agentLog.err" `
    -PassThru -NoNewWindow -WorkingDirectory $AgentsDir
$SpawnedProcs.Add($agentProc)

if (-not (Wait-ForPort 8000 20 "Agent service")) {
    Write-Fail "Agent service failed to start. Check $agentLog"
    Get-Content $agentLog -ErrorAction SilentlyContinue | Select-Object -Last 20
    Stop-AllSpawned; exit 1
}
Write-Success "Agent service running (PID $($agentProc.Id))"

# ─── 9. wiki-explorer ────────────────────────────────────────────────────────
Write-Info "Starting wiki-explorer..."
Set-Location $ProjectDir
$wikiProc = Start-Process -FilePath "npm" `
    -ArgumentList "run dev" `
    -PassThru -NoNewWindow -WorkingDirectory $ProjectDir
$SpawnedProcs.Add($wikiProc)

Start-Sleep 3

# ─── Ready ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Success "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Success "  wiki-explorer AI stack is running"
Write-Host ""
Write-Host "  UI            ->  http://localhost:5173"    -ForegroundColor Cyan
Write-Host "  Express API   ->  http://localhost:3001"    -ForegroundColor Cyan
Write-Host "  Agent service ->  http://localhost:8000/health" -ForegroundColor Cyan
Write-Host "  ChromaDB      ->  http://localhost:8001"    -ForegroundColor Cyan
Write-Host "  Ollama        ->  http://localhost:11434"   -ForegroundColor Cyan
Write-Host ""
Write-Host "  Logs: $LogDir" -ForegroundColor Yellow
Write-Success "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host ""
Write-Info "Press Ctrl+C to stop all services"

# Open browser
Start-Process "http://localhost:5173"

# ─── Wait and cleanup ────────────────────────────────────────────────────────
try {
    # Block until any spawned process exits or Ctrl+C
    while ($true) {
        foreach ($proc in $SpawnedProcs) {
            if ($proc.HasExited) {
                Write-Fail "Process (PID $($proc.Id)) exited unexpectedly"
                Stop-AllSpawned
                exit 1
            }
        }
        Start-Sleep 2
    }
} finally {
    Write-Info "Shutting down all services..."
    Stop-AllSpawned
    Write-Success "All services stopped."
}
