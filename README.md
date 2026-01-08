# Better Gemini MCP

A stateless MCP (Model Context Protocol) server that proxies research queries to Gemini CLI, reducing agent context and model usage.

## Overview

Better Gemini MCP acts as a lightweight research proxy for developer agents (Claude Code, VS Code Copilot), leveraging the large context window of Gemini CLI to analyze local codebases and documents without consuming the calling agent's context window.

### Key Features

- **Stateless Design**: Every tool call is independent - no session files or persistent storage
- **Read-Only Safety**: Enforces read-only analysis via Gemini CLI restrictions
- **Structured Outputs**: Returns JSON-formatted responses that agents can easily parse
- **Progress Notifications**: Keeps clients responsive during long-running operations

## Prerequisites

1. **Node.js 18+**
   ```bash
   node --version  # Should be v18.0.0 or higher
   ```

2. **Gemini CLI** (must be installed and authenticated)
   ```bash
   npm install -g @google/gemini-cli
   gemini  # Follow prompts to authenticate
   ```

## Installation

### Using npx (recommended)
```bash
npx better-gemini-mcp
```

### Global Install
```bash
npm install -g better-gemini-mcp
better-gemini-mcp
```

### From Source
```bash
git clone https://github.com/YOUR_ORG/better-gemini-mcp.git
cd better-gemini-mcp
npm install
npm run build
npm start
```

## Setup

### Setup Wizard
Run the setup wizard to validate your environment:
```bash
npx better-gemini-mcp init
```

### MCP Client Configuration

#### Claude Desktop
Add to `~/.config/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "better-gemini-mcp": {
      "command": "npx",
      "args": ["better-gemini-mcp"]
    }
  }
}
```

#### VS Code (GitHub Copilot)
Add to your MCP settings:
```json
{
  "mcpServers": {
    "better-gemini-mcp": {
      "command": "npx",
      "args": ["better-gemini-mcp"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `quick_query` | Fast analysis using flash models |
| `deep_research` | In-depth analysis using pro models |
| `analyze_directory` | Directory structure summarization |
| `validate_paths` | Preflight path validation |
| `health_check` | Server and Gemini CLI diagnostics |
| `fetch_chunk` | Retrieve chunked response segments |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_ROOT` | Project root directory | `process.cwd()` |
| `ALLOWED_PATHS` | JSON array of allowed paths | `[PROJECT_ROOT]` |
| `RESPONSE_CHUNK_SIZE_KB` | Chunk size for large responses | `10` |
| `CACHE_TTL_MS` | Cache expiration time | `3600000` (1h) |
| `DEBUG` | Enable debug logging | `false` |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode (watch)
npm run dev

# Start the server
npm start
```

## Architecture

```
Agent (Claude/Copilot) → MCP Server → Gemini CLI → Project Files
                              ↓
                     JSON Response to Agent
```

The server:
1. Receives research queries from agents via MCP protocol
2. Validates paths and constructs Gemini CLI commands
3. Spawns Gemini CLI with read-only restrictions
4. Parses output and returns structured JSON

## Documentation

- [Product Requirements (PRD)](./docs/project-overview-PRD.md)
- [Copilot Instructions](./.github/copilot-instructions.md)

## License

MIT
