#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start.sh  —  Install deps and launch Wiki Explorer (macOS / Linux)
# Usage:  bash scripts/start.sh   OR   ./scripts/start.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Navigate to project root (script is in scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"
UI_URL="http://localhost:5173"

# ── Colour helpers ────────────────────────────────────────────────────────────
green()  { echo -e "\033[0;32m$*\033[0m"; }
yellow() { echo -e "\033[0;33m$*\033[0m"; }
red()    { echo -e "\033[0;31m$*\033[0m"; }

# ── 1. Ensure Node / npm is available ────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  yellow "npm not found — installing Node.js..."

  if [[ "$(uname)" == "Darwin" ]]; then
    if ! command -v brew &>/dev/null; then
      yellow "Homebrew not found — installing Homebrew..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    brew install node
  else
    if command -v curl &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v wget &>/dev/null; then
      wget -qO- https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs
    else
      red "Cannot install Node.js automatically. Please install from https://nodejs.org and re-run."
      exit 1
    fi
  fi
fi

green "Node $(node -v)  /  npm $(npm -v)"

# ── 2. Stop any previous wiki-explorer processes on our ports ─────────────────
# Only kills a process if its command line looks like our app (tsx / vite /
# server/index). Leaves unrelated processes alone.
stop_if_ours() {
  local port=$1
  local pids
  pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [[ -z "$pids" ]] && return 0

  for pid in $pids; do
    local cmd
    cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
    [[ -z "$cmd" ]] && continue

    if echo "$cmd" | grep -qE 'tsx|vite|wiki.?explorer|server/index'; then
      yellow "Stopping previous wiki-explorer on port $port (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      # Wait up to 3 s for the port to free
      local waited=0
      while lsof -ti tcp:"$port" -sTCP:LISTEN &>/dev/null && (( waited < 3 )); do
        sleep 1; (( waited++ ))
      done
    else
      yellow "Port $port is already in use by another process — leaving it alone:"
      yellow "  $cmd"
    fi
  done
}

stop_if_ours 3001
stop_if_ours 5173

# ── 3. Install dependencies ───────────────────────────────────────────────────
cd "$SCRIPT_DIR"
green "\nInstalling dependencies..."
npm install

# ── 4. Start dev server in the background ────────────────────────────────────
green "\nStarting Wiki Explorer..."
npm run dev &
DEV_PID=$!

# Trap Ctrl-C so child processes are killed cleanly
trap 'echo; yellow "Stopping..."; kill $DEV_PID 2>/dev/null; exit 0' INT TERM

# ── 5. Wait for Vite (port 5173) to be ready ─────────────────────────────────
yellow "Waiting for dev server to start..."
MAX_WAIT=30
for i in $(seq 1 $MAX_WAIT); do
  if curl -s --max-time 1 "$UI_URL" &>/dev/null; then
    break
  fi
  if ! kill -0 $DEV_PID 2>/dev/null; then
    red "Dev server exited unexpectedly."
    exit 1
  fi
  sleep 1
done

if ! curl -s --max-time 1 "$UI_URL" &>/dev/null; then
  yellow "Server is taking longer than expected — opening browser anyway..."
fi

# ── 6. Open browser ───────────────────────────────────────────────────────────
green "\nOpening $UI_URL"
if [[ "$(uname)" == "Darwin" ]]; then
  open "$UI_URL"
else
  xdg-open "$UI_URL" 2>/dev/null || sensible-browser "$UI_URL" 2>/dev/null || \
    yellow "Could not open browser automatically. Visit $UI_URL"
fi

green "Wiki Explorer is running. Press Ctrl+C to stop.\n"

wait $DEV_PID
