# Tests - Validation Suite

**Technology**: Node.js native test runner (`node:test`), `assert`, `tsx`
**Entry Point**: `tests/**/*.test.ts`
**Parent Context**: This extends [../AGENTS.md](../AGENTS.md)

## Development Commands

```bash
npm run test              # Run all tests
npm run test:unit         # Run only unit tests
npm run test:integration  # Run only integration tests
npm run test:smoke:live   # Run live smoke checks against the actual CLI
```

## Architecture

### Directory Structure
```
tests/
├── unit/        # Isolated unit tests for utils and logic
├── integration/ # Integration tests mocking Gemini CLI or testing MCP responses
└── manual/      # Manual test scripts (e.g., mcp-live-smoke.mjs)
```

### Code Organization Patterns

#### Unit Testing
- ✅ **DO**: Use `describe` and `it` from `node:test`
  - Example: `tests/unit/responseChunker.test.ts`
  - Pattern: Mock external dependencies using `mock` from `node:test` or simple override patterns.
  - Assertions: Use standard `assert` module.

#### Integration/Smoke Testing
- ✅ **DO**: Rely on `tests/manual/mcp-live-smoke.mjs` as the source of truth for runtime execution against the real Gemini CLI.

## Key Files

- `tests/unit/geminiExecutor.test.ts` - Important logic for testing CLI invocations.
- `tests/integration/tools.integration.test.ts` - Tests end-to-end tool execution.
- `tests/manual/mcp-live-smoke.mjs` - Live validation of chunking, continuation, and core commands.

## Common Gotchas

- **Native Test Runner**: We do NOT use Jest or Vitest. We use Node's built-in test runner. Import from `node:test` and `node:assert`.
- **TypeScript**: We run tests with `tsx` as defined in package.json.
- **Mocking**: Be careful not to leak state across unit tests when using `mock.method()`.