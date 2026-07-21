#!/bin/bash
# Build Wiki Explorer as a macOS app (.dmg)

set -e

# Navigate to project root (script is in scripts/)
cd "$(dirname "$0")/.."

echo "🔨 Building Wiki Explorer for macOS..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

# Check for Python (needed for agents)
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3 first."
    exit 1
fi

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# Build the frontend (Vite)
echo "🎨 Building frontend..."
npm run build

# Compile Electron TypeScript
echo "⚡ Compiling Electron..."
npx tsc -p tsconfig.electron.json

# Set up Python virtual environment for agents
echo "🐍 Setting up Python environment..."
if [ ! -d "agents/.venv" ]; then
    python3 -m venv agents/.venv
fi
source agents/.venv/bin/activate
pip install -q -r agents/requirements.txt
deactivate

# Build the macOS app
echo "🍎 Building macOS app..."
npm run electron:build:mac

# Clean up build artifacts
echo "🧹 Cleaning up build artifacts..."
cd app
rm -rf .icon-icns mac-universal *.blockmap builder-debug.yml builder-effective-config.yaml 2>/dev/null
cd ..

echo ""
echo "✅ Build complete!"
echo ""
echo "📁 Output files in app/:"
ls -lh app/*.dmg app/*.zip 2>/dev/null || echo "   (check app/ folder)"
echo ""
echo "To install: Open the .dmg file and drag Wiki Explorer to Applications"
