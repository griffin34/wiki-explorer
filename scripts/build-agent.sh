#!/bin/bash
#
# Build script for packaging the Python agent as a standalone executable.
# Uses PyInstaller to create a single executable that includes all dependencies.
#
# Usage:
#   ./scripts/build-agent.sh
#
# Output:
#   dist-agent/wiki-agent (executable)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
AGENTS_DIR="$PROJECT_ROOT/agents"
OUTPUT_DIR="$PROJECT_ROOT/dist-agent"

echo "=== Building wiki-explorer agent ==="
echo "Project root: $PROJECT_ROOT"
echo "Agents dir: $AGENTS_DIR"
echo "Output dir: $OUTPUT_DIR"

# Ensure we're in the agents directory
cd "$AGENTS_DIR"

# Check if venv exists, create if not
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv .venv
fi

# Activate venv
source .venv/bin/activate

# Install dependencies + PyInstaller
echo "Installing dependencies..."
pip install -q -r requirements.txt
pip install -q pyinstaller

# Clean previous builds
rm -rf "$OUTPUT_DIR"
rm -rf build dist *.spec

# Create PyInstaller spec for better control
echo "Building agent with PyInstaller..."
pyinstaller \
    --name wiki-agent \
    --onedir \
    --console \
    --noconfirm \
    --clean \
    --add-data "config.py:." \
    --add-data "agents:agents" \
    --add-data "models:models" \
    --add-data "services:services" \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.protocols.http \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.protocols.websockets \
    --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import uvicorn.lifespan \
    --hidden-import uvicorn.lifespan.on \
    --hidden-import uvicorn.lifespan.off \
    --hidden-import httptools \
    --hidden-import uvloop \
    --hidden-import watchfiles \
    --hidden-import chromadb \
    --hidden-import chromadb.config \
    --hidden-import chromadb.api \
    --hidden-import chromadb.api.client \
    --hidden-import onnxruntime \
    --hidden-import tokenizers \
    --hidden-import markitdown \
    --collect-all chromadb \
    --collect-all markitdown \
    --collect-all onnxruntime \
    main.py

# Move output to dist-agent
mv dist/wiki-agent "$OUTPUT_DIR"

# Clean up build artifacts
rm -rf build dist *.spec

echo ""
echo "=== Build complete ==="
echo "Agent executable: $OUTPUT_DIR/wiki-agent"
echo ""
echo "To test: $OUTPUT_DIR/wiki-agent/wiki-agent"

deactivate
