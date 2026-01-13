# Phase 2: Architectural Consistency Review

**Date:** January 13, 2026  
**Scope:** Architectural patterns, component interactions, type consistency

---

## Summary

Phase 2 performed a comprehensive architectural review of the better-gemini-mcp codebase. The review found the architecture to be well-structured with clean separation of concerns. One type definition inconsistency was identified and corrected.

---

## Review Tasks Completed

### 1. Tool Registry Pattern ✅

**Analysis:**
- All 6 tools (`quick_query`, `deep_research`, `analyze_directory`, `validate_paths`, `health_check`, `fetch_chunk`) follow the `UnifiedTool` interface consistently
- Each tool exports a `UnifiedTool` object with required properties: `name`, `description`, `zodSchema`, `category`, `execute`
- Tools are properly registered in [src/tools/index.ts](src/tools/index.ts)
- Pattern matches the jamubc reference implementation

**Findings:** No issues. Pattern is consistently applied.

### 2. Response Format Consistency ✅

**Analysis:**
- All tools return JSON strings in MCP text content (consistent with PRD)
- Error format is consistent across all tools: `{ error: { code, message, details } }`
- Query tools (`quick_query`, `deep_research`) include full `meta` with `projectRoot`, `truncated`, `warnings`
- Utility tools (`validate_paths`, `health_check`) have simpler responses per PRD specification

**Findings:** Response formats match PRD specifications.

### 3. Dependency Flow ✅

**Analysis:**
Mapped the import graph across `src/`:

```
constants.ts  ──┐
                │
types.ts ───────┼──→ utils/*.ts ──→ tools/*.ts ──→ index.ts
                │
setup/*.ts ─────┘
```

**Verified:**
- ✅ `utils/` modules do NOT import from `tools/`
- ✅ No circular dependencies detected
- ✅ Proper layering: utilities are agnostic of tool implementations
- ✅ Cross-utility imports (e.g., `ignorePatterns.ts` → `pathValidator.ts`) are within the same layer

**Findings:** Clean dependency flow with no layer violations.

### 4. Stateless Operation Verification ✅

**Analysis:**
Searched for patterns that could violate statelessness:
- No session management code
- No persistent storage writes
- No global mutable state shared between tool invocations

**Acceptable state:**
- `responseCache.ts`: In-memory cache with 1-hour TTL (explicitly allowed per PRD §5.7)
- Progress tracking in `index.ts` (`isProcessing`, `latestOutput`): Scoped to single request lifecycle

**Findings:** Server maintains stateless operation as required by PRD §4.2.

### 5. Error Handling Consistency ✅

**Analysis:**
- All tools use error codes from the defined `ERROR_CODES` constant
- Error structure follows PRD contract: `{ error: { code, message, details } }`
- `isError` flag is set correctly via the tool registry execution flow
- Recovery hints (`nextStep`) are included in error details

**Findings:** Error handling is consistent.

---

## Changes Made

### Type Definition Corrections

**Issue:** Type interfaces in `src/types.ts` incorrectly extended `BaseToolResponse` for tools that don't include the `meta` field per PRD.

**Root Cause:** `BaseToolResponse` requires `meta: ResponseMeta`, but utility tools (`validate_paths`, `health_check`, `fetch_chunk`) have different response structures per their PRD specifications.

**Changes:**

1. **ValidatePathsResponse** ([src/types.ts#L151-L157](src/types.ts#L151-L157))
   - Removed incorrect `extends BaseToolResponse`
   - Added explicit `tool: string` field
   - Added note referencing PRD §5.5

2. **HealthCheckResponse** ([src/types.ts#L176-L187](src/types.ts#L176-L187))
   - Removed incorrect `extends BaseToolResponse`
   - Added explicit `tool: string` field
   - Fixed `status` type to include `"degraded"` (matches actual implementation)
   - Added note referencing PRD §5.6

3. **FetchChunkResponse** ([src/types.ts#L189-L201](src/types.ts#L189-L201))
   - Removed incorrect `extends BaseToolResponse`
   - Simplified `meta` to only contain `expiresAt` per PRD §5.7
   - Added note referencing PRD §5.7

**Rationale:** Type definitions should match PRD specifications and actual implementation. These changes align types with the documented output contracts.

---

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build` | ✅ Success |
| `npx tsc --noEmit` | ✅ Success |
| `npm run test:unit` | ✅ 129/129 tests pass |

---

## Deferred Findings

The following observations were noted but intentionally NOT addressed to maintain the conservative approach:

1. **Tool annotations**: The modern MCP SDK recommends tool annotations (`readOnlyHint`, `destructiveHint`, etc.), but the current implementation works correctly without them. Adding annotations would be an enhancement, not a fix.

2. **Response format parameter**: The style conventions mention tools should support `response_format` parameter for `markdown`/`json` output. This is not implemented but doesn't affect current functionality.

3. **Duplicate `FOCUS_INSTRUCTIONS`**: Both `quick_query` and `deep_research` tools define identical `FOCUS_INSTRUCTIONS` constants. This could be extracted to `constants.ts`, but the current structure is working correctly.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   src/index.ts                               │
│  - MCP Server (stdio transport)                              │
│  - Request handlers (ListTools, CallTool)                    │
│  - Progress notifications                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   src/tools/                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ registry.ts                                             ││
│  │ - UnifiedTool interface                                 ││
│  │ - getToolDefinitions(), executeTool()                   ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Tool implementations (6 tools)                          ││
│  │ - quick-query.tool.ts       (query)                     ││
│  │ - deep-research.tool.ts     (query)                     ││
│  │ - analyze-directory.tool.ts (query)                     ││
│  │ - validate-paths.tool.ts    (utility)                   ││
│  │ - health-check.tool.ts      (utility)                   ││
│  │ - fetch-chunk.tool.ts       (utility)                   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   src/utils/                                 │
│  - geminiExecutor.ts    (Gemini CLI invocation + fallback)   │
│  - commandExecutor.ts   (child_process.spawn wrapper)        │
│  - pathValidator.ts     (security enforcement)               │
│  - ignorePatterns.ts    (.gitignore + hard-coded ignores)    │
│  - responseCache.ts     (1-hour TTL chunking cache)          │
│  - responseChunker.ts   (10KB chunk splitting)               │
│  - logger.ts            (structured logging, no secrets)     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Gemini CLI                                 │
│  (External binary invoked via child_process.spawn)           │
└─────────────────────────────────────────────────────────────┘
```

---

## Conclusion

The codebase demonstrates strong architectural consistency:
- Clean tool registry pattern following the reference implementation
- Proper separation of concerns with no circular dependencies
- Stateless operation as required by PRD
- Consistent error handling patterns

The only change required was correcting type definitions to match PRD specifications. No behavioral changes were introduced.
