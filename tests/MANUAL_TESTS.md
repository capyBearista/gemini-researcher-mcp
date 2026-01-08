# Manual Testing Checklist

This document provides a comprehensive checklist for manual testing of the Better Gemini MCP server before release.

## Prerequisites

Before running manual tests, ensure:

1. **Gemini CLI is installed:**
   ```bash
   which gemini  # Should return path
   gemini --version
   ```

2. **Authentication is configured:**
   - Run `gemini` and authenticate with Google, OR
   - Set `GEMINI_API_KEY` environment variable

3. **MCP server builds successfully:**
   ```bash
   npm run build
   ```

---

## 1. Claude Code Integration

### Setup
1. Add to `~/.config/Claude/claude_desktop_config.json`:
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
2. Restart Claude Desktop

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Server connection | Open Claude Desktop, check MCP status | Server shows as connected | |
| List tools | Ask "What tools do you have available?" | Should list 6 better-gemini-mcp tools | |
| Quick query | Ask to analyze a file using quick_query | Returns structured JSON response | |
| Deep research | Ask for deep analysis of code architecture | Returns detailed analysis | |
| Health check | Ask to check Gemini MCP health | Returns status OK with diagnostics | |

---

## 2. VS Code Copilot Integration

### Setup
1. Add MCP server to VS Code settings or `.vscode/mcp-settings.json`:
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
2. Reload VS Code window

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Server connection | Check MCP extension status | Server shows as connected | |
| Tool invocation | Use Copilot to invoke quick_query | Tool executes successfully | |

---

## 3. Large Directory Analysis

### Setup
Navigate to a large project (e.g., a project with >500 files)

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Default limit | Run `analyze_directory` on root | Returns ≤500 files, truncated=true | |
| Custom limit | Run with `maxFiles: 100` | Returns ≤100 files | |
| Depth limit | Run with `depth: 2` | Only files within 2 levels | |
| Ignore patterns | Check node_modules excluded | node_modules files not in results | |
| .gitignore respect | Add pattern to .gitignore | Pattern respected in results | |

---

## 4. Stateless Operation Verification

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Independent calls | Make two quick_query calls | Each returns complete, independent result | |
| No session files | Check for session files after calls | No `.better-gemini-mcp/sessions/` created | |
| Context not preserved | Ask followup without context | Server doesn't remember previous query | |

---

## 5. Quota Fallback Testing

### Setup
This requires triggering quota errors, which may require high usage or API key with low limits.

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Tier 1 → Tier 2 | Trigger quota on gemini-3-flash | Falls back to gemini-2.5-flash | |
| Tier 2 → Tier 3 | Trigger quota on tier 2 | Falls back to auto-select | |
| All tiers exhausted | Exhaust all quotas | Returns QUOTA_EXCEEDED error | |

**Note:** Fallback can be simulated by temporarily modifying constants to use invalid model names.

---

## 6. Chunked Response Testing

### Setup
Use a query that produces very large output (>10KB)

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Auto-chunking | Request analysis producing >10KB | Response includes `chunks` metadata | |
| First chunk | Check initial response | Contains chunk 1 of N, has cacheKey | |
| Fetch chunk 2 | Call `fetch_chunk` with cacheKey | Returns chunk 2 content | |
| Fetch all chunks | Retrieve all chunks | Concatenated = complete response | |
| Cache expiry | Wait 1 hour, try fetch_chunk | Returns CACHE_EXPIRED error | |

---

## 7. Path Validation Security

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Valid path | validate_paths with `["src/index.ts"]` | allowed: true | |
| Parent traversal | validate_paths with `["../../../etc/passwd"]` | allowed: false | |
| Absolute system path | validate_paths with `["/etc/passwd"]` | allowed: false | |
| Mixed valid/invalid | validate_paths with mixed array | Correctly identifies each | |
| Prompt path check | quick_query with `@/etc/passwd` | Returns PATH_NOT_ALLOWED error | |

---

## 8. Setup Wizard

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Fresh setup | Run `npx better-gemini-mcp init` | Shows wizard steps 1-3 | |
| Gemini missing | Temporarily remove gemini from PATH | Shows install instructions | |
| Auth missing | Unset GEMINI_API_KEY, no login | Shows auth setup options | |
| Complete setup | With valid Gemini + auth | Shows "Setup Complete!" + next steps | |

---

## 9. Error Handling

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Empty prompt | quick_query with empty prompt | INVALID_ARGUMENT error | |
| Invalid tool | Call nonexistent tool | "Unknown tool" error | |
| Invalid arguments | Pass wrong types | "Invalid arguments" error | |
| Gemini CLI error | Force CLI error (e.g., network issue) | GEMINI_CLI_ERROR with details | |

---

## 10. Performance Tests

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Quick query latency | Time a simple query | < 30 seconds | |
| Deep research | Time complex analysis | < 5 minutes (may vary) | |
| Progress notifications | Monitor during long query | Receives keepalive every ~25s | |

---

## 11. Edge Cases

### Tests

| Test | Steps | Expected Result | ✓/✗ |
|------|-------|-----------------|-----|
| Unicode in paths | Validate path with unicode chars | Handles correctly | |
| Very long prompt | Send 10KB prompt | Processes or returns clear error | |
| Empty directory | analyze_directory on empty dir | Returns empty entries, no error | |
| Binary files | Include binary file in path | Skipped or handled gracefully | |

---

## Test Environment Checklist

Before testing, verify:

- [ ] Node.js 18+ installed
- [ ] npm dependencies installed (`npm install`)
- [ ] Project built (`npm run build`)
- [ ] Gemini CLI installed globally
- [ ] Authentication configured (Google login or API key)
- [ ] PROJECT_ROOT set correctly (or using cwd)

---

## Reporting Issues

When reporting test failures, include:

1. **Test case:** Which test failed
2. **Environment:** OS, Node version, Gemini CLI version
3. **Steps to reproduce:** Exact commands/inputs
4. **Expected result:** What should happen
5. **Actual result:** What actually happened
6. **Logs:** Any error messages or output

---

## Sign-off

| Tester | Date | Version | All Tests Pass |
|--------|------|---------|----------------|
| | | 1.0.0 | ☐ |
