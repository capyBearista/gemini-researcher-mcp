# Gemini Researcher MCP — Gemini CLI Proxy MCP Server — Product Requirements Document (PRD)

## 1) Executive Summary

### 1.1 Vision
Build a **simple, stateless MCP server** that acts as a lightweight "research proxy" for developer agents (Claude Code and GitHub Copilot in VS Code), leveraging the large context window of **Gemini CLI** to analyze local codebases and documents without consuming the calling agent's context window.

### 1.2 Core Goals (must-haves)
1. **Reduce calling-agent context usage**: the agent should not need to paste large files into its context.
2. **Reduce calling-agent model usage**: move "deep reading and synthesis" workload into Gemini CLI, keeping the calling agent's participation minimal.
3. **Painless setup**: one-command installation with friendly validation and guidance for first-time users.
4. **Structured research outputs**: return sanitized, JSON-formatted responses that agents can easily parse and use.
5. **Read-only safety by default**: enforce read-only analysis via approval mode + admin policy.

### 1.3 Non-Goals (explicit exclusions)
- **Session management**: No persistent sessions, context files, or session tracking (fully stateless).
- **Code generation or patch application**: the server must not generate/apply code changes, scaffolds, or patches to the repo.
- **Streaming raw terminal UI**: no forwarding of Gemini CLI TTY UI; only structured tool results.
- **Google Gemini Node SDK**: do not use the SDK; invoke the `gemini` binary directly.
- **Sandboxing (v1)**: do not implement `--sandbox` in v1 (may be revisited later).
- **Alternative execution engines**: do not add SDK-based runtime paths; invoke Gemini CLI directly.
- **Multi-turn conversation continuity**: Each tool call is independent; agents must include full context in each request.

---

## 2) Users, Clients, and Primary Use Cases

### 2.1 Supported Clients (v1)
- **Claude Code** (MUST)
- **VS Code (GitHub Copilot)** (MUST)

### 2.2 Primary Use Cases
1. **Deep codebase analysis**
   - "Analyze authentication flow across @src/auth and explain failure modes."
2. **Independent research queries**
   - Each query is self-contained; no conversation history maintained by server.
3. **Directory mapping**
   - "Summarize what's inside @src and what each module is responsible for."

---

## 3) Product Principles

1. **Stateless by design**
   - Every tool call is independent; no server-managed state.
   - Agents are responsible for providing full context in each request.
2. **Structured responses for agents**
   - Tool responses return machine-readable JSON fields (delivered as a JSON string inside MCP `text` content for compatibility).
3. **Safety by default**
   - Restrict Gemini CLI to read-only tools via configuration.
   - Respect `.gitignore` patterns to avoid unnecessary file reads.
4. **Simple setup, fail-fast validation**
   - Validate Gemini CLI installation and authentication on startup.
   - Provide actionable error messages with setup guidance.

---

## 4) System Overview

### 4.1 High-level Architecture
**Agent (Claude Code / Copilot)** → **MCP Server** → spawns **Gemini CLI (read-only mode)** → reads project files via `@path` → server returns sanitized JSON output.

### 4.2 Stateless Pattern
- Each tool invocation spawns an independent Gemini CLI process.
- No session files, context files, or persistent storage.
- If agents need continuity, they must include prior responses in subsequent prompts.

---

## 5) Functional Requirements

### 5.1 Tool Surface Area (v1)
**Core tools (required)**:
1. `quick_query` (lighter tasks; flash model by default)
2. `deep_research` (heavier tasks; pro model by default)
3. `analyze_directory` (directory summarization)
4. `validate_paths` (preflight path validation)
5. `health_check` (server and Gemini CLI diagnostics)
6. `fetch_chunk` (retrieve chunked response segments)

---

### 5.2 Tool: `quick_query`

#### Purpose
Send a lightweight research prompt to Gemini CLI for fast analysis.

This tool is optimized for faster turnaround and lower cost using flash models.

#### Input Schema (Zod)
```typescript
{
  prompt: z.string().describe("Research question or analysis request"),
  focus: z.enum(["security", "architecture", "performance", "general"])
    .optional()
    .describe("Optional focus area to guide analysis"),
  responseStyle: z.enum(["concise", "normal", "detailed"])
    .optional()
    .default("normal")
    .describe("Desired verbosity of response")
}
```

#### Behavior
1. **Validate prompt**
   - Ensure `prompt` is non-empty.
   - Optionally pre-validate any `@path` references in `prompt` to ensure they exist and are within project root.
2. **Construct Gemini CLI invocation**
   - Prepend read-only safety instructions to `prompt`.
   - If `focus` is specified, inject focus context (e.g., "Focus on security implications...").
   - Select model based on tool: `gemini-3-flash-preview` (default), fallback `gemini-2.5-flash` on quota/capacity errors, then auto-select.
3. **Execute Gemini CLI**
   - Run in headless mode with `--output-format json` and `--approval-mode default`.
   - Pass prompt as positional argument (no `-p`).
   - Enforce `--admin-policy <path>` by default (toggleable for advanced users via env).
4. **Parse and sanitize output**
   - Extract `response` from Gemini's JSON output.
   - Extract `stats` (tokens used, files accessed if available).
   - Truncate response if it exceeds a configurable threshold (default: 50KB), with warning.
5. **Return structured JSON**

#### Chunking Behavior
If Gemini's response exceeds **10KB** (configurable via `RESPONSE_CHUNK_SIZE_KB` env var):

1. Split response into chunks of ~10KB each
2. Cache all chunks with a generated `cacheKey` (1-hour TTL)
3. Return first chunk with chunking metadata

Agents should call `fetch_chunk` with the `cacheKey` to retrieve subsequent chunks.

#### Output Contract (returned as JSON string inside MCP text content)
```json
{
  "tool": "quick_query",
  "model": "gemini-3-flash-preview",
  "focus": "architecture",
  "responseStyle": "concise",
  "answer": "string (Gemini's full response, plain text or markdown)",
  "filesAccessed": ["src/auth.ts", "src/middleware/rate-limit.ts"],
  "stats": {
    "tokensUsed": 1234,
    "toolCalls": 2,
    "latencyMs": 5053
  },
  "chunks": {
    "cacheKey": "cache_abc123",
    "current": 1,
    "total": 3
  },
  "meta": {
    "projectRoot": "/home/user/myproject",
    "truncated": false,
    "warnings": []
  }
}
```

**Note:** The `chunks` field is only present when the response is chunked.

**Format detail**: The JSON is pretty-printed (2-space indent) for readability in agent logs.

#### Error Contract
Errors must be both:
- `CallToolResult.isError = true` (MCP-level)
- a JSON error object serialized as a string in `CallToolResult.content[0].text`

```json
{
  "error": {
    "code": "INVALID_ARGUMENT|PATH_NOT_ALLOWED|GEMINI_CLI_NOT_FOUND|GEMINI_CLI_ERROR|AUTH_MISSING|INTERNAL",
    "message": "string (user-friendly error description)",
    "details": { "any": "json (optional structured details)" }
  }
}
```

**MCP Protocol Level**: `isError = true` signals to the MCP client that this call failed. The JSON payload provides detailed error context for the agent.

---

### 5.3 Tool: `deep_research`

#### Purpose
Send a heavyweight research prompt to Gemini CLI for in-depth analysis across many files.

This tool is optimized for deeper reasoning using pro models with larger context windows.

#### Input Schema (Zod)
```typescript
{
  prompt: z.string().describe("Complex research question or analysis request"),
  focus: z.enum(["security", "architecture", "performance", "general"])
    .optional()
    .describe("Optional focus area to guide analysis"),
  citationMode: z.enum(["none", "paths_only"])
    .optional()
    .default("none")
    .describe("Include file citations in response")
}
```

#### Behavior
Same as `quick_query`, with different **server-owned model selection**:
- Default model: `gemini-3-pro-preview`
- Fallback model (quota/availability): `gemini-2.5-pro`
- Safety-net model: auto-select (omit `-m`)

If `citationMode` is `paths_only`, instruct Gemini to include a "Files referenced" section listing file paths (no line numbers required).

#### Chunking Behavior
Same chunking behavior as `quick_query` (see §5.2). Deep research queries often produce large responses, making chunking critical for this tool.

#### Output Contract (returned as JSON string inside MCP text content)
Same structure as `quick_query`, with the addition of `citationMode` field:

```json
{
  "tool": "deep_research",
  "model": "gemini-3-pro-preview",
  "focus": "security",
  "citationMode": "paths_only",
  "answer": "string (Gemini's full response, may include a 'Files referenced' section if citationMode='paths_only')",
  "filesAccessed": ["src/auth.ts", "src/models/user.ts", "..."],
  "stats": {
    "tokensUsed": 15678,
    "toolCalls": 8,
    "latencyMs": 12543
  },
  "chunks": {
    "cacheKey": "cache_xyz789",
    "current": 1,
    "total": 5
  },
  "meta": {
    "projectRoot": "/home/user/myproject",
    "truncated": false,
    "warnings": []
  }
}
```

**Note:** The `chunks` field is only present when the response is chunked.

---

### 5.4 Tool: `analyze_directory`

#### Purpose
Provide a high-level map of a directory while respecting ignore rules and project-root restrictions.

#### Input Schema (Zod)
```typescript
{
  path: z.string().describe("Relative or absolute path to directory"),
  depth: z.number().int().positive().optional()
    .describe("Maximum traversal depth (default: unlimited)"),
  maxFiles: z.number().int().positive().optional()
    .describe("Maximum files to enumerate (default: 500)")
}
```

#### Behavior
1. Resolve `path` relative to project root.
2. Enumerate files under `path` **server-side** using ignore rules (see §7.4).
   - Default behavior: traverse recursively to the deepest level.
   - `depth` limits traversal depth when provided.
   - `maxFiles` limits how many files are enumerated when provided; default safety cap is 500.
3. Construct a Gemini prompt that:
   - provides the file list (with relative paths)
   - instructs Gemini to summarize each file's responsibility in one sentence
   - allows Gemini to open files from the list using `@relative/path` if needed
   - forbids reading outside the listed paths
4. Execute Gemini CLI (using flash model for speed).
5. Parse response and extract file summaries.

#### Output Contract (returned as JSON string)
```json
{
  "tool": "analyze_directory",
  "directory": "./src",
  "entries": [
    { "path": "src/index.ts", "summary": "Main application entry point" },
    { "path": "src/auth/login.ts", "summary": "User login handler with JWT generation" }
  ],
  "meta": {
    "excluded": ["node_modules", ".git"],
    "fileCount": 123,
    "depthTraversed": 5,
    "warnings": ["Exceeded maxFiles limit; showing first 500 files only"]
  }
}
```

---

### 5.5 Tool: `validate_paths`

#### Purpose
Preflight check for `@path` references (existence + within project root) so agents can correct quickly before invoking research tools.

#### Input Schema (Zod)
```typescript
{
  paths: z.array(z.string()).describe("Array of paths to validate")
}
```

#### Behavior
For each path in `paths`:
1. Resolve to absolute path (relative to project root).
2. Check if path exists.
3. Check if path is within project root (no `..` traversal, no system paths).
4. Return validation result.

#### Output Contract (returned as JSON string)
```json
{
  "tool": "validate_paths",
  "results": [
    {
      "input": "src/auth.ts",
      "resolved": "/home/user/myproject/src/auth.ts",
      "exists": true,
      "allowed": true
    },
    {
      "input": "../../../etc/passwd",
      "resolved": "/etc/passwd",
      "exists": true,
      "allowed": false,
      "reason": "Path is outside project root"
    }
  ]
}
```

---

### 5.6 Tool: `health_check`

#### Purpose
Confirm the MCP server is running and able to service requests. Validate Gemini CLI setup.

#### Input Schema (Zod)
```typescript
{
  includeDiagnostics: z.boolean().optional().default(false)
    .describe("Include detailed diagnostics (Gemini CLI version, auth status, etc.)")
}
```

#### Behavior
1. Check if `gemini` binary is on PATH.
2. If `includeDiagnostics` is true:
   - Run `gemini --version` to get version.
   - Check for `GEMINI_API_KEY` environment variable.
   - Optionally test a minimal Gemini CLI invocation to verify auth.

#### Status Values
- `"ok"` - Server and Gemini CLI are fully functional
- `"degraded"` - Server running but Gemini CLI has issues (not installed, missing auth, etc.)
- `"error"` - Health check encountered an error during diagnostics

#### Auth and enforcement state semantics

Diagnostics should include auth confidence and enforcement details:

| Field | Values | Meaning |
|---|---|---|
| `authStatus` | `configured` \| `unauthenticated` \| `unknown` | Explicit auth confidence state |
| `readOnlyModeEnforced` | `true` \| `false` | Whether strict enforcement is active and verifiable |

Auth state meaning:
- `configured`: auth confirmed.
- `unauthenticated`: auth clearly missing/invalid.
- `unknown`: auth probe could not confirm due to ambiguous failure.

Health status mapping:
- `ok` only when Gemini is available, auth is configured, and strict enforcement checks are satisfied (or intentionally relaxed via env).
- `degraded` for auth uncertainty/failure or enforcement gaps.

#### Output Contract (returned as JSON string)
```json
{
  "tool": "health_check",
  "status": "ok",
  "server": {
    "name": "gemini-researcher",
    "version": "1.0.0"
  },
  "diagnostics": {
    "projectRoot": "/home/user/myproject",
    "geminiOnPath": true,
    "geminiVersion": "2.1.0",
    "authConfigured": true,
    "authStatus": "configured",
    "authMethod": "google_login",
    "readOnlyModeEnforced": true,
    "warnings": []
  }
}
```

---

### 5.7 Tool: `fetch_chunk`

#### Purpose
Retrieve a specific chunk of a large response that was previously split due to size constraints.

#### Input Schema (Zod)
```typescript
{
  cacheKey: z.string().describe("Cache key returned in initial chunked response"),
  chunkIndex: z.number().int().positive().describe("1-based index of chunk to retrieve")
}
```

#### Behavior
1. Validate `cacheKey` exists in cache (1-hour TTL).
2. Validate `chunkIndex` is within range (1 to total chunks).
3. Return requested chunk with metadata.

#### Output Contract (returned as JSON string)
```json
{
  "tool": "fetch_chunk",
  "cacheKey": "cache_xyz123",
  "chunk": {
    "index": 2,
    "total": 3,
    "content": "... chunk 2 content ..."
  },
  "meta": {
    "expiresAt": "2026-01-08T04:30:00.000Z"
  }
}
```

#### Error Contract
- `CACHE_EXPIRED`: Cache key not found or expired
- `INVALID_CHUNK_INDEX`: Index out of range

---

## 6) Filesystem Scope and Ignore Rules

### 6.1 Project Root Restriction
- Default allowed root is the server start directory (`process.cwd()` at startup).
- Reject reads outside project root.
- **No complex allowlist configuration** in v1 (can be added post-v1 if needed).

### 6.2 Prompt `@path` Pre-Validation (Optional)
- For tools that accept prompts (`quick_query`, `deep_research`):
  - Optionally pre-scan prompts for `@path` references.
  - If found, validate they exist and are within project root.
  - Return early error if invalid paths detected.
- **Implementation note**: This is a best-effort validation; Gemini CLI will also enforce its own path restrictions.

### 6.3 Ignore Patterns (directory analysis)
For `analyze_directory` file enumeration, ignore:
- `.git/`
- `node_modules/`
- `dist/`, `build/`, `out/`, `.next/`, `coverage/`
- `.venv/`, `venv/`, `__pycache__/`

Also respect:
- `.gitignore` rules (use a library like `ignore` npm package)
- **No custom `.gemini-ignore`** in v1 (defer to post-v1)

---

## 7) Gemini CLI Integration Requirements

### 7.1 Installation Requirement
- Gemini CLI must be installed via:
  - `npm install -g @google/gemini-cli`

### 7.2 Headless Invocation
- Use headless mode with positional prompt argument.
- Use `--output-format json` for structured parsing.
- Use `--approval-mode default` (no `-y`, no `--yolo`).
- Enforce `--admin-policy <path>` by default.
- Respect `GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY=0|false|no|off` as explicit relaxed mode.

### 7.3 Model Selection and Fallback Strategy

Model selection is **server-owned** (not configurable by agents). The MCP server uses a 3-tier fallback strategy:

| Tool            | 1st Attempt (Default)     | 2nd Attempt (Fallback)  | 3rd Attempt (Safety Net) |
|-----------------|---------------------------|-------------------------|--------------------------||
| `quick_query`   | `gemini-3-flash-preview`  | `gemini-2.5-flash`      | Auto-select (no `-m`)    |
| `deep_research` | `gemini-3-pro-preview`    | `gemini-2.5-pro`        | Auto-select (no `-m`)    |
| `analyze_directory` | `gemini-3-flash-preview` | `gemini-2.5-flash`  | Auto-select (no `-m`)    |

**Fallback Logic:**
1. **Quota/capacity error** on 1st attempt → retry immediately with 2nd tier
2. **Quota/capacity error** on 2nd attempt → retry with no model specified (Gemini CLI auto-selects)
3. **Any other error** → fail fast with error details

**Gemini 3 Access Requirement:**
Users must enable Preview Features in Gemini CLI to access Gemini 3 models:
```bash
# In Gemini CLI:
/settings
# Toggle "Preview Features" to true
```

If Gemini 3 models are unavailable (user hasn't enabled Preview Features or lacks access), the server will automatically fall back to Gemini 2.5 models without user intervention.

**Reference:** See local bundled docs in `docs/gemini-cli/` for CLI behavior details.

### 7.4 Read-Only Enforcement

Read-only protection is enforced by server contract, not by assumption:

1. Runtime uses `--approval-mode default`.
2. Runtime passes `--admin-policy` by default using bundled policy `policies/read-only-enforcement.toml`.
3. Bundled policy denies known mutating tools (for example `write_file`, `replace`, `run_shell_command`, plus alias variants).
4. `-y` / `--yolo` are never used in server-generated argv.

**Caveat:** Policy is deny-list based. New mutating tool names introduced by upstream may require policy updates.

**Operational note:** Extensions remain enabled; strict admin policy should remain enabled in production.

### 7.5 Server-Managed System Prompt

Every Gemini CLI invocation includes a server-managed preamble to optimize for token efficiency and enforce constraints. This is **hardcoded** (not user-configurable) to ensure consistent behavior:

```typescript
const SYSTEM_PROMPT = `
You are analyzing a codebase on behalf of an AI coding agent.

CRITICAL CONSTRAINTS:
- Read-only analysis ONLY (write/edit tools are blocked by enforced admin policy)
- Do NOT suggest code changes, patches, or file modifications
- Do NOT attempt to use run_shell_command or write_file (not available)

OPTIMIZATION FOR TOKEN EFFICIENCY:
- The calling agent has limited context - be concise but thorough
- Prioritize KEY findings over exhaustive details
- Include file paths for all referenced code
- Use bullet points and structured formatting for clarity
- If asked about security/architecture/performance, focus ONLY on that dimension

OUTPUT FORMAT:
- Start with a 2-3 sentence executive summary
- Provide detailed findings with file path references
- End with a "## Files Referenced" section listing all paths examined
`;

const finalPrompt = `${SYSTEM_PROMPT}\n\n---\n\nUSER REQUEST:\n${userProvidedPrompt}`;
```

**Rationale:** This preamble is critical to the value proposition (token savings). It prevents wasted tool attempts and ensures consistent, agent-friendly responses.

**Note:** The system prompt adds approximately 150 tokens to each request, which is negligible compared to the token savings from optimized responses.

---

## 8) MCP Protocol Requirements

### 8.1 Compatibility
- Implement MCP `tools/list` and `tools/call`.
- Support progress notifications using the standard `_meta.progressToken` pattern (client-driven).

### 8.2 Keepalive / Progress
- No server-side timeout.
- If a client provides a progress token, emit periodic progress notifications (e.g., every ~25s) to keep clients responsive during long-running Gemini invocations.
- Progress messages are short, sanitized status updates (e.g., "🔍 Gemini analyzing... (still working)").

---

## 9) Reliability, Error Handling, and Observability

### 9.1 .gitignore Pattern Handling

**Issue:** Gemini CLI respects `.gitignore` by default (`fileFiltering.respectGitIgnore: true`), which may prevent analysis of desired files.

**Solution:** The MCP server does NOT modify user configuration. Instead, it provides warnings at three touchpoints:

#### Warning Touchpoint A: `health_check` Diagnostics
When `includeDiagnostics: true`, check if `respectGitIgnore` is enabled:

```json
{
  "diagnostics": {
    "gitIgnoreRespected": true,
    "warnings": [
      "Gemini CLI is configured to respect .gitignore patterns. This may prevent analysis of git-ignored files. To analyze all files, consider setting 'fileFiltering.respectGitIgnore: false' in ~/.gemini/settings.json or using .geminiignore for selective exclusions."
    ]
  }
}
```

#### Warning Touchpoint B: Setup Wizard
During `npx gemini-researcher init`, check user's `~/.gemini/settings.json`:

```bash
[Warning] Your Gemini CLI is configured to respect .gitignore patterns.

This may prevent the MCP server from analyzing git-ignored files like:
  • node_modules/ (if you want to analyze dependencies)
  • dist/ or build/ (if analyzing compiled output)
  • .env files (if reviewing configuration)

Recommendation: Use .geminiignore instead of .gitignore for file exclusions.
See: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-ignore.md

To allow analysis of all files:
  1. Run: gemini
  2. Type: /settings
  3. Set: fileFiltering.respectGitIgnore = false
```

#### Warning Touchpoint C: Tool Errors
If a tool call fails due to ignored files, include troubleshooting in error response:

```json
{
  "error": {
    "code": "GEMINI_CLI_ERROR",
    "message": "Gemini CLI could not access requested files (likely blocked by .gitignore)",
    "details": {
      "stderr": "File path '...' is ignored by configured ignore patterns.",
      "troubleshooting": "Your Gemini CLI respects .gitignore by default. To analyze git-ignored files, disable this setting: gemini → /settings → fileFiltering.respectGitIgnore = false"
    }
  }
}
```

### 9.2 Errors
- Surface Gemini CLI errors as structured error objects.
- Include `stderr` excerpts only when safe (avoid leaking secrets or API keys).
- Map common Gemini CLI errors to user-friendly messages:
  - Quota exceeded → "Gemini API quota exceeded. Retrying with fallback model..."
  - Auth failure → "Gemini CLI authentication failed. Please run 'gemini' and select 'Login with Google', or set GEMINI_API_KEY if using API key authentication."
  - File not found → "File not found: {path}"

### 9.3 Logging
- Structured logs with levels: error/warn/info/debug.
- **NEVER log**: `GEMINI_API_KEY` or any authentication credentials/tokens.
- **DO log**:
  - Tool invocations (tool name, parameters excluding full prompts)
  - Gemini CLI invocation (command args, not output)
  - Errors with sanitized stderr
  - Performance metrics (latency, tokens used)

### 9.4 Startup Validation
On server start, validate:
1. `gemini` is on PATH (`which gemini` or `where gemini` on Windows).
2. Gemini CLI authentication is configured:
   - Check for existing authenticated session (preferred method)
   - Fallback: check for `GEMINI_API_KEY` environment variable
   - Fallback: check for Vertex AI credentials
3. Gemini CLI supports required flags: run `gemini --help` and verify presence of `--output-format json`, `--output-format stream-json`.
4. Read-only policy enforcement prerequisites:
   - bundled policy file exists (`policies/read-only-enforcement.toml`) when strict mode enabled.
   - `gemini --help` includes `--admin-policy` when strict mode enabled.
   - if strict mode is relaxed via `GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY=0|false|no|off`, emit warning.
5. Optionally check if Preview Features are enabled (for Gemini 3 access) - warn if disabled but don't fail.

**Fail fast with actionable messages** if validation fails:
```
❌ Gemini CLI not found on PATH
→ Install: npm install -g @google/gemini-cli
→ Docs: https://github.com/google-gemini/gemini-cli

❌ Gemini CLI authentication not configured
→ Recommended: Run 'gemini' and select "Login with Google"
→ Alternative: Set GEMINI_API_KEY environment variable
   - Get API key: https://aistudio.google.com/app/apikey
   - Set in terminal: export GEMINI_API_KEY="your-key-here"
→ Docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md

✅ All checks passed! Server starting...
```

---

## 10) First-Time Setup Experience

### 10.1 Setup Wizard (`init` command)
Provide a lightweight setup wizard to help first-time users validate their environment.

#### Usage
```bash
npx gemini-researcher init
```

#### Behavior
1. **Check Gemini CLI installation**
   - Run `which gemini` (or `where gemini` on Windows).
   - If not found, display installation instructions.
2. **Check authentication**
   - Check for existing Gemini CLI authenticated session (preferred).
   - Fallback: check for `GEMINI_API_KEY` environment variable.
   - Fallback: check for Vertex AI credentials.
   - If none found, display auth setup options (Login with Google recommended, API key alternative, Vertex AI for enterprise).
   - Show links to Gemini CLI authentication docs.
3. **Test Gemini CLI**
   - Run a minimal test invocation with positional prompt and current safety contract:
     `gemini --output-format json --approval-mode default --admin-policy <path> "test"`
   - If successful, confirm setup is working.
4. **Display next steps**
   - Show how to configure MCP client (Claude Desktop, VS Code).
   - Provide example MCP config snippets.

#### Example Output
```bash
$ npx gemini-researcher init

Gemini Researcher — Setup Wizard
================================

[1/3] Checking Gemini CLI installation...
  ✓ Gemini CLI found at /usr/local/bin/gemini (version 2.1.0)

[2/3] Checking authentication...
  ✓ Authenticated session detected (Login with Google)

[3/3] Testing Gemini CLI...
  ✓ Test invocation successful

Setup Complete! 🎉
==================

Next steps:
1. Configure your MCP client (Claude Desktop, VS Code)
2. Add this server to your MCP config:

   For Claude Desktop (~/.config/Claude/claude_desktop_config.json):
   {
     "mcpServers": {
       "gemini-researcher": {
         "command": "npx",
         "args": ["gemini-researcher"]
       }
     }
   }

3. Restart your MCP client
4. Test with: "Can you list your available tools?"

Documentation: https://github.com/capyBearista/gemini-researcher
```

#### When Setup Fails
```bash
$ npx gemini-researcher init

Gemini Researcher — Setup Wizard
================================

[1/3] Checking Gemini CLI installation...
  ✗ Gemini CLI not found

  Install Gemini CLI:
    npm install -g @google/gemini-cli
  
  Documentation:
    https://github.com/google-gemini/gemini-cli

[2/3] Checking authentication...
  ✗ No authentication configured

  Option 1: Login with Google (Recommended)
    - Run: gemini
    - Select "Login with Google" and follow prompts
    - Your credentials will be cached for future sessions
    - Works seamlessly in headless mode after initial setup

  Option 2: Use Gemini API Key (Alternative for automation)
    - Get API key: https://aistudio.google.com/app/apikey
    - Set in terminal: export GEMINI_API_KEY="your-key-here"
    - Make persistent: Add to ~/.bashrc or ~/.zshrc

  Option 3: Vertex AI (For enterprise users)
    - See: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md#vertex-ai

Please fix the issues above and run 'npx gemini-researcher init' again.
```

### 10.2 Server Startup Without `init`
If a user runs the server directly (`npx gemini-researcher`) without running `init`, the server should:
1. Perform the same validation checks.
2. If validation fails, print a concise error and suggest running `npx gemini-researcher init`.
3. If validation passes, start the MCP server normally.

---

## 11) Packaging & Distribution (v1)

### 11.1 NPX
- `npx gemini-researcher` launches the MCP server over stdio.
- `npx gemini-researcher init` runs the setup wizard.

### 11.2 Global Install
- `npm install -g gemini-researcher`
- Exposes executable entrypoints:
  - `gemini-researcher` (starts server)
  - `gemini-researcher init` (runs setup wizard)

### 11.3 Package.json
```json
{
  "name": "gemini-researcher",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "gemini-researcher": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "zod": "^3.22.0",
    "ignore": "^5.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 11.4 Docker (later)
- Defer to v2.

---

## 12) Success Metrics (v1)

1. **Agent context reduction**: typical workflows do not require pasting files into Claude/Copilot prompts.
2. **Agent model usage reduction**: agents can delegate heavy codebase analysis to Gemini CLI, using minimal tokens in their own context.
3. **Setup simplicity**: users can go from zero to working MCP server in under 5 minutes with `init` wizard.
4. **Safety**: server enforces read-only operations; zero unintended file modifications.
5. **Reliability**: 95%+ success rate on research queries (excluding quota/auth failures).

---

## 13) Milestones

### MVP (v1.0)
- ✅ MCP server over stdio
- ✅ Tools: `quick_query`, `deep_research`, `analyze_directory`, `validate_paths`, `health_check`, `fetch_chunk`
- ✅ Stateless operation (no session files)
- ✅ Read-only enforcement via approval mode + admin policy contract
- ✅ `.gitignore` respect for directory enumeration
- ✅ Setup wizard (`init` command) with validation and friendly errors
- ✅ Progress notifications for long-running operations
- ✅ Structured JSON outputs
- ✅ Quota fallback logic (flash/pro models)
- ✅ Response chunking for large outputs (`fetch_chunk`, cache TTL)
- ✅ Auth confidence states and degraded diagnostics (`configured|unauthenticated|unknown`)
- ✅ Command logging prompt redaction for positional prompt contract

### Post-v1 Enhancements
- ⏭️ Custom allowlist configuration (beyond project root)
- ⏭️ Docker distribution for isolated environments
- ⏭️ Sandbox support (if Gemini CLI sandbox mode proves useful)
- ⏭️ Session support (optional lightweight in-memory context for conversational feel)
- ⏭️ Custom `.gemini-ignore` pattern support
- ⏭️ Advanced directory summarization controls (e.g., grouping by module, architecture diagrams)

---

## 14) Reference Implementation Notes

### 14.1 Tool Registry Pattern (from jamubc reference)
Use the `UnifiedTool` pattern from `jamubc-gemini-mcp-tool` for consistency:

```typescript
export interface UnifiedTool {
  name: string;
  description: string;
  zodSchema: ZodTypeAny;
  execute: (args: ToolArguments, onProgress?: (output: string) => void) => Promise<string>;
  category?: 'query' | 'utility';
}
```

Register all tools in `src/tools/index.ts`:
```typescript
import { toolRegistry } from './registry.js';
import { quickQueryTool } from './quick-query.tool.js';
import { deepResearchTool } from './deep-research.tool.js';
// ... other tools

toolRegistry.push(
  quickQueryTool,
  deepResearchTool,
  analyzeDirectoryTool,
  validatePathsTool,
  healthCheckTool,
  fetchChunkTool
);

export * from './registry.js';
```

### 14.2 Gemini Executor Pattern
Create `src/utils/geminiExecutor.ts` with the following responsibilities:
1. Construct Gemini CLI command with appropriate flags.
2. Spawn child process and capture JSON output.
3. Handle quota errors and retry with fallback model.
4. Parse JSON response and extract relevant fields.
5. Emit progress callbacks for long-running operations.

### 14.3 File Structure (Expected)
```
gemini-researcher/
├── src/
│   ├── index.ts                   # Main MCP server (stdio transport)
│   ├── constants.ts               # Error messages, protocol constants, model names, system prompt
│   ├── tools/
│   │   ├── index.ts               # Tool registry (exports toolRegistry.push(...))
│   │   ├── registry.ts            # UnifiedTool interface, validation, execution
│   │   ├── quick-query.tool.ts    # Quick query tool
│   │   ├── deep-research.tool.ts  # Deep research tool
│   │   ├── analyze-directory.tool.ts
│   │   ├── validate-paths.tool.ts
│   │   ├── health-check.tool.ts
│   │   └── fetch-chunk.tool.ts    # Chunk retrieval tool
│   ├── utils/
│   │   ├── geminiExecutor.ts      # Gemini CLI spawning + fallback logic + system prompt
│   │   ├── responseCache.ts       # LRU cache for chunked responses (1hr TTL)
│   │   ├── responseChunker.ts     # Split large responses into ~10KB chunks
│   │   ├── streamingJsonParser.ts # Parse --output-format stream-json
│   │   ├── pathValidator.ts       # Path resolution, allowlist checks
│   │   ├── ignorePatterns.ts      # .gitignore parsing
│   │   └── logger.ts              # Structured logging
│   ├── setup/
│   │   └── wizard.ts              # Setup wizard (`init` command)
│   └── types.ts                   # Shared TypeScript types
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
├── README.md
└── docs/
    └── project-overview-PRD.md
```

---

## 15) Common Pitfalls to Avoid

1. **Using `.ts` in imports** → Runtime error (Node16 module resolution requires `.js`)
2. **Not enforcing read-only tools** → Security risk; Gemini may modify files
3. **Logging API keys** → Security violation
4. **Returning raw Gemini output without JSON wrapper** → Agents can't parse structured fields
5. **Skipping startup validation** → Cryptic runtime errors when `gemini` missing
6. **Not respecting `.gitignore`** → Sending `node_modules` to Gemini (wasted tokens/time)
7. **Assuming Gemini CLI is installed** → Fail fast with actionable error if missing

---

## Appendix A: Model Selection Reference

| Tool                 | 1st Tier (Default)       | 2nd Tier (Fallback)  | 3rd Tier (Safety)    | Rationale                          |
|----------------------|--------------------------|----------------------|----------------------|------------------------------------|
| `quick_query`        | `gemini-3-flash-preview` | `gemini-2.5-flash`   | Auto-select          | Fast, cost-effective, good quality |
| `deep_research`      | `gemini-3-pro-preview`   | `gemini-2.5-pro`     | Auto-select          | Max context, best reasoning        |
| `analyze_directory`  | `gemini-3-flash-preview` | `gemini-2.5-flash`   | Auto-select          | Speed optimized, sufficient quality|

**Note:** Gemini 3 models require Preview Features enabled in Gemini CLI settings. See local docs in `docs/gemini-cli/`.

---

## Appendix B: Error Code Reference

| Code                    | Meaning                                     | User Action                                    |
|-------------------------|---------------------------------------------|------------------------------------------------|
| `INVALID_ARGUMENT`      | Tool called with invalid parameters         | Check parameter types and required fields      |
| `PATH_NOT_ALLOWED`      | Path is outside project root                | Use paths within project directory             |
| `GEMINI_CLI_NOT_FOUND`  | `gemini` binary not on PATH                 | Install Gemini CLI: `npm install -g @google/gemini-cli` |
| `GEMINI_CLI_ERROR`      | Gemini CLI execution failed                 | Check stderr output for details                |
| `AUTH_MISSING`          | Gemini CLI authentication not configured    | Run `gemini` and select "Login with Google" (recommended), or set `GEMINI_API_KEY` |
| `AUTH_UNKNOWN`          | Auth could not be confirmed (ambiguous probe failure) | Verify CLI/network, confirm interactive `gemini` login, retry |
| `ADMIN_POLICY_MISSING`  | Bundled admin policy file not found         | Reinstall package or restore `policies/read-only-enforcement.toml` |
| `ADMIN_POLICY_UNSUPPORTED` | Gemini CLI lacks `--admin-policy` support | Upgrade Gemini CLI to v0.36.0+ |
| `QUOTA_EXCEEDED`        | Gemini API quota exhausted (after fallback) | Wait for quota reset or upgrade plan           |
| `CACHE_EXPIRED`         | Chunk cache key not found or expired        | Re-run original query to regenerate response   |
| `INVALID_CHUNK_INDEX`   | Requested chunk index out of range          | Check total chunks in original response        |
| `INTERNAL`              | Unexpected server error                     | Check server logs, report issue if persistent  |

---

**End of PRD (Updated January 2026)**
