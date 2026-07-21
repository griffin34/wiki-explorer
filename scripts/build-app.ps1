# Build Wiki Explorer as a Windows app (.exe)

$ErrorActionPreference = "Stop"

# Navigate to project root (script is in scripts/)
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "🔨 Building Wiki Explorer for Windows..." -ForegroundColor Cyan

# Check for Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}

# Check for Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Python not found. Please install Python first." -ForegroundColor Red
    exit 1
}

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
