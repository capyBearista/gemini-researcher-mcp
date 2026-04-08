# Gemini Researcher

## Overview
- **Type**: Standard project (Node.js MCP Server)
- **Stack**: Node.js (>=18), TypeScript, Zod, @modelcontextprotocol/sdk
- **Architecture**: Stateless proxy to Gemini CLI returning chunked JSON
- **Team Size**: Open Source (Single author focus)

This AGENTS.md is the authoritative source for development guidelines. 
Subdirectories contain specialized AGENTS.md files that extend these rules.

## Universal Development Rules

### Code Quality (MUST)
- **MUST** write TypeScript in strict mode
- **MUST** include tests for all new features
- **MUST** run `npm run lint` and `npm test` before committing
- **MUST NOT** commit secrets, API keys, or tokens (especially `GEMINI_API_KEY`)

### Best Practices (SHOULD)  
- **SHOULD** prefer pure functions and immutable state
- **SHOULD** use descriptive variable names
- **SHOULD** extract complex logic into separate utility functions in `src/utils`
- **SHOULD** ensure all MCP tool schemas use Zod for validation

### Anti-Patterns (MUST NOT)
- **MUST NOT** use `any` type without explicit justification
- **MUST NOT** bypass TypeScript errors with `@ts-ignore`
- **MUST NOT** push directly to main branch
- **MUST NOT** mutate global state or modify files (server must remain read-only)

## Core Commands

### Development
- `npm run build` - Build the project (`tsc`)
- `npm run dev` - Watch mode for TypeScript
- `npm start` - Run the built application
- `npm run lint` - Type-check the codebase (`tsc --noEmit`)
- `npm test` - Run all tests
- `npm run test:unit` - Run only unit tests
- `npm run test:integration` - Run only integration tests

### Quality Gates (run before PR)
```bash
npm run lint && npm test
```

## Project Structure

### Applications
- **`src/`** → Core server logic ([see src/AGENTS.md](src/AGENTS.md))
  - Tools: `src/tools/` → MCP Tool implementations
  - Utilities: `src/utils/` → Helpers (caching, chunking, parsing)
  - Setup: `src/setup/` → CLI init wizard

### Infrastructure
- **`.github/workflows/`** → CI/CD pipelines (publishing)

### Testing
- **`tests/`** → Testing suite ([see tests/AGENTS.md](tests/AGENTS.md))
  - Unit tests: `tests/unit/`
  - Integration: `tests/integration/`
  - Manual: `tests/manual/`

## Quick Find Commands

### Code Navigation
```bash
# Find a tool definition
rg -n "export const .*Tool:" src/tools

# Find an MCP capability
rg -n "server.setRequestHandler" src/

# Find a utility function
rg -n "export (async )?function" src/utils

# Find Zod schema
rg -n "z.object" src/
```

### Dependency Analysis
```bash
# Find unused dependencies
npx depcheck
```

## Security Guidelines

### Secrets Management
- **NEVER** commit tokens, API keys, or credentials
- Use `.env` or standard environment variables for local secrets (already ignored)
- PII must be redacted in logs

### Safe Operations
- Review generated bash commands before execution
- Confirm before: git force push, rm -rf
- **Critical**: Ensure the server *never* attempts to write files or run destructive commands via Gemini CLI.

## Git Workflow

- Branch from `main` for features: `feature/description`
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`
- PRs require: passing tests, type checks, and lint
- Squash commits on merge
- Delete branches after merge

## Testing Strategy

- **Unit tests**: All core utilities (chunking, caching, parsing). Aim for >80% coverage.
- **Integration tests**: MCP Server interactions.  
- Run tests before committing (enforced by CI).
- New tools require tests before review.

## Available Tools

You have access to:
- Standard bash tools (rg, git, node, npm, etc.)
- GitHub CLI (`gh`) for issues, PRs, releases

### Tool Permissions
- ✅ Read any file
- ✅ Write code files
- ✅ Run tests, linters, type checkers
- ❌ Edit `.github/workflows/publish.yml` (ask first)
- ❌ Force push (ask first)
- ❌ Execute `npm publish` (handled by CI)

## Specialized Context

When working in specific directories, refer to their AGENTS.md:
- Core server logic: [src/AGENTS.md](src/AGENTS.md)
- MCP Tools: [src/tools/AGENTS.md](src/tools/AGENTS.md)
- Testing: [tests/AGENTS.md](tests/AGENTS.md)

These files provide detailed, context-specific guidance.