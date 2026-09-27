# Build Wiki Explorer as a Windows app (.exe)
# Auto-installs all prerequisites if missing

$ErrorActionPreference = "Stop"

# Navigate to project root (script is in scripts/)
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "🔨 Building Wiki Explorer for Windows..." -ForegroundColor Cyan

# ─── 1. Node.js ──────────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "📦 Node.js not found — installing..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install nodejs-lts --yes
    } else {
        Write-Host "❌ Cannot auto-install Node.js. Please install from https://nodejs.org" -ForegroundColor Red
        exit 1
    }
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
Write-Host "✅ Node $(node -v)" -ForegroundColor Green

# ─── 2. Python ───────────────────────────────────────────────────────────────
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "📦 Python not found — installing..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements --silent
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install python --yes
    } else {
        Write-Host "❌ Cannot auto-install Python. Please install from https://python.org" -ForegroundColor Red
        exit 1
    }
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
Write-Host "✅ Python $(python --version)" -ForegroundColor Green

# ─── 3. Ollama (required for AI features) ────────────────────────────────────
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "📦 Ollama not found — installing..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent
    } else {
        Write-Host "❌ Cannot auto-install Ollama. Please download from https://ollama.ai" -ForegroundColor Red
        exit 1
    }
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
Write-Host "✅ Ollama installed" -ForegroundColor Green

# Pull required models if not present
Write-Host "📦 Checking Ollama models..." -ForegroundColor Yellow
$models = ollama list 2>$null
if ($models -notmatch "nomic-embed-text") {
    Write-Host "   Pulling nomic-embed-text (embedding model)..."
    ollama pull nomic-embed-text
}
if ($models -notmatch "qwen3:8b") {
    Write-Host "   Pulling qwen3:8b (chat model)..."
    ollama pull qwen3:8b
}
Write-Host "✅ Ollama models ready" -ForegroundColor Green

# ─── Build Steps ─────────────────────────────────────────────────────────────

# Install npm dependencies
Write-Host "📦 Installing npm dependencies..." -ForegroundColor Yellow
npm install

# Build the frontend (Vite)
Write-Host "🎨 Building frontend..." -ForegroundColor Yellow
npm run build

# Compile Electron TypeScript
Write-Host "⚡ Compiling Electron..." -ForegroundColor Yellow
npx tsc -p tsconfig.electron.json

# Set up Python virtual environment for agents
Write-Host "🐍 Setting up Python environment..." -ForegroundColor Yellow
if (-not (Test-Path "agents\.venv")) {
    python -m venv agents\.venv
}
& agents\.venv\Scripts\pip.exe install -q -r agents\requirements.txt

# Build bundled Python agent (PyInstaller)
Write-Host "📦 Building Python agent bundle..." -ForegroundColor Yellow
& .\scripts\build-agent.ps1

# Build the Windows app
Write-Host "🪟 Building Windows app..." -ForegroundColor Yellow
npm run electron:build:win

# Clean up build artifacts
Write-Host "🧹 Cleaning up build artifacts..." -ForegroundColor Yellow
Remove-Item -Recurse -Force app\win-unpacked -ErrorAction SilentlyContinue
Remove-Item -Force app\*.blockmap -ErrorAction SilentlyContinue
Remove-Item -Force app\builder-debug.yml -ErrorAction SilentlyContinue
Remove-Item -Force app\builder-effective-config.yaml -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "✅ Build complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📁 Output files in app/:" -ForegroundColor Cyan
Get-ChildItem app\*.exe 2>$null | ForEach-Object { Write-Host "   $($_.Name)" }
Write-Host ""
Write-Host "To install: Run the Setup .exe installer"
