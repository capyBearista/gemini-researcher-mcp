# Gemini Researcher - Product Requirements Document (PRD)

## Document Metadata

- **Document type**: Living specification
- **Status**: Active
- **Primary owner**: Project maintainers
- **Last validated**: 2026-04-09
- **Validated baseline**:
  - npm package line: `1.3.0`
  - Docker-only release line: `1.1.2`

## 1) Executive Summary

### 1.1 Vision

Gemini Researcher is a lightweight, stateless MCP server that lets developer agents delegate heavy repository analysis to Gemini CLI.

The product exists to reduce the calling agent's context pressure and model usage while preserving safe, read-only behavior and structured outputs for downstream automation.

### 1.2 Core Goals (must-haves)

1. Reduce calling-agent context usage by avoiding large inline file pastes.
2. Reduce calling-agent model usage by offloading deep reading and synthesis.
3. Keep setup simple and fail-fast with actionable guidance.
4. Return structured, machine-readable tool responses.
5. Enforce read-only behavior by default.

### 1.3 Non-Goals (explicit exclusions)

- No server-side session management.
- No file mutation, code generation, or patch application.
- No forwarding of interactive terminal UI from Gemini CLI.
- No alternate SDK execution path in v1.
- No server-managed multi-turn continuity.

## 2) Users, Clients, and Use Cases

### 2.1 Supported Clients (v1)

- Claude Code
- VS Code (GitHub Copilot)
- Cursor
- OpenCode

### 2.2 Primary Use Cases

1. Deep multi-file analysis (security, architecture, performance).
2. Fast focused explanation of specific files or flows.
3. Directory structure mapping for unfamiliar repositories.
4. Path preflight validation before expensive analysis.
5. Diagnostics and troubleshooting of runtime/setup status.
6. Retrieval of chunked continuation responses.

## 3) Product Principles

1. Stateless by design: each call is independent.
2. Safety by default: read-only contract is enforced, not implied.
3. Structured outputs: JSON content returned consistently for tool consumers.
4. Fail-closed diagnostics: uncertainty should degrade health, not fake success.
5. Contributor clarity: runtime details have one canonical source.

## 4) System Overview

### 4.1 High-level Architecture

Agent client -> MCP server -> Gemini CLI process -> structured JSON response via MCP text content.

### 4.2 Stateless Operation

- Each request spawns an isolated Gemini CLI process.
- No persistent server session state.
- Continuity must be supplied by the calling agent.

## 5) Functional Requirements

### 5.1 Tool Surface (required)

1. `quick_query`
2. `deep_research`
3. `analyze_directory`
4. `validate_paths`
5. `health_check`
6. `fetch_chunk`

### 5.2 Tool Requirements

#### `quick_query`

- Accepts prompt plus optional focus/response style.
- Optimized for faster turnaround.
- Supports chunked response continuation when needed.

#### `deep_research`

- Accepts prompt plus optional focus/citation mode.
- Optimized for deeper multi-file reasoning.
- Supports chunked response continuation when needed.

#### `analyze_directory`

- Enumerates directory files under project-root constraints.
- Applies ignore rules and configurable traversal limits.
- Returns summarized entry list with metadata.

#### `validate_paths`

- Resolves and validates candidate paths.
- Confirms existence and project-root allowance.
- Returns per-path structured results.

#### `health_check`

- Returns basic service status by default.
- Optionally returns detailed runtime diagnostics.
- Uses explicit status semantics (`ok`, `degraded`, `error`).

#### `fetch_chunk`

- Retrieves continuation chunks from cached responses.
- Enforces chunk index validity and cache TTL behavior.

## 6) Runtime Contract Ownership

This PRD defines product-level requirements. Runtime-level behavior is defined in:

- `docs/runtime-contract.md` (canonical runtime source)

Runtime-level items include:

- Gemini argv contract and approval semantics
- auth classification behavior
- health and startup pass/fail mapping
- logging redaction invariants
- chunking and continuation invariants
- smoke validation expectations

When this PRD and runtime mechanics diverge, `docs/runtime-contract.md` is authoritative for runtime semantics.

## 7) Security and Safety Requirements

1. Server-generated behavior must remain read-only by default.
2. Path access must remain restricted to project-root scope.
3. Credentials/tokens must never be logged.
4. Prompt payloads in command logs must be redacted.
5. Safety regressions must be visible in diagnostics and tests.

## 8) Reliability and Observability Requirements

1. Startup validation must fail fast on missing critical requirements.
2. Auth confidence must use explicit tri-state semantics.
3. Health status must degrade on uncertainty rather than over-report success.
4. Long-running analysis must provide keepalive/progress behavior to prevent client timeouts.
5. Structured error payloads must remain consistent and machine-readable.
6. Runtime probes must classify launch-path failures before capability/auth failures, especially for native Windows shell-less spawn environments.

## 9) Setup and First-Run Experience

### 9.1 Setup Entry Points

- `npx gemini-researcher` starts the server.
- `npx gemini-researcher init` runs setup validation.

### 9.2 Setup Flow Requirement

The setup wizard flow is two-step:

1. `[1/2]` Gemini CLI installation check.
2. `[2/2]` invocation/auth validation check.

If checks fail, output must provide actionable remediation guidance.

## 10) Packaging and Distribution

### 10.1 npm / npx

- Package is published for npx and global install flows.

### 10.2 Docker

- Docker distribution is shipped and documented.
- Multi-platform image support is included.

### 10.3 Native Windows reliability

- Native Windows operation is a first-class target.
- Runtime command launching must handle Windows npm shim behavior robustly.
- Documentation must provide a clear fallback path (Docker/WSL) when host MCP launch semantics are incompatible.

## 11) Success Metrics

1. Typical workflows avoid large manual file pastes into calling agents.
2. Delegated analysis quality works for typical coding workflows.
3. Setup from a clean environment is straightforward.
4. Read-only guarantees hold in runtime behavior.
5. Runtime reliability is high outside quota/auth external failures.

## 12) Roadmap (Post-v1)

Post-v1 planned areas:

- custom allowlist configuration beyond project root
- sandbox mode support if Gemini CLI support proves stable
- optional session support for conversational continuity
- custom `.gemini-ignore` style controls
- advanced directory analysis summarization controls

Already-shipped capabilities are not treated as future roadmap items:

- response chunking + `fetch_chunk`
- Docker distribution
- six-tool surface
- setup wizard

## 13) Requirement-to-Implementation Traceability

This table maps critical requirements to current implementation anchors.

| Requirement | Primary references |
|---|---|
| Six-tool surface | `src/tools/index.ts` |
| Runtime invocation and fallback behavior | `src/utils/geminiExecutor.ts`, `tests/unit/geminiExecutor.test.ts` |
| Read-only policy enforcement | `policies/read-only-enforcement.toml`, `src/utils/geminiExecutor.ts`, `src/tools/health-check.tool.ts` |
| Auth classification and degraded behavior | `src/utils/geminiExecutor.ts`, `src/tools/health-check.tool.ts`, `src/setup/wizard.ts` |
| Logging redaction | `src/utils/logger.ts`, `tests/unit/logger.test.ts` |
| Setup wizard flow and startup validation | `src/setup/wizard.ts`, `src/constants.ts` |
| Response chunking and continuation | `src/utils/responseChunker.ts`, `src/utils/responseCache.ts`, `src/tools/fetch-chunk.tool.ts` |
| Live end-to-end runtime checks | `tests/manual/mcp-live-smoke.mjs` |

## 14) Documentation Governance

### 14.1 Canonical Sources

- Product-level intent and scope: this PRD.
- Runtime contract details: `docs/runtime-contract.md`.
- User onboarding and usage examples: `README.md`.
- Contributor process and invariants: `CONTRIBUTING.md`.

### 14.2 Drift Prevention Rules

When changing executor, safety, auth, health, setup, logging, chunking, or tool contracts:

1. Update `docs/runtime-contract.md` in the same change.
2. Reconcile user-facing summaries in `README.md`.
3. Reconcile contributor invariants in `CONTRIBUTING.md`.
4. Confirm this PRD still reflects shipped capability boundaries.

### 14.3 Public Documentation Constraint

Tracked docs must not depend on local-only planning files or ignored vendor snapshots as canonical product references.

## 15) Acceptance Criteria for Concern 1 Closure

Concern 1 is complete when all of the following are true:

1. This PRD is factually aligned with current shipped behavior.
2. Implemented capabilities are not listed as deferred future work.
3. Runtime semantics are centralized in `docs/runtime-contract.md` and referenced consistently.
4. `README.md`, `CONTRIBUTING.md`, and this PRD are materially consistent.
5. No tracked docs rely on local-only concern planning artifacts.

---

End of PRD (Living Spec)
