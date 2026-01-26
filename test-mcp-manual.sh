#!/bin/bash
# Manual MCP server test script
# This runs the server in stdio mode for debugging

export DEBUG=1
export PROJECT_ROOT=/home/arjun/gemini-researcher

echo "Starting Gemini Researcher server in debug mode..."
echo "The server expects MCP protocol JSON-RPC messages on stdin"
echo "Press Ctrl+D to send EOF, or Ctrl+C to exit"
echo ""

node dist/index.js
