# Contributing to Gemini Researcher

Thank you for your interest in contributing! This document provides guidelines and technical details for contributors.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Running Tests](#running-tests)
- [Code Guidelines](#code-guidelines)
- [Architecture Overview](#architecture-overview)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Getting Started

Before contributing, please:

1. Check existing [issues](https://github.com/capyBearista/gemini-researcher/issues) to avoid duplicate work
2. For major changes, open an issue first to discuss your proposal
3. Read through this guide to understand the codebase structure and conventions

## Development Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Gemini CLI installed globally: `npm install -g @google/gemini-cli`
- Gemini CLI authenticated (run `gemini` and login)

### Clone and install

```bash
git clone https://github.com/capyBearista/gemini-researcher.git
cd gemini-researcher
npm install
```

### Development workflow

```bash
# Watch mode for TypeScript compilation
npm run dev

# Build the project
npm run build

# Run linter
npm run lint

# Run all tests
npm test
```

### Testing your changes locally

1. Build the project: `npm run build`
2. Link globally: `npm link`
3. Configure your MCP client to use the local version
4. Test your changes in a real MCP client (Claude Code, VS Code, etc.)

## Running Tests

### Test structure

Tests are organized under `tests/`:
- `unit/`: Unit tests for individual utilities and functions
- `integration/`: End-to-end tests for tool execution

### Running tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration
```

### Writing tests

- **Unit tests**: Test individual functions in isolation. Mock external dependencies (Gemini CLI, filesystem).
- **Integration tests**: Test complete tool execution flows. Use mocked Gemini CLI responses where possible.
- **File location**: Place tests in corresponding directories under `tests/` (e.g., test for `src/utils/pathValidator.ts` goes in `tests/unit/pathValidator.test.ts`)

Example test structure:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { yourFunction } from '../../dist/utils/yourModule.js';

describe('yourFunction', () => {
  it('should handle valid input correctly', () => {
    const result = yourFunction('valid-input');
    assert.strictEqual(result, 'expected-output');
  });

  it('should throw error for invalid input', () => {
    assert.throws(() => yourFunction('invalid'), /Error message/);
  });
});
```

## Code Guidelines

### TypeScript and Module System

- **TypeScript strict mode**: All code must pass strict type checking
- **ES Modules**: Use `.js` extension in all import statements (not `.ts`)
  ```typescript
  // Correct
  import { executeTool } from './tools/registry.js';
  
  // Wrong
  import { executeTool } from './tools/registry';
  ```
- **Type safety**: Prefer explicit types over `any`; use Zod schemas for runtime validation

### Code Style

- **Formatting**: Use consistent indentation (2 spaces)
- **Naming conventions**:
  - Tool names: `snake_case` (e.g., `quick_query`, `analyze_directory`)
  - File names: `kebab-case.tool.ts` for tools, `camelCase.ts` for utilities
  - Cache keys: `cache_<random>` prefix
  - Error codes: `SCREAMING_SNAKE_CASE` (e.g., `PATH_NOT_ALLOWED`)
- **Exports**: Use named exports only (no default exports)

### Tool Development Pattern

All tools follow the `UnifiedTool` pattern defined in `src/tools/registry.ts`:

```typescript
import { z } from 'zod';
import { UnifiedTool } from './registry.js';

const myToolSchema = z.object({
  param: z.string().describe("Parameter description")
});

export const myTool: UnifiedTool = {
  name: 'my_tool',
  description: 'What this tool does',
  zodSchema: myToolSchema,
  category: 'query',
  
  async execute(args, onProgress) {
    // Validate args
    const validated = myToolSchema.parse(args);
    
    // Tool logic here
    
    // Return JSON string
    return JSON.stringify({
      tool: 'my_tool',
      result: 'data'
    }, null, 2);
  }
};
```

Then register in `src/tools/index.ts`:

```typescript
import { toolRegistry } from './registry.js';
import { myTool } from './my-tool.tool.js';

toolRegistry.push(myTool);
```

### Key Design Principles

**Stateless operation**
- Every tool call is independent
- No session files, context files, or persistent storage
- If continuity is needed, agents must provide full context in each request

**Read-only enforcement**
- Never modify files on disk
- Server-generated Gemini argv must never include `-y` or `--yolo`
- Runtime contract must include `--approval-mode default`
- Runtime contract should include `--admin-policy <path>` when strict enforcement is enabled
- Strict enforcement is enabled by default and can be relaxed only via `GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY=0|false|no|off`
- Policy is deny-list based; update policy entries when mutating tool names evolve upstream

**Server-managed model selection**
- Agents cannot choose models
- Server selects models based on tool type
- Implement 3-tier fallback strategy (default → fallback → auto-select)

**Project-root path restriction**
- All `@path` references must resolve within project root
- Reject reads outside project root
- Use `pathValidator.ts` utilities for validation

### Logging

- Use structured logging (see `src/utils/logger.ts`)
- Levels: `error`, `warn`, `info`, `debug`
- **NEVER log**: `GEMINI_API_KEY` or any authentication credentials
- **DO log**: tool invocations, redacted Gemini CLI args (not output), errors with sanitized stderr
- Prompt payloads in command args must remain fully redacted (`[REDACTED_PROMPT]`)

### Concern 2 invariants (must preserve)

Canonical runtime invariants live in `docs/runtime-contract.md`. This section is a contributor summary.

When changing CLI integration, setup, diagnostics, or logging, preserve these invariants:

1. **CLI contract**
   - `gemini [ -m <model> ] --output-format json --approval-mode default [--admin-policy <path>] -p "<prompt>"`
   - No server-generated `-y` or `--yolo`.

2. **Auth classification**
   - `configured`: auth confirmed.
   - `unauthenticated`: explicit auth failure.
   - `unknown`: ambiguous probe failure; never treat as configured.

   | Auth Status | Meaning | Required handling |
   |---|---|---|
   | `configured` | Authentication is confirmed | Normal operation |
   | `unauthenticated` | Authentication is missing/invalid | Fail setup/return degraded diagnostics |
   | `unknown` | Probe could not confirm auth | Fail-closed (do not treat as configured) |

3. **Health semantics**
   - Return `degraded` for auth/policy uncertainty rather than pretending healthy.

4. **Test expectations**
   - Behavior-level unit tests in `tests/unit/geminiExecutor.test.ts` assert exact argv and fallback sequencing.
   - Keep these tests updated if contract changes.

### Docs drift prevention checklist (required for runtime-impacting changes)

When a PR changes runtime behavior in executor/safety/auth/health/setup/logging/chunking/tool contracts:

1. Update `docs/runtime-contract.md` in the same PR.
2. Reconcile user-facing summaries in `README.md`.
3. Reconcile product-level statements in `docs/project-overview-PRD.md`.

## Architecture Overview

### File Structure

```
src/
├── index.ts                   # Main MCP server (stdio transport)
├── constants.ts               # Error messages, protocol constants, model names, system prompt
├── types.ts                   # Shared TypeScript types
├── tools/
│   ├── index.ts               # Tool registry exports
│   ├── registry.ts            # UnifiedTool interface and execution
│   ├── *.tool.ts              # Individual tool implementations
├── utils/
│   ├── geminiExecutor.ts      # Gemini CLI spawning + fallback logic
│   ├── responseCache.ts       # LRU cache for chunked responses
│   ├── responseChunker.ts     # Split large responses
│   ├── pathValidator.ts       # Path resolution and validation
│   ├── ignorePatterns.ts      # .gitignore parsing
│   ├── logger.ts              # Structured logging
│   └── ...
└── setup/
    └── wizard.ts              # Setup wizard for `init` command
```

### Key Files

- **`src/constants.ts`**: Authoritative system prompt, error codes, model names, protocol constants
- **`src/utils/geminiExecutor.ts`**: Gemini CLI integration and model fallback logic
- **`src/tools/registry.ts`**: UnifiedTool pattern and tool execution framework
- **`src/tools/*.tool.ts`**: Individual tool implementations

### Response Format

All tools return structured JSON (as MCP text content):

```json
{
  "tool": "tool_name",
  "model": "gemini-3-flash-preview",
  "answer": "Gemini's response",
  "filesAccessed": ["path1", "path2"],
  "stats": {
    "tokensUsed": 1234,
    "toolCalls": 2,
    "latencyMs": 5053
  },
  "meta": {
    "projectRoot": "/path/to/project",
    "truncated": false,
    "warnings": []
  }
}
```

Error responses:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "User-friendly error description",
    "details": {}
  }
}
```

## Submitting Changes

### Pull Request Process

1. **Fork the repository** and create a feature branch from `main`
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code guidelines above

3. **Test your changes**
   ```bash
   npm run lint
   npm test
   ```

4. **Commit with clear messages**
   ```bash
   git commit -m "Add feature: brief description"
   ```
   - Use present tense ("Add feature" not "Added feature")
   - Reference issues if applicable ("Fix #123: description")

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** with:
   - Clear description of what changed and why
   - Reference to related issues (if any)
   - Screenshots/examples if adding user-facing features
   - Confirmation that tests pass

### PR Review Criteria

Your PR will be reviewed for:
- Code quality and adherence to style guidelines
- Test coverage for new functionality
- Documentation updates (README, inline comments)
- Backwards compatibility (or clear migration path)
- Performance implications

For CLI-contract changes, reviewers should also verify:
- exact argv expectations still pass in unit tests,
- strict safety flags remain enforced by default,
- auth/health docs and behavior remain aligned.

## Release Process

Releases are managed by maintainers. The process:

1. Version bump in `package.json` (semantic versioning)
2. Update `CHANGELOG.md` with notable changes
3. Tag release in git
4. Publish to npm
5. Create GitHub release with notes

Contributors do not need to bump versions in their PRs.

---

## Questions?

- Open an [issue](https://github.com/capyBearista/gemini-researcher/issues) for technical questions
- Check existing issues and discussions first

Thank you for contributing to Gemini Researcher!
