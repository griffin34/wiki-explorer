#!/usr/bin/env bash
#
# Run AI agent evaluations for wiki-explorer
#
# Usage:
#   ./run_evals.sh              # Run all evals with mocked Ollama
#   ./run_evals.sh --live       # Run with real Ollama
#   ./run_evals.sh --suite search    # Run only search evals
#   ./run_evals.sh --output results.json  # Save results to JSON
#

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$AGENTS_DIR")"

# Default values
LIVE_MODE=""
OUTPUT_FILE=""
SUITE=""
VERBOSE=""
EXTRA_ARGS=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --live)
            LIVE_MODE="--live"
            shift
            ;;
        --output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --suite)
            SUITE="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE="-v"
            shift
            ;;
        -vv)
            VERBOSE="-vv"
            shift
            ;;
        *)
            EXTRA_ARGS="$EXTRA_ARGS $1"
            shift
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     wiki-explorer AI Agent Evaluations     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo

# Check Python environment
if [ ! -d "$AGENTS_DIR/.venv" ]; then
    echo -e "${YELLOW}Creating Python virtual environment...${NC}"
    python3 -m venv "$AGENTS_DIR/.venv"
fi

# Activate virtual environment
source "$AGENTS_DIR/.venv/bin/activate"

# Install dependencies if needed
if ! python -c "import pytest" 2>/dev/null; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    pip install -q -r "$AGENTS_DIR/requirements.txt"
    pip install -q pytest pytest-asyncio pytest-json-report pyyaml
fi

# Set environment variables
export PYTHONPATH="$AGENTS_DIR:$SCRIPT_DIR"
export EVAL_LIVE="${LIVE_MODE:+1}"

# Get git commit for tracking
export GIT_COMMIT=$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Build pytest command
PYTEST_CMD="python -m pytest"
PYTEST_ARGS="-m eval $VERBOSE"

# Add suite filter if specified
if [ -n "$SUITE" ]; then
    case $SUITE in
        search)
            PYTEST_ARGS="$PYTEST_ARGS $SCRIPT_DIR/eval_search.py"
            ;;
        wiki)
            PYTEST_ARGS="$PYTEST_ARGS $SCRIPT_DIR/eval_wiki_generation.py"
            ;;
        edit)
            PYTEST_ARGS="$PYTEST_ARGS $SCRIPT_DIR/eval_edit.py"
            ;;
        *)
            echo -e "${RED}Unknown suite: $SUITE${NC}"
            echo "Available suites: search, wiki, edit"
            exit 1
            ;;
    esac
else
    PYTEST_ARGS="$PYTEST_ARGS $SCRIPT_DIR"
fi

# Add live mode flag
if [ -n "$LIVE_MODE" ]; then
    PYTEST_ARGS="$PYTEST_ARGS --live"
    echo -e "${YELLOW}Running in LIVE mode (requires Ollama)${NC}"
    
    # Check if Ollama is running
    if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo -e "${RED}Error: Ollama is not running${NC}"
        echo "Start Ollama with: ollama serve"
        exit 1
    fi
else
    echo -e "${GREEN}Running in MOCKED mode (fast, deterministic)${NC}"
fi

# Add output file if specified
if [ -n "$OUTPUT_FILE" ]; then
    PYTEST_ARGS="$PYTEST_ARGS --output $OUTPUT_FILE"
    echo -e "${BLUE}Results will be saved to: $OUTPUT_FILE${NC}"
fi

# Add any extra args
PYTEST_ARGS="$PYTEST_ARGS $EXTRA_ARGS"

echo
echo -e "${BLUE}Running: $PYTEST_CMD $PYTEST_ARGS${NC}"
echo -e "${BLUE}─────────────────────────────────────────────${NC}"
echo

# Run pytest
$PYTEST_CMD $PYTEST_ARGS

# Capture exit code
EXIT_CODE=$?

echo
echo -e "${BLUE}─────────────────────────────────────────────${NC}"

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ All evaluations passed!${NC}"
else
    echo -e "${RED}✗ Some evaluations failed (exit code: $EXIT_CODE)${NC}"
fi

# Print summary if output file was created
if [ -n "$OUTPUT_FILE" ] && [ -f "$OUTPUT_FILE" ]; then
    echo
    echo -e "${BLUE}Results Summary:${NC}"
    python3 -c "
import json
import sys
try:
    with open('$OUTPUT_FILE') as f:
        data = json.load(f)
    summary = data.get('summary', {})
    print(f\"  Total tests: {summary.get('total_tests', 'N/A')}\")
    print(f\"  Passed: {summary.get('passed', 'N/A')}\")
    print(f\"  Failed: {summary.get('failed', 'N/A')}\")
    print(f\"  Duration: {summary.get('duration_seconds', 'N/A')}s\")
except Exception as e:
    print(f'  Could not parse results: {e}')
"
fi

exit $EXIT_CODE
