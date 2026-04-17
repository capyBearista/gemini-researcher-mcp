# Gemini Researcher

[![NPM Version](https://img.shields.io/npm/v/gemini-researcher?logo=npm)](https://www.npmjs.com/package/gemini-researcher)
[![NPM Downloads](https://img.shields.io/npm/d18m/gemini-researcher?logo=npm)](https://www.npmjs.com/package/gemini-researcher)
[![License: BSD-3 Claude](https://img.shields.io/badge/License-BSD%203--Clause-white.svg)](https://opensource.org/licenses/BSD-3-Clause)

<a href="https://glama.ai/mcp/servers/@capyBearista/gemini-researcher">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@capyBearista/gemini-researcher/badge" />
</a>

A lightweight, stateless MCP (Model Context Protocol) server that lets developer agents (Claude Code, GitHub Copilot) hand off deep repository analysis to the Gemini CLI. The server is read-only, returns structured JSON (as text content), and is designed to reduce the calling agent's context and model usage.

Status: v1 complete. Core features are stable, but still early days. Feedback welcome!

**If this saved you tokens,** ⭐ please consider giving it a star! :)

The primary goals:
- Reduce agent context usage by letting Gemini CLI read large codebases locally and do its own research
- Reduce calling-agent model usage by offloading heavy analysis to Gemini
- Keep the server stateless and read-only for safety

**Why use this?**

Instead of copying entire files into your agent's context (burning tokens and cluttering the conversation), this server lets Gemini CLI read files directly from your project. Your agent sends a research query, Gemini reads and synthesizes using its large context window, and returns structured results. You save tokens, your agent stays focused, and complex codebase analysis becomes practical.

**Verified clients:** Claude Code, Cursor, VS Code (GitHub Copilot)
> [!NOTE] 
> It definitely works with other clients, but I haven't personally tested them yet. Please open an issue if you try it elsewhere!

**Table of contents**

- [Gemini Researcher](#gemini-researcher)
  - [Overview](#overview)
  - [Prerequisites](#prerequisites)
  - [Quickstart](#quickstart)
    - [Step 1: Validate environment](#step-1-validate-environment)
    - [Step 2: Configure your MCP client](#step-2-configure-your-mcp-client)
    - [Step 3: Restart your MCP client](#step-3-restart-your-mcp-client)
    - [Step 4: Test it](#step-4-test-it)
  - [Tools](#tools)
    - [Example workflows](#example-workflows)
  - [Docker](#docker)
  - [Troubleshooting (common issues)](#troubleshooting-common-issues)
  - [Contributing](#contributing)
  - [License](#license)

## Overview

Gemini Researcher accepts queries from your AI agent and uses Gemini CLI to analyze your local code files. Results are returned as formatted JSON for your agent to use.

### Runtime safety

The server runs Gemini CLI with safety restrictions enabled. See `docs/runtime-contract.md` for full technical details.

Default invocation pattern:
```bash
gemini [ -m <model> ] --output-format json --approval-mode default [--admin-policy <path>] -p "<prompt>"
```

**Key safety points:**
- Uses `--approval-mode default` (not yolo mode) for controlled execution
- Enforces read-only policy by default to prevent file changes
- Policy blocks mutating tools like `write_file`, `replace`, `run_shell_command`
- Strict enforcement can be disabled with `GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY=0` (not recommended)

### Auth and health check

Run `health_check` with `includeDiagnostics: true` to see auth status and server health.

| authStatus | What it means | Impact |
|---|---|---|
| `configured` | Gemini CLI is authenticated | Server ready to use |
| `unauthenticated` | No valid authentication found | Server marked as degraded |
| `unknown` | Could not verify auth status | Server marked as degraded |

**health_check.status values:**
- `ok`: Gemini CLI is available, auth is working, and safety policy is enforced
- `degraded`: Setup incomplete, auth unclear, or safety policy disabled

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

### Step 1: Validate environment
Run the setup wizard to verify Gemini CLI is installed and authenticated:
```bash
npx gemini-researcher init
```

### Step 2: Configure your MCP client

**Standard config** works in most of the tools:
```json
{
  "mcpServers": {
    "gemini-researcher": {
      "command": "npx",
      "args": [
        "gemini-researcher"
      ]
    }
  }
}
```

> [!NOTE]
> On native Windows, some MCP hosts use shell-less process spawning and may not resolve npm command shims reliably (`npx`, `gemini`).
> If startup fails with launch errors (`spawn ... ENOENT` / `GEMINI_CLI_LAUNCH_FAILED` despite working in PowerShell), prefer Docker or WSL for immediate reliability.

<details>
<summary>VS Code</summary>

Add to your VS Code MCP settings (create `.vscode/mcp.json` if needed):
```json
{
  "servers": {
    "gemini-researcher": {
      "command": "npx",
      "args": [
        "gemini-researcher"
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
claude mcp add --transport stdio gemini-researcher -- npx gemini-researcher 

# Verify it was added
claude mcp list
```

Project scope

Navigate to your project directory, then run:
```bash
# Add the MCP server via CLI
claude mcp add --scope project --transport stdio gemini-researcher -- npx gemini-researcher

# Verify it was added
claude mcp list
```

**Option 2: Manual configuration**

Add to `.mcp.json` in your project root (project scope):
```json
{
  "mcpServers": {
    "gemini-researcher": {
      "command": "npx",
      "args": [
        "gemini-researcher"
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
    "gemini-researcher": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "gemini-researcher"
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
    "gemini-researcher": {
      "command": "npx",
      "args": [
        "gemini-researcher"
      ],
      "env": {
        "PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

### Step 3: Restart your MCP client

### Step 4: Test it
Ask your agent: "Use gemini-researcher to analyze the project."

## Tools

All tools return structured JSON (as MCP text content). Large responses are chunked (~10KB per chunk) and cached for 1 hour.

| Tool | Purpose | When to use |
|------|---------|-------------|
| `quick_query` | Fast analysis with flash model | Quick questions about specific files or small code sections |
| `deep_research` | In-depth analysis with pro model | Complex multi-file analysis, architecture reviews, security audits |
| `analyze_directory` | Map directory structure | Understanding unfamiliar codebases, generating project overviews |
| `validate_paths` | Pre-check file paths | Verify files exist before running expensive queries |
| `health_check` | Diagnostics | Troubleshooting server/Gemini CLI issues |
| `fetch_chunk` | Get chunked responses | Retrieve remaining parts of large responses |

### Example workflows

**Understanding a security vulnerability:**
```
Agent: Use deep_research to analyze authentication flow across @src/auth and @src/middleware, focusing on security
```

**Quick code explanation:**
```
Agent: Use quick_query to explain the login flow in @src/auth.ts, be concise
```

**Mapping an unfamiliar codebase:**
```
Agent: Use analyze_directory on src/ with depth 3 to understand the project structure
```

<details>
<summary>Full tool schemas (for reference)</summary>

**quick_query**
```json
{
  "prompt": "Explain @src/auth.ts login flow",
  "focus": "security",
  "responseStyle": "concise"
}
```

**deep_research**
```json
{
  "prompt": "Analyze authentication across @src/auth and @src/middleware",
  "focus": "architecture",
  "citationMode": "paths_only"
}
```

**analyze_directory**
```json
{
  "path": "src",
  "depth": 3,
  "maxFiles": 200
}
```

**validate_paths**
```json
{
  "paths": ["src/auth.ts", "README.md"]
}
```

**health_check**
```json
{
  "includeDiagnostics": true
}
```

**fetch_chunk**
```json
{
  "cacheKey": "cache_abc123",
  "chunkIndex": 2
}
```

</details>

## Docker

A pre-built multi-platform Docker image is available on [Docker Hub](https://hub.docker.com/r/capybearista/gemini-researcher):

```bash
# Pull the image (works on Intel/AMD and Apple Silicon)
docker pull capybearista/gemini-researcher:latest

# Run the server (mount your project and provide API key)
docker run -i --rm \
  -e GEMINI_API_KEY="your-api-key" \
  -v /path/to/your/project:/workspace \
  capybearista/gemini-researcher:latest
```

For MCP client configuration with Docker:
```json
{
  "mcpServers": {
    "gemini-researcher": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GEMINI_API_KEY",
        "-v", "/path/to/your/project:/workspace",
        "capybearista/gemini-researcher:latest"
      ],
      "env": {
        "GEMINI_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

> [!NOTE]
> - The `-i` flag is required for stdio transport
> - The container mounts your project to `/workspace` (the project root)
> - Replace `/path/to/your/project` with your actual project path
> - Replace `your-api-key` with your actual Gemini API key (this is required for Docker usage)

## Troubleshooting (common issues)
- `GEMINI_CLI_NOT_FOUND`: Install Gemini CLI: `npm install -g @google/gemini-cli`
- `GEMINI_CLI_LAUNCH_FAILED`: This is a launch-path issue, not an auth/capability issue. On Windows, command shims can fail in shell-less spawn contexts. Validate `gemini --help` and `npx --version` interactively, then prefer Docker or WSL if host launch mode is strict.
- `AUTH_MISSING`: Run `gemini`, and authenticate or set `GEMINI_API_KEY`
- `AUTH_UNKNOWN`: Auth could not be confirmed (often network/CLI probe failure). If launch errors are present, fix launch-path first; otherwise verify `gemini` works interactively, then retry.
- `ADMIN_POLICY_MISSING`: Reinstall package or verify `policies/read-only-enforcement.toml` exists in installed package.
- `ADMIN_POLICY_UNSUPPORTED`: Upgrade Gemini CLI to v0.36.0+ (`gemini --help` should include `--admin-policy`).
- Capability errors (`ADMIN_POLICY_UNSUPPORTED`, output format unsupported) should be interpreted only after a successful `gemini --help` probe. If probe launch fails, treat it as launch-path failure first.
- `GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY=0`: Disables strict startup policy checks. This reduces safety guarantees.
- `.gitignore` blocking files: Gemini respects `.gitignore` by default; toggle `fileFiltering.respectGitIgnore` in `gemini /settings` if you intentionally want ignored files included (note: this changes Gemini behavior globally)
- `PATH_NOT_ALLOWED`: All `@path` references must resolve inside the configured project root (`process.cwd()` by default). Use `validate_paths` to pre-check paths.
- `QUOTA_EXCEEDED`: Server retries with fallback models; if all tiers are exhausted, reduce scope (use `quick_query`) or wait for quota reset.

## Contributing

Read the [Contributing Guide](./CONTRIBUTING.md) to get started.

Quick links:
- [Development setup](./CONTRIBUTING.md#development-setup)
- [Running tests](./CONTRIBUTING.md#running-tests)
- [Code guidelines](./CONTRIBUTING.md#code-guidelines)
- [Submitting changes](./CONTRIBUTING.md#submitting-changes)

## License

[BSD-3-Clause License](./LICENSE.md)

---

<p align="center">
  Made with ♡ for the AI-assisted dev community
</p>
