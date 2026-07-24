# Build script for packaging the Python agent as a standalone executable.
# Uses PyInstaller to create a single executable that includes all dependencies.
#
# Usage:
#   .\scripts\build-agent.ps1
#
# Output:
#   dist-agent\wiki-agent\ (executable folder)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$AgentsDir = Join-Path $ProjectRoot "agents"
$OutputDir = Join-Path $ProjectRoot "dist-agent"

Write-Host "=== Building wiki-explorer agent ===" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"
Write-Host "Agents dir: $AgentsDir"
Write-Host "Output dir: $OutputDir"

# Change to agents directory
Set-Location $AgentsDir

# Check if venv exists, create if not
if (-not (Test-Path ".venv")) {
    Write-Host "Creating Python virtual environment..."
    python -m venv .venv
}

# Activate venv
& .\.venv\Scripts\Activate.ps1

# Install dependencies + PyInstaller
Write-Host "Installing dependencies..."
pip install -q -r requirements.txt
pip install -q pyinstaller

# Clean previous builds
if (Test-Path $OutputDir) {
    Remove-Item -Recurse -Force $OutputDir
}
Remove-Item -Recurse -Force build -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
Remove-Item -Force *.spec -ErrorAction SilentlyContinue

# Build with PyInstaller
Write-Host "Building agent with PyInstaller..."
pyinstaller `
    --name wiki-agent `
    --onedir `
    --console `
    --noconfirm `
    --clean `
    --add-data "config.py;." `
    --add-data "agents;agents" `
    --add-data "models;models" `
    --add-data "services;services" `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.protocols.http `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan `
    --hidden-import uvicorn.lifespan.on `
    --hidden-import uvicorn.lifespan.off `
    --hidden-import httptools `
    --hidden-import uvloop `
    --hidden-import watchfiles `
    --hidden-import chromadb `
    --hidden-import chromadb.config `
    --hidden-import chromadb.api `
    --hidden-import chromadb.api.client `
    --hidden-import onnxruntime `
    --hidden-import tokenizers `
    --hidden-import markitdown `
    --collect-all chromadb `
    --collect-all markitdown `
    --collect-all onnxruntime `
    main.py

# Move output to dist-agent
Move-Item -Force dist\wiki-agent $OutputDir

# Clean up build artifacts
Remove-Item -Recurse -Force build -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
Remove-Item -Force *.spec -ErrorAction SilentlyContinue

# Return to project root
Set-Location $ProjectRoot

Write-Host ""
Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host "Agent executable: $OutputDir\wiki-agent\wiki-agent.exe"
Write-Host ""
Write-Host "To test: $OutputDir\wiki-agent\wiki-agent.exe"

deactivate
