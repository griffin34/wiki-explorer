#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-ai.sh — Start the full wiki-explorer AI stack (macOS / Linux)
#
# Installs all prerequisites automatically, then starts:
#   1. ChromaDB server       (port 8001)
#   2. Ollama                (port 11434) + pulls models on first run
#   3. Python agent service  (port 8000)
#   4. wiki-explorer         (Express 3001 + Vite 5173)
#
# Windows users: powershell -ExecutionPolicy Bypass -File .\scripts\start-ai.ps1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Navigate to project root (script is in scripts/)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
AGENTS_DIR="$PROJECT_DIR/agents"
LOG_DIR="$PROJECT_DIR/.ai-logs"
mkdir -p "$LOG_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()    { echo -e "${CYAN}[wiki-ai]${NC} $*"; }
success() { echo -e "${GREEN}[wiki-ai]${NC} $*"; }
warn()    { echo -e "${YELLOW}[wiki-ai]${NC} $*"; }
error()   { echo -e "${RED}[wiki-ai]${NC} $*"; }

IS_MAC=false
[[ "$(uname)" == "Darwin" ]] && IS_MAC=true

# ─── Ensure Homebrew (macOS only) ────────────────────────────────────────────
ensure_brew() {
  if ! command -v brew &>/dev/null; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [[ -f /usr/local/bin/brew   ]] && eval "$(/usr/local/bin/brew shellenv)"
  fi
}

# ─── 1. Node / npm ───────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  warn "npm not found — installing Node.js..."
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
    error "Cannot auto-install Node.js. Please install from https://nodejs.org"
    exit 1
  fi
fi
success "Node $(node -v)  /  npm $(npm -v)"

# ─── 2. Python ───────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
  warn "Python not found — installing..."
  if $IS_MAC; then
    ensure_brew && brew install python3
  elif command -v apt-get &>/dev/null; then
    sudo apt-get install -y python3 python3-venv python3-pip
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y python3 python3-pip
  elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm python python-pip
  else
    error "Cannot auto-install Python. Please install from https://python.org"
    exit 1
  fi
fi

# Prefer python3
if command -v python3 &>/dev/null; then PYTHON=python3
else PYTHON=python; fi
success "Python $($PYTHON --version)"

# Ensure python3-venv is available on Debian/Ubuntu (common omission)
if ! $PYTHON -m venv --help &>/dev/null 2>&1; then
  warn "python3-venv not found — installing..."
  sudo apt-get install -y python3-venv 2>/dev/null || true
fi

# ─── 3. Ollama ───────────────────────────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
  warn "Ollama not found — installing..."
  if $IS_MAC; then
    ensure_brew && brew install ollama
  else
    # Official Linux install script
    curl -fsSL https://ollama.com/install.sh | sh
  fi
fi
success "Ollama $(ollama --version 2>/dev/null | head -1)"

# ─── 4. npm install (wiki-explorer deps) ─────────────────────────────────────
cd "$PROJECT_DIR"
if [ ! -d node_modules ]; then
  info "Installing Node.js dependencies..."
  npm install --silent
fi

# ─── 5. Python venv + agent deps (must happen BEFORE starting ChromaDB) ──────
# All Python packages (including chromadb) go into the agents venv.
# This avoids PEP 668 "externally managed" errors on Homebrew Python.
cd "$AGENTS_DIR"

if [ ! -d ".venv" ]; then
  info "Creating Python virtual environment..."
  $PYTHON -m venv .venv
fi

info "Installing/updating Python dependencies..."
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
success "Python environment ready"

# Convenience aliases — all Python tools run from inside the venv
VENV_PYTHON="$AGENTS_DIR/.venv/bin/python"
VENV_UVICORN="$AGENTS_DIR/.venv/bin/uvicorn"
VENV_CHROMA="$AGENTS_DIR/.venv/bin/chroma"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  info "Created agents/.env from .env.example"
fi
cd "$PROJECT_DIR"

# ─── Stop previous AI processes on our ports ─────────────────────────────────
stop_ai_port() {
  local port=$1
  local pattern=$2
  local pids
  pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [[ -z "$pids" ]] && return 0

  for pid in $pids; do
    local cmd
    cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
    [[ -z "$cmd" ]] && continue

    if echo "$cmd" | grep -qiE "$pattern"; then
      warn "Stopping previous process on port $port (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      local waited=0
      while lsof -ti tcp:"$port" -sTCP:LISTEN &>/dev/null && (( waited < 3 )); do
        sleep 1; (( waited++ ))
      done
    fi
  done
}

stop_ai_port 8001 "chroma"
stop_ai_port 8000 "uvicorn|agents"
stop_ai_port 3001 "tsx|server.index"
stop_ai_port 5173 "vite"

# ─── Cleanup on exit ─────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  info "Shutting down..."
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  success "All services stopped."
}
trap cleanup EXIT INT TERM

# ─── 6. ChromaDB ─────────────────────────────────────────────────────────────
info "Starting ChromaDB on port 8001..."
# Use the chroma CLI from the venv (chromadb does not support python -m chromadb)
"$VENV_CHROMA" run --host 0.0.0.0 --port 8001 --path "$LOG_DIR/chromadb" >"$LOG_DIR/chroma.log" 2>&1 &
CHROMA_PID=$!
PIDS+=("$CHROMA_PID")
sleep 2

if kill -0 "$CHROMA_PID" 2>/dev/null; then
  success "ChromaDB running (PID $CHROMA_PID)"
else
  error "ChromaDB failed to start. Check $LOG_DIR/chroma.log"
  tail -20 "$LOG_DIR/chroma.log" || true
  exit 1
fi

# ─── 7. Ollama ───────────────────────────────────────────────────────────────
if pgrep -x ollama &>/dev/null || pgrep -f "ollama serve" &>/dev/null; then
  info "Ollama already running"
else
  info "Starting Ollama..."
  ollama serve >"$LOG_DIR/ollama.log" 2>&1 &
  OLLAMA_PID=$!
  PIDS+=("$OLLAMA_PID")
  sleep 3
  success "Ollama running (PID $OLLAMA_PID)"
fi

# Pull models if not already present
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3:8b}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"

for model in "$OLLAMA_MODEL" "$OLLAMA_EMBED_MODEL"; do
  if ! ollama list 2>/dev/null | grep -qF "$model"; then
    info "Pulling model: $model (first run — may take several minutes)..."
    ollama pull "$model"
    success "Model ready: $model"
  else
    info "Model already present: $model"
  fi
done

# ─── 8. Python agent service ─────────────────────────────────────────────────
info "Starting Python agent service on port 8000..."
"$VENV_UVICORN" main:app --host 0.0.0.0 --port 8000 --reload \
  --app-dir "$AGENTS_DIR" >"$LOG_DIR/agents.log" 2>&1 &
AGENT_PID=$!
PIDS+=("$AGENT_PID")
sleep 3

if kill -0 "$AGENT_PID" 2>/dev/null; then
  success "Agent service running (PID $AGENT_PID)"
else
  error "Agent service failed to start. Check $LOG_DIR/agents.log"
  tail -20 "$LOG_DIR/agents.log" || true
  exit 1
fi

# ─── 9. wiki-explorer ────────────────────────────────────────────────────────
info "Starting wiki-explorer..."
cd "$PROJECT_DIR"
npm run dev >"$LOG_DIR/wiki.log" 2>&1 &
PIDS+=($!)

# ─── Ready ───────────────────────────────────────────────────────────────────
echo ""
success "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
success "  wiki-explorer AI stack is running"
echo ""
echo -e "  ${CYAN}UI${NC}            →  http://localhost:5173"
echo -e "  ${CYAN}Express API${NC}   →  http://localhost:3001"
echo -e "  ${CYAN}Agent service${NC} →  http://localhost:8000/health"
echo -e "  ${CYAN}ChromaDB${NC}      →  http://localhost:8001"
echo -e "  ${CYAN}Ollama${NC}        →  http://localhost:11434"
echo ""
echo -e "  Logs: ${YELLOW}$LOG_DIR/${NC}"
success "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
info "Press Ctrl+C to stop all services"

# Keep running until Ctrl+C
wait
