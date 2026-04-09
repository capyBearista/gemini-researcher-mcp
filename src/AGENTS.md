# Src - Core Server Logic

**Technology**: Node.js 18+, TypeScript, Zod, @modelcontextprotocol/sdk
**Entry Point**: `src/index.ts`
**Parent Context**: This extends [../AGENTS.md](../AGENTS.md)

## Development Commands

### From Root
```bash
npm run dev          # Watch mode
npm run build        # Build to dist/
npm run lint         # Type checking
```

## Architecture

### Directory Structure
```
src/
├── tools/        # MCP tool definitions and handlers
├── utils/        # Shared utilities (caching, chunking)
├── setup/        # CLI wizard for setup
├── types.ts      # Shared TypeScript types
├── constants.ts  # Global constants
└── index.ts      # Server entry point
```

### Code Organization Patterns

#### MCP Server
- ✅ **DO**: Use `@modelcontextprotocol/sdk` to define the server
  - Example: `src/index.ts`
  - Pattern: Register tools iteratively from `src/tools/registry.ts`

#### Error Handling & Diagnostics
- ✅ Throw clear Error objects or `McpError` (from SDK) if applicable
- ✅ Handle JSON parsing safely in `src/utils/`
- ✅ **DO**: Treat auth as tri-state (`configured`, `unauthenticated`, `unknown`) and fail-closed for ambiguity.

## Key Files

### Core Files (understand these first)
- `src/index.ts` - Main server initialization and capability registration
- `src/tools/registry.ts` - Registry array of all available MCP tools
- `src/utils/geminiExecutor.ts` - Core logic for spawning the Gemini CLI (read-only enforced)

## Quick Search Commands

### Find Tools
```bash
rg -n "export const" src/tools
```

## Common Gotchas

- **JSON Output**: The Gemini CLI output might contain markdown blocks (` ```json ... ``` `). Always sanitize before parsing.
- **Node Environment**: Use ES Modules (`import`/`export`), not CommonJS (`require`).
- **Headless CLI Arguments**: Ensure `-p "<prompt>"` is used for non-interactive execution and NEVER use `-y/--yolo` in generated argv.
- **Redaction**: Ensure unknown flags and credentials are redacted in command logs.

## Pre-PR Checklist

Run this command before creating a PR:
```bash
npm run lint && npm test && npm run build
```