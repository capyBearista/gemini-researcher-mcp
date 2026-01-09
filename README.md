# Better Gemini MCP

A lightweight, stateless MCP (Model Context Protocol) server that lets developer agents (Claude Code, GitHub Copilot) delegate deep repository analysis to the Gemini CLI. The server is read-only, returns structured JSON, and is optimized to reduce the calling agent's context and model usage.

**Status:** v1 complete. Core features are stable, but still early days. Feedback welcome!

**Primary goals:**
- Reduce agent context usage by letting Gemini CLI read large codebases locally and do its own research
- Reduce calling-agent model usage by offloading heavy analysis to Gemini
- Keep the server stateless and read-only for safety

**Quick links:**
- Product requirements doc: [docs/project-overview-PRD.md](docs/project-overview-PRD.md)

**Verified clients:** Claude Code, VS Code (GitHub Copilot), Cursor

**Important constraints:** stateless, read-only (no code patches), server-owned model selection, project-root path restriction.

**Table of contents**
- [Better Gemini MCP](#better-gemini-mcp)
  - [Overview](#overview)
  - [Prerequisites](#prerequisites)
  - [Quickstart](#quickstart)
  - [Tools (overview \& examples)](#tools-overview--examples)
  - [Troubleshooting (common issues)](#troubleshooting-common-issues)
  - [Developer notes](#developer-notes)
    - [Running tests \& development](#running-tests--development)
  - [Contributing](#contributing)
    - [Guidelines](#guidelines)
  - [License](#license)

## Overview

Better Gemini MCP accepts research-style queries over the MCP protocol and spawns the Gemini CLI in headless, read-only mode to perform large-context analysis on local files referenced with `@path`. Results are returned as pretty-printed JSON strings suitable for programmatic consumption by agent clients.

## Prerequisites
- Node.js 18+ installed
- Gemini CLI installed: `npm install -g @google/gemini-cli`
- Gemini CLI authenticated (recommended: `gemini` → Login with Google) or set `GEMINI_API_KEY`

Quick checks:
```bash
node --version
gemini --version
```

## Quickstart
1. Validate environment (recommended):
```bash
npx better-gemini-mcp init
```
This runs the setup wizard to check `gemini` is available, authentication is configured, and that a minimal headless invocation succeeds.

2. Start the MCP server (stdio transport):
Or install globally:
```bash
npm install -g better-gemini-mcp
better-gemini-mcp
```

3. Configure your MCP client (VS Code, Claude Code, etc.)

**Standard config** works in most of the tools:
```json
{
  "mcpServers": {
    "better-gemini": {
      "command": "npx",
      "args": [
        "better-gemini-mcp"
      ]
    }
  }
}
```

<details>
<summary>VS Code</summary>

Add to your VS Code MCP settings (create `.vscode/mcp.json` if needed):
```json
{
  "servers": {
    "better-gemini-mcp": {
      "command": "npx",
      "args": [
        "better-gemini-mcp"
      ]
    }
  }
}
```

</details>

<details>
<summary>Claude Code</summary>

**Option 1: Command line (recommended)**

Local (user-wide) scope
```bash
# Add the MCP server via CLI
claude mcp add --transport stdio better-gemini-mcp -- npx better-gemini-mcp 

# Verify it was added
claude mcp list
```

Project scope

Navigate to your project directory, then run:
```bash
# Add the MCP server via CLI
claude mcp add --scope project --transport stdio better-gemini-mcp -- npx better-gemini-mcp

# Verify it was added
claude mcp list
```

**Option 2: Manual configuration**

Add to `.mcp.json` in your project root (project scope):
```json
{
  "mcpServers": {
    "better-gemini-mcp": {
      "command": "npx",
      "args": [
        "better-gemini-mcp"
      ]
    }
  }
}
```

Or add to `~/.claude/settings.json` for local scope.

After adding the server, restart Claude Code and use `/mcp` to verify the connection.

</details>

<details>
<summary>Cursor</summary>

Go to `Cursor Settings` -> `Tools & MCP` -> `Add a Custom MCP Server`. Add the following configuration:
```json
{
  "mcpServers": {
    "better-gemini-mcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "better-gemini-mcp"
      ]
    }
  }
}
```

</details>

> [!NOTE]
> The server automatically uses the directory where the IDE opened your workspace as the project root or where your terminal is. To analyze a different directory, optionally set `PROJECT_ROOT`:

Example
```json
{
  "mcpServers": {
    "better-gemini-mcp": {
      "command": "npx",
      "args": [
        "better-gemini-mcp"
      ],
      "env": {
        "PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

4. Restart your MCP client
5. Test with your agent: Try asking "Use better-gemini-mcp to analyze the project."

## Tools (overview & examples)
- **quick_query** — Fast, focused analysis (flash model). Example:
```json
{
  "prompt": "Explain @src/auth.ts login flow",
  "focus": "security",
  "responseStyle": "concise"
}
```
- **deep_research** — Heavy-duty analysis across many files (pro model). Example:
```json
{
  "prompt": "Analyze authentication across @src/auth and @src/middleware",
  "focus": "architecture",
  "citationMode": "paths_only" }
```
- **analyze_directory** — Map a directory and summarize files. Example:
```json
{
  "path": "src",
  "depth": 3,
  "maxFiles": 200
}
```
- **validate_paths** — Preflight `@path` checks. Example:
```json
{
  "paths": ["src/auth.ts", "README.md"]
}
```
- **health_check** — Server + Gemini diagnostics. Example:
```json
{
  "includeDiagnostics": true
}
```
- **fetch_chunk** — Retrieve chunked responses. Example:
```json
{
  "cacheKey": "cache_abc123", "chunkIndex": 2
}
```

Each tool returns a pretty-printed JSON string in the MCP `text` content. When large outputs are produced, responses are chunked (default ~10KB chunks), cached for 1 hour, and the initial response contains `chunks` metadata with a `cacheKey`.

## Troubleshooting (common issues)
- `GEMINI_CLI_NOT_FOUND`: Install Gemini CLI: `npm install -g @google/gemini-cli`
- `AUTH_MISSING`: Run `gemini`, and authenticate or set `GEMINI_API_KEY`
- `.gitignore` blocking files: Gemini respects `.gitignore` by default; toggle `fileFiltering.respectGitIgnore` in `gemini /settings` if you intentionally want ignored files included (note: this changes Gemini behavior globally)
- `PATH_NOT_ALLOWED`: All `@path` references must resolve inside the configured project root (`process.cwd()` by default). Use `validate_paths` to pre-check paths.
- `QUOTA_EXCEEDED`: Server retries with fallback models; if all tiers are exhausted, reduce scope (use `quick_query`) or wait for quota reset.

## Developer notes
- The authoritative system prompt and constants live in `src/constants.ts`.
- The Gemini CLI integration and model fallback logic live in `src/utils/geminiExecutor.ts`.
- Tools are registered under `src/tools/*.tool.ts` and follow the UnifiedTool pattern in `src/tools/registry.ts`.
- Key design rules: stateless operation, read-only enforcement, server-managed model tiers, project-root path restriction.

### Running tests & development

```bash
npm run dev

# Run tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Lint
npm run lint
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git switch -c feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Guidelines

- **TypeScript strict mode**: All code uses TypeScript with strict type checking
- **ES Modules**: All imports must use `.js` extension (not `.ts`) for Node16 module resolution
- **Code style**: Follow existing patterns in `src/tools/*.tool.ts` (use UnifiedTool pattern)
- **Stateless design**: No session files, persistent storage, or server-managed state
- **Read-only enforcement**: Never modify files; all Gemini CLI calls must be read-only
- **Testing**: Add unit/integration tests in `tests/` directory

## License

[BSD-3-Clause License](./LICENSE.md)

---

<p align="center">
  Made with ♡ for the AI-assisted dev community
</p>