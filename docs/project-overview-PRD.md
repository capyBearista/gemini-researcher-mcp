# "Better Gemini MCP" — Gemini CLI Proxy MCP Server — Product Requirements Document (PRD)

## 1) Executive Summary

### 1.1 Vision
Build a local, headless MCP server that acts as a “heavy-lifting research proxy” for developer agents (Claude Code and GitHub Copilot in VS Code), leveraging the large context window of **Gemini CLI** to analyze large local codebases and documents without consuming the calling agent’s context window.

### 1.2 Core Goals (must-haves)
1. **Reduce calling-agent context usage**: the agent should not need to paste large files or keep long research history in its own context.
2. **Reduce calling-agent model usage**: move “deep reading and synthesis” workload into Gemini CLI, keeping the calling agent’s participation minimal.
3. **Support multi-turn deep research via session-by-file**: maintain conversation history in a server-managed context file, keyed by a server-issued `sessionId`.
4. **Run headlessly via MCP request/response**: no interactive TTY; optional progress notifications only.

### 1.3 Non-Goals (explicit exclusions)
- **Code generation or patch application**: the server must not generate/apply code changes, scaffolds, or patches to the repo.
- **Streaming raw terminal UI**: no forwarding of Gemini CLI TTY UI; only structured tool results.
- **Google Gemini Node SDK**: do not use the SDK; invoke the `gemini` binary directly.
- **Sandboxing (v1)**: do not implement `--sandbox` in v1 (may be revisited later).
- **Docker distribution (v1)**: focus on `npx` runnable MCP server and global install; Docker can come later.

---

## 2) Users, Clients, and Primary Use Cases

### 2.1 Supported Clients (v1)
- **Claude Code** (MUST)
- **VS Code (GitHub Copilot)** (MUST)

### 2.2 Primary Use Cases
1. **Deep codebase analysis**
   - “Analyze authentication flow across @src/auth and explain failure modes.”
2. **Targeted research thread**
   - Multi-turn Q&A where the agent keeps only a `sessionId` and asks follow-ups.
3. **Directory mapping**
   - “Summarize what’s inside @src and what each module is responsible for.”

---

## 3) Product Principles

1. **Session-by-file is the core differentiator**
   - The server owns the conversation state and stores it in a context file.
2. **Structured responses for agents**
   - Tool responses return machine-readable JSON fields (delivered as a JSON string inside MCP `text` content for compatibility).
3. **Safety by default**
   - Restrict file access to project root (server start directory) plus an explicit allowlist.
4. **High-concurrency, long-running friendly**
   - No server-enforced timeout; provide optional progress notifications to keep clients alive.

---

## 4) System Overview

### 4.1 High-level Architecture
**Agent (Claude Code / Copilot)** → **MCP Server** → spawns **Gemini CLI** → reads project files via `@path` → server returns synthesized output.

### 4.2 “Session-by-File” Pattern
Each session has a server-managed markdown context file. The server appends:
- user prompts
- Gemini responses

This file is included in each invocation so Gemini “remembers” prior turns without burdening the calling agent.

---

## 5) Functional Requirements

### 5.1 Tool Surface Area (v1)
Ship the following MCP tools (v1):
1. `quick_query` (lighter tasks; flash model by default)
2. `deep_research` (heavier tasks; pro model by default)
3. `analyze_directory`
4. `reset_session`
5. `health_check`
6. `gemini_help` (optional; see tool description)

Also ship these additional utility tools (recommended for v1 due to concurrency + multi-agent usage):
- `list_sessions`
- `get_session_info`
- `fetch_result_chunk`
- `validate_paths`

### 5.2 Tool: `quick_query`

#### Purpose
Send a lightweight research prompt to Gemini CLI, with conversation continuity via session-by-file.

This tool is optimized for faster turnaround and lower cost.

#### Input Schema (conceptual)
```json
{
  "prompt": "string",
  "sessionId": "string (optional)",
  "focus": "security|architecture|performance|general|<custom> (optional)",
  "maxOutputTokens": "number (optional; best-effort)",
  "responseStyle": "concise|normal|detailed (optional)"
}
```

#### Behavior
1. **Session selection / creation**
   - If `sessionId` is missing: create a new session and context file; generate a cryptographically-strong `sessionId`.
   - If `sessionId` is provided: load that session’s context file.
2. **Access control validation**
   - Pre-validate any `@path` references in `prompt` to ensure they resolve inside the project root or configured allowlist.
   - Reject attempts to access `..` traversal or absolute paths outside allowed roots.
3. **Context update**
   - Append the user prompt to the context file with a stable delimiter format.
4. **Gemini invocation**
   - Execute Gemini CLI in headless mode with auto-approval of file reads.
   - Include the session context file via `@` (e.g., “Read @<contextFile> then answer the new prompt”).
  - **Model selection is owned by the MCP server**:
    - Default model: `gemini-3-flash-preview`
    - Fallback model (quota/availability): `gemini-2.5-flash`
5. **History update**
   - Append Gemini’s response to the context file.
6. **Return response**
   - Return a **JSON object** (as a JSON string in MCP text content).

#### Output Contract (returned as JSON string)
```json
{
  "sessionId": "ses_...",
  "didCreateSession": true,
  "model": "gemini-3-flash-preview",
  "tool": "quick_query",
  "focus": "architecture",
  "responseStyle": "concise",
  "answer": "string",
  "chunks": {
    "cacheKey": "string (present only when chunked)",
    "total": "number (present only when chunked)"
  },
  "meta": {
    "projectRoot": "string",
    "contextFile": "string (relative path)",
    "warnings": ["string"]
  }
}
```

#### Error Contract
Errors must be both:
- `CallToolResult.isError = true` (MCP-level)
- a JSON error object in the text payload

```json
{
  "sessionId": "ses_... (if known)",
  "error": {
    "code": "INVALID_ARGUMENT|PATH_NOT_ALLOWED|GEMINI_CLI_NOT_FOUND|GEMINI_CLI_ERROR|AUTH_MISSING|INTERNAL",
    "message": "string",
    "details": { "any": "json" }
  }
}
```

---

### 5.3 Tool: `deep_research`

#### Purpose
Send a heavyweight research prompt to Gemini CLI, with conversation continuity via session-by-file.

This tool is optimized for deeper reasoning across many files and longer research threads.

#### Input Schema (conceptual)
```json
{
  "prompt": "string",
  "sessionId": "string (optional)",
  "focus": "security|architecture|performance|general|<custom> (optional)",
  "citationMode": "none|paths_only (optional; default: none)"
}
```

#### Behavior
Same as `quick_query`, with different **server-owned model selection**:
- Default model: `gemini-3-pro-preview`
- Fallback model (quota/availability): `gemini-2.5-flash`

If `citationMode` is `paths_only`, instruct Gemini to include a “Files referenced” section listing file paths (no line numbers required).

#### Output Contract (returned as JSON string)
```json
{
  "sessionId": "ses_...",
  "didCreateSession": false,
  "model": "gemini-3-pro-preview",
  "tool": "deep_research",
  "focus": "security",
  "citationMode": "paths_only",
  "answer": "string",
  "chunks": {
    "cacheKey": "string (present only when chunked)",
    "total": "number (present only when chunked)"
  },
  "meta": {
    "projectRoot": "string",
    "contextFile": "string (relative path)",
    "warnings": ["string"]
  }
}
```

---

### 5.4 Tool: `analyze_directory`

#### Purpose
Provide a high-level map of a directory while respecting ignore rules and project-root restrictions.

#### Input Schema (conceptual)
```json
{
  "path": "string",
  "sessionId": "string (optional)",
  "depth": "number (optional)",
  "maxFiles": "number (optional)"
}
```

#### Behavior
1. If `sessionId` is missing: create a new session (same rules as `quick_query`).
2. Resolve `path` relative to project root.
3. Enumerate files under `path` **server-side** using ignore rules (see §7).
  - Default behavior: traverse recursively to the deepest level.
  - `depth` limits traversal depth when provided.
  - `maxFiles` limits how many files are enumerated when provided; if omitted, the server applies a configurable safety cap.
4. Construct a Gemini prompt that:
   - provides the file list
   - instructs Gemini to summarize responsibilities
   - allows Gemini to open files from the list using `@relative/path` if needed
   - forbids reading outside the listed paths
5. Append request and response to the session context file.

#### Output Contract (returned as JSON string)
```json
{
  "sessionId": "ses_...",
  "didCreateSession": false,
  "directory": "./src",
  "entries": [
    { "path": "src/index.ts", "summary": "1 sentence" }
  ],
  "meta": {
    "excluded": ["node_modules", ".git"],
    "fileCount": 123,
    "warnings": ["string"]
  }
}
```

---

### 5.5 Tool: `reset_session`

#### Purpose
Explicitly end a research thread by clearing (or deleting) its context file.

#### Input Schema (conceptual)
```json
{
  "sessionId": "string"
}
```

#### Behavior
- Requires `sessionId`.
- Deletes or truncates the session context file.
- Removes session from in-memory session registry.

#### Output Contract
```json
{
  "sessionId": "ses_...",
  "status": "cleared"
}
```

---

### 5.6 Tool: `health_check`

#### Purpose
Confirm the MCP server is running and able to service requests.

#### Input Schema (conceptual)
```json
{
  "includeDiagnostics": "boolean (optional; default false)"
}
```

#### Output Contract
```json
{
  "status": "ok",
  "server": {
    "name": "string",
    "version": "string"
  },
  "diagnostics": {
    "projectRoot": "string",
    "geminiOnPath": "boolean",
    "geminiVersion": "string (optional)",
    "sessionsActive": "number (optional)"
  }
}
```

---

### 5.7 Tool: `gemini_help` (optional)

#### Purpose
Provide a tailored, agent-friendly help response:
- the minimal Gemini CLI flags relevant to this server (headless usage, output format, auto-approve)
- plus a short “how to use this MCP server” reminder (tools and when to use which)

This tool may be removed if it proves redundant in practice.

#### Input Schema (conceptual)
```json
{
  "topic": "string (optional)"
}
```

#### Output Contract
```json
{
  "topic": "string",
  "help": "string"
}
```

---

### 5.8 Tool: `list_sessions`

#### Purpose
List active sessions and metadata to support multi-agent workflows and cleanup.

#### Input Schema (conceptual)
```json
{
  "limit": "number (optional)",
  "includeExpired": "boolean (optional; default false)"
}
```

#### Output Contract
```json
{
  "sessions": [
    {
      "sessionId": "ses_...",
      "lastActive": "number (ms since epoch)",
      "contextFile": "string (relative path)",
      "sizeBytes": "number"
    }
  ]
}
```

---

### 5.9 Tool: `get_session_info`

#### Purpose
Return detailed session metadata (for debugging, UX, and cleanup decisions).

#### Input Schema (conceptual)
```json
{
  "sessionId": "string (required)"
}
```

#### Output Contract
```json
{
  "sessionId": "ses_...",
  "contextFile": "string (relative path)",
  "lastActive": "number (ms since epoch)",
  "sizeBytes": "number",
  "turnCount": "number (optional; best-effort)
}
```

---

### 5.10 Tool: `fetch_result_chunk`

#### Purpose
Fetch a specific chunk of a previously chunked result to keep agent context small.

#### Input Schema (conceptual)
```json
{
  "cacheKey": "string (required)",
  "chunkIndex": "number (required; 1-based)"
}
```

#### Output Contract
```json
{
  "cacheKey": "string",
  "chunkIndex": "number",
  "total": "number",
  "content": "string"
}
```

---

### 5.11 Tool: `validate_paths`

#### Purpose
Preflight check for `@path` references (existence + within project root/allowlist) so agents can correct quickly.

#### Input Schema (conceptual)
```json
{
  "paths": ["string"]
}
```

#### Output Contract
```json
{
  "results": [
    {
      "input": "string",
      "resolved": "string",
      "exists": "boolean",
      "allowed": "boolean",
      "reason": "string (optional)"
    }
  ]
}
```

---

## 6) Session Management Engine

### 6.1 Session Creation
- Sessions are created on-demand when `sessionId` is omitted.
- The server returns the new `sessionId` in the first response.

### 6.2 Session Storage
- Store session files **inside project root** under a hidden directory:
  - `./.better-gemini-mcp/sessions/<sessionId>.md`
- Rationale: maintains the “project-root only” restriction while still allowing Gemini to read the session file.

### 6.3 Concurrency & Consistency
- Support concurrent requests across sessions.
- Prevent context corruption by serializing writes **per sessionId** using an in-process mutex/queue.

### 6.4 Cleanup / Expiration
- Maintain `lastActive` in memory for each session.
- Background cleanup job deletes sessions idle beyond `SESSION_TTL_MS` (configurable).

### 6.5 Context Growth Management
If the context file exceeds a configurable threshold (bytes):
- summarize older turns into a compact “Session Summary” block, then truncate raw history; OR
- truncate oldest turns while preserving the most recent N turns.

(Exact policy and thresholds are configuration-driven; default values selected during implementation.)

---

## 7) Filesystem Scope, Allowlist, and Ignore Rules

### 7.1 Project Root Restriction
- Default allowed root is the server start directory (`process.cwd()` at startup).
- Reject reads outside project root.

### 7.2 Allowlist
- Provide a config `ALLOWED_PATHS` (array) to allow additional roots if needed.

### 7.3 Prompt `@path` Pre-Validation
- Parse prompts for `@...` tokens that appear to be file/directory paths.
- For each referenced path:
  - resolve to absolute
  - ensure it is within allowed roots
  - otherwise return `PATH_NOT_ALLOWED`

### 7.4 Ignore Patterns (directory analysis)
For `analyze_directory` file enumeration, ignore:
- `.git/`
- `node_modules/`
- `dist/`, `build/`, `out/`, `.next/`, `coverage/`
- `.venv/`, `venv/`, `__pycache__/`

Also respect:
- `.gitignore` rules (recommended)
- optional `.gemini-ignore` (project-specific overrides)

---

## 8) Gemini CLI Integration Requirements (source of truth: bundled Gemini CLI docs)

### 8.1 Installation Requirement
- Gemini CLI must be installed via:
  - `npm install -g @google/gemini-cli`

### 8.2 Headless Invocation
- Use headless mode with `--prompt` / `-p`.
- Use `-y` to auto-approve file reads.
- Prefer `--output-format json` for robust parsing.

### 8.3 Model Selection
- Model selection is **not configurable by the calling agent**.
- The MCP server selects models based on the tool:
  - `quick_query`: default `gemini-3-flash-preview`, fallback `gemini-2.5-flash`
  - `deep_research`: default `gemini-3-pro-preview`, fallback `gemini-2.5-flash`
- Quota/availability fallback behavior: if the default model is unavailable or quota-exhausted, retry once with the fallback model.

### 8.4 Read-Only Prompting
Every prompt sent to Gemini must include a stable “read-only” instruction block:
- Do not modify files.
- Do not propose patches.
- Do not instruct the server to run commands.
- Focus on analysis and explanation.

---

## 9) MCP Protocol Requirements

### 9.1 Compatibility
- Implement MCP `tools/list` and `tools/call`.
- Support progress notifications using the standard `_meta.progressToken` pattern (client-driven).

### 9.2 Keepalive / Progress
- No server-side timeout.
- If a client provides a progress token, emit periodic progress notifications (e.g., every ~25s) to keep clients responsive.
- Do not stream raw terminal output; progress messages may include short, sanitized status summaries.

---

## 10) Reliability, Error Handling, and Observability

### 10.1 Errors
- Surface Gemini CLI errors as structured error objects.
- Include `stderr` excerpts only when safe (avoid leaking secrets).

### 10.2 Logging
- Structured logs with levels: error/warn/info/debug.
- Never log `GEMINI_API_KEY`.

### 10.3 Startup Validation
On server start:
- verify `gemini` is on PATH
- verify required env vars (at minimum `GEMINI_API_KEY`) exist
- verify Gemini CLI supports required flags (`-y`, `--output-format json`)

Fail fast with actionable messages.

---

## 11) Packaging & Distribution (v1)

### 11.1 NPX
- `npx -y <package>` launches the MCP server over stdio.

### 11.2 Global Install
- `npm install -g <package>`
- exposes an executable entrypoint (e.g., `better-gemini-mcp`).

### 11.3 Docker (later)
- Defer to v2.

---

## 12) Success Metrics (v1)

1. **Agent context reduction**: typical workflows do not require pasting files into Claude/Copilot.
2. **Agent model usage reduction**: repeated deep research over the same codebase uses minimal additional agent tokens.
3. **Correctness of session continuity**: follow-up questions reliably reflect prior session history.
4. **Safety**: server blocks out-of-root reads by default.

---

## 13) Milestones

### MVP (v1)
- MCP server over stdio
- `quick_query`, `deep_research`, `analyze_directory`, `reset_session`
- `health_check`
- (optional) `gemini_help`
- `list_sessions`, `get_session_info`, `fetch_result_chunk`, `validate_paths`
- session-by-file with server-issued sessionId on first call
- project-root restriction + allowlist
- ignore patterns for directory enumeration
- long-running keepalive progress notifications

### Post-v1
- Docker distribution
- sandbox support
- richer directory summarization controls
- more advanced session summarization policies
