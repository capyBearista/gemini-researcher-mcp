#!/bin/bash
# Manual MCP server test script
# This runs the server in stdio mode for debugging

export DEBUG=1

# Resolve repo root from this script location so the script works on any machine.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Allow callers to override PROJECT_ROOT if desired.
export PROJECT_ROOT="${PROJECT_ROOT:-$REPO_ROOT}"

echo "Starting Gemini Researcher server in debug mode..."
echo "The server expects MCP protocol JSON-RPC messages on stdin"
echo "Press Ctrl+D to send EOF, or Ctrl+C to exit"
echo ""

node dist/index.js
