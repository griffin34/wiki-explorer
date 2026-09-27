#!/bin/bash
# Build Wiki Explorer as a macOS app (.dmg)
# Auto-installs all prerequisites if missing

set -e

# Navigate to project root (script is in scripts/)
cd "$(dirname "$0")/.."

echo "🔨 Building Wiki Explorer for macOS..."

IS_MAC=false
[[ "$(uname)" == "Darwin" ]] && IS_MAC=true

# ─── Helper: Ensure Homebrew (macOS only) ────────────────────────────────────
ensure_brew() {
  if ! command -v brew &>/dev/null; then
    echo "📦 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [[ -f /usr/local/bin/brew   ]] && eval "$(/usr/local/bin/brew shellenv)"
  fi
}

# ─── 1. Node.js ──────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "📦 Node.js not found — installing..."
    if $IS_MAC; then
        ensure_brew && brew install node
    elif command -v apt-get &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y nodejs npm
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm nodejs npm
    else
        echo "❌ Cannot auto-install Node.js. Please install from https://nodejs.org"
        exit 1
    fi
fi
echo "✅ Node $(node -v)"

# ─── 2. Python ───────────────────────────────────────────────────────────────
if ! command -v python3 &> /dev/null && ! command -v python &>/dev/null; then
    echo "📦 Python not found — installing..."
    if $IS_MAC; then
        ensure_brew && brew install python3
    elif command -v apt-get &>/dev/null; then
        sudo apt-get install -y python3 python3-venv python3-pip
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y python3 python3-pip
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm python python-pip
    else
        echo "❌ Cannot auto-install Python. Please install from https://python.org"
        exit 1
    fi
fi

# Prefer python3
if command -v python3 &>/dev/null; then PYTHON=python3
else PYTHON=python; fi
echo "✅ $($PYTHON --version)"

# Ensure python3-venv is available on Debian/Ubuntu
if ! $PYTHON -m venv --help &>/dev/null 2>&1; then
    echo "📦 Installing python3-venv..."
    sudo apt-get install -y python3-venv 2>/dev/null || true
fi

# ─── 3. Ollama (required for AI features) ────────────────────────────────────
if ! command -v ollama &>/dev/null; then
    echo "📦 Ollama not found — installing..."
    if $IS_MAC; then
        ensure_brew && brew install ollama
    else
        curl -fsSL https://ollama.com/install.sh | sh
    fi
fi
echo "✅ Ollama installed"
echo "   (Models will be pulled automatically when the app starts)"

# ─── Build Steps ─────────────────────────────────────────────────────────────

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

# Build bundled Python agent (PyInstaller)
echo "📦 Building Python agent bundle..."
npm run build:agent

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
