# Better Gemini MCP

[![npm version](https://badge.fury.io/js/better-gemini-mcp.svg)](https://www.npmjs.com/package/better-gemini-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/better-gemini-mcp.svg)](https://nodejs.org)

A **stateless MCP (Model Context Protocol) server** that acts as a lightweight research proxy for developer agents (Claude Code, VS Code Copilot), leveraging the large context window of **Gemini CLI** to analyze local codebases and documents without consuming the calling agent's context window.

## 🎯 Why Better Gemini MCP?

When using AI coding assistants like Claude Code or GitHub Copilot, you often need to:
- Analyze large files or multiple files at once
- Understand complex codebases across many modules
- Get deep insights without pasting everything into chat

**Better Gemini MCP** offloads this heavy lifting to Gemini CLI's large context window, so your primary agent stays focused and efficient.

### Key Benefits

- **Reduce agent context usage**: No need to paste large files into Claude/Copilot prompts
- **Reduce agent model costs**: Move deep analysis to Gemini, keeping calling agent tokens minimal
- **Structured outputs**: JSON responses that agents can easily parse and use
- **Safety by default**: Read-only analysis with path restriction enforcement

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔄 **Stateless** | Every tool call is independent—no session files or state to manage |
| 🔒 **Read-Only** | Gemini CLI restricted to read operations only |
| 📊 **Structured JSON** | All responses are parseable JSON with consistent format |
| 🎯 **Smart Chunking** | Large responses automatically split into retrievable chunks |
| ⚡ **Model Fallback** | 3-tier fallback: Gemini 3 → Gemini 2.5 → auto-select |
| 📁 **Ignore Patterns** | Respects `.gitignore` plus common exclusions |

## 📦 Prerequisites

### 1. Node.js 18+
```bash
node --version  # Should be v18.0.0 or higher
```

### 2. Gemini CLI
```bash
npm install -g @google/gemini-cli
gemini --version
```

### 3. Authentication
```bash
# Option 1: Login with Google (recommended)
gemini
# Select "Login with Google" and follow prompts

# Option 2: API Key
export GEMINI_API_KEY="your-api-key"
```

## 🚀 Installation

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

## ⚙️ Setup

### Setup Wizard
Run the setup wizard to validate your environment:
```bash
npx better-gemini-mcp init
```

This will check:
- ✅ Gemini CLI installation
- ✅ Authentication configuration  
- ✅ Test invocation

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
Add to your VS Code settings or `.vscode/mcp-settings.json`:
```json
{
  "mcp.servers": {
    "better-gemini-mcp": {
      "command": "npx",
      "args": ["better-gemini-mcp"]
    }
  }
}
```

## 🛠️ Available Tools

### `quick_query`
Fast analysis using Gemini flash models. Ideal for quick questions and focused analysis.

```json
{
  "prompt": "Explain the authentication flow in @src/auth.ts",
  "focus": "security",
  "responseStyle": "concise"
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | ✅ | Research question (use `@path` to reference files) |
| `focus` | enum | ❌ | `security`, `architecture`, `performance`, `general` |
| `responseStyle` | enum | ❌ | `concise`, `normal`, `detailed` |

---

### `deep_research`
In-depth analysis using Gemini pro models. For complex queries across many files.

```json
{
  "prompt": "Analyze the data flow from API to database across @src/",
  "focus": "architecture",
  "citationMode": "paths_only"
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | ✅ | Complex research question |
| `focus` | enum | ❌ | `security`, `architecture`, `performance`, `general` |
| `citationMode` | enum | ❌ | `none`, `paths_only` |

---

### `analyze_directory`
Summarize directory structure with file descriptions.

```json
{
  "path": "./src",
  "depth": 3,
  "maxFiles": 100
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ✅ | Relative path to directory |
| `depth` | number | ❌ | Max traversal depth (default: unlimited) |
| `maxFiles` | number | ❌ | Max files to enumerate (default: 500) |

---

### `validate_paths`
Preflight validation for file paths before analysis.

```json
{
  "paths": ["src/index.ts", "config/settings.json"]
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `paths` | string[] | ✅ | Array of paths to validate |

---

### `health_check`
Check server status and Gemini CLI configuration.

```json
{
  "includeDiagnostics": true
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `includeDiagnostics` | boolean | ❌ | Include detailed diagnostics |

---

### `fetch_chunk`
Retrieve chunked response segments for large outputs.

```json
{
  "cacheKey": "cache_abc123",
  "chunkIndex": 2
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cacheKey` | string | ✅ | Cache key from chunked response |
| `chunkIndex` | number | ✅ | 1-based chunk index |

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_ROOT` | Project root directory | `process.cwd()` |
| `RESPONSE_CHUNK_SIZE_KB` | Chunk size for large responses | `10` |
| `CACHE_TTL_MS` | Cache expiration time (ms) | `3600000` (1 hour) |
| `DEBUG` | Enable debug logging | `false` |
| `GEMINI_API_KEY` | Gemini API key (alternative to Google login) | - |

## 📐 Response Format

All tools return structured JSON responses:

### Success Response
```json
{
  "tool": "quick_query",
  "model": "gemini-3-flash-preview",
  "answer": "Analysis result...",
  "filesAccessed": ["src/auth.ts"],
  "stats": {
    "tokensUsed": 1234,
    "latencyMs": 5053
  },
  "meta": {
    "projectRoot": "/path/to/project",
    "truncated": false,
    "warnings": []
  }
}
```

### Chunked Response
When output exceeds 10KB:
```json
{
  "tool": "deep_research",
  "answer": "First chunk...",
  "chunks": {
    "cacheKey": "cache_abc123",
    "current": 1,
    "total": 3
  }
}
```
Use `fetch_chunk` with the `cacheKey` to retrieve remaining chunks.

### Error Response
```json
{
  "error": {
    "code": "PATH_NOT_ALLOWED",
    "message": "Path is outside project root",
    "details": {}
  }
}
```

## ❌ Error Codes

| Code | Description | Resolution |
|------|-------------|------------|
| `INVALID_ARGUMENT` | Invalid tool parameters | Check parameter types |
| `PATH_NOT_ALLOWED` | Path outside project root | Use paths within project |
| `GEMINI_CLI_NOT_FOUND` | Gemini CLI not installed | Run `npm install -g @google/gemini-cli` |
| `GEMINI_CLI_ERROR` | CLI execution failed | Check Gemini CLI logs |
| `AUTH_MISSING` | Not authenticated | Run `gemini` to login |
| `QUOTA_EXCEEDED` | API quota exhausted | Wait for reset or upgrade |
| `CACHE_EXPIRED` | Chunk cache expired | Re-run original query |
| `INVALID_CHUNK_INDEX` | Chunk index out of range | Check total chunks |

## 🛡️ Security

- **Read-only by default**: Gemini CLI invoked without `--yolo` flag
- **Project root restriction**: All paths validated against project root
- **Directory traversal prevention**: `../` patterns blocked
- **Ignore patterns**: `node_modules`, `.git`, `dist`, etc. excluded
- **No credential logging**: API keys never written to logs

## 🐛 Troubleshooting

### Common Issues

#### "Gemini CLI not found"
```bash
npm install -g @google/gemini-cli
# Verify installation
which gemini
```

#### "Authentication not configured"
```bash
# Recommended: Login with Google
gemini
# Select "Login with Google"

# Alternative: Set API key
export GEMINI_API_KEY="your-key"
```

#### ".gitignore blocking files"
Gemini CLI respects `.gitignore` by default. To analyze git-ignored files:
```bash
gemini
# Type: /settings
# Set: fileFiltering.respectGitIgnore = false
```

#### "Path not allowed"
Ensure all `@path` references are relative to project root:
```
✅ @src/auth.ts
✅ @./config.json
❌ @../other-project/file.ts
❌ @/etc/passwd
```

### Debug Mode
Enable verbose logging:
```bash
DEBUG=true npx better-gemini-mcp
```

## 🏗️ Architecture

```
Agent (Claude/Copilot)
         │
         ▼
   ┌─────────────┐
   │  MCP Server │  ← Stateless, stdio transport
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │ Gemini CLI  │  ← Read-only mode (-y, no --yolo)
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │Project Files│  ← @path references
   └─────────────┘
```

The server:
1. Receives research queries via MCP protocol
2. Validates paths and constructs Gemini CLI commands
3. Prepends system prompt for token efficiency
4. Spawns Gemini CLI with read-only restrictions
5. Parses output and returns structured JSON

## 📚 Documentation

- [Product Requirements (PRD)](./docs/project-overview-PRD.md)
- [Changelog](./CHANGELOG.md)
- [Manual Testing Guide](./tests/MANUAL_TESTS.md)
- [Copilot Instructions](./.github/copilot-instructions.md)

## 🧪 Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development (watch mode)
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

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Guidelines

- Use TypeScript with strict mode
- All imports must use `.js` extension (ES Modules)
- Add tests for new features
- Update documentation as needed
- Follow existing code style

## 📄 License

[MIT](./LICENSE)

---

<p align="center">
  Made with ❤️ for the AI coding agent community
</p>
