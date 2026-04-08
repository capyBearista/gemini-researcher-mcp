# Gemini Researcher Runtime Contract

## Document Status

- **Role**: Canonical source for runtime behavior and safety invariants
- **Status**: Living specification (normative)
- **Audience**: Maintainers and contributors
- **Last validated**: 2026-04-08 against current `main`

## Scope and Precedence

This document defines the production runtime contract for Gemini Researcher. If this document conflicts with
`docs/project-overview-PRD.md`, `README.md`, or `CONTRIBUTING.md`, this document is authoritative for runtime
semantics.

The PRD is the product-level spec. This file is the execution-level contract.

## 1) Invocation Contract (Canonical)

All server-generated Gemini invocations for query tools follow this pattern:

```bash
gemini [ -m <model> ] --output-format json --approval-mode default [--admin-policy <path>] -p "<prompt>"
```

Required invariants:

1. `--output-format json` is always present.
2. `--approval-mode default` is always present.
3. `--admin-policy <path>` is present when strict enforcement is enabled.
4. `-p "<prompt>"` is used for non-interactive headless execution.
5. `-y` and `--yolo` are never used in server-generated argv.

## 2) Model Selection and Fallback

Model selection is server-owned and tool-specific.

| Tool | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| `quick_query` | `gemini-3-flash-preview` | `gemini-2.5-flash` | auto-select (omit `-m`) |
| `deep_research` | `gemini-3-pro-preview` | `gemini-2.5-pro` | auto-select (omit `-m`) |
| `analyze_directory` | `gemini-3-flash-preview` | `gemini-2.5-flash` | auto-select (omit `-m`) |

Fallback trigger:

- Retry to the next tier only for quota/capacity style failures.
- Non-quota failures fail fast and return structured errors.

## 3) Read-Only Enforcement

Read-only safety is contract-enforced, not best-effort.

Strict mode behavior:

1. Use `--approval-mode default`.
2. Use `--admin-policy <path>` by default.
3. Policy file: `policies/read-only-enforcement.toml`.
4. Policy denies mutating tools by canonical names (currently includes `run_shell_command`, `replace`, `write_file`, `ask_user`).

Strict mode toggle:

- Env var: `GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY`
- Disabled only for values: `0`, `false`, `no`, `off` (case-insensitive)

When strict mode is disabled, startup and diagnostics must report this as a weakened safety posture.

## 4) Auth Classification Contract

Auth state is tri-state and fail-closed:

| `authStatus` | Meaning | Behavior |
|---|---|---|
| `configured` | Authentication confirmed | normal operation allowed |
| `unauthenticated` | Explicit auth failure | setup/startup fail; health degraded |
| `unknown` | Probe failed ambiguously | setup/startup fail-closed; health degraded |

Classification rules:

- Auth-related errors are matched by keywords such as `auth`, `login`, `credential`, `unauthenticated`, and `permission denied`.
- Ambiguous failures are never treated as configured.

## 5) Health Check Contract

`health_check` supports basic and diagnostic modes.

Status rules:

- `ok` only when Gemini is available, required output formats are supported, auth is configured, and strict read-only enforcement is satisfied (or intentionally relaxed).
- `degraded` for missing/uncertain auth, missing policy prerequisites, unsupported capability requirements, or other setup uncertainty.

Required diagnostics fields:

- `projectRoot`
- `geminiOnPath`
- `geminiVersion` (when available)
- `authConfigured`
- `authStatus`
- `readOnlyModeEnforced`
- `warnings` (when applicable)

## 6) Startup and Setup Contract

Startup validation must fail fast when critical requirements are missing:

1. Gemini CLI installed and on `PATH`.
2. Required output formats supported by installed CLI: `json` and `stream-json`.
3. Auth is `configured` (not `unknown`).
4. Strict mode prerequisites pass when strict enforcement is enabled (policy file exists and `--admin-policy` is supported).

Setup wizard contract:

- Two-step flow (not three-step):
  - `[1/2]` Gemini CLI installation check
  - `[2/2]` invocation/auth check

## 7) Logging Redaction Contract

Command logging must not expose prompts or secrets.

Invariants:

1. Prompt payload after `-p/--prompt` is fully redacted.
2. Positional prompt fragments are redacted.
3. Unknown flag values are redacted unless explicitly safe-listed.
4. Credentials/tokens (including API keys and bearer tokens) are sanitized in logs.

## 8) Tool Output and Chunking Contract

Output shape:

- Tool responses are JSON serialized into MCP text content.
- Errors are structured JSON with stable error codes.

Chunking behavior:

- Query tool responses are chunked when response size exceeds configured threshold (`RESPONSE_CHUNK_SIZE_KB`).
- First response includes `chunks` metadata (`cacheKey`, `current`, `total`).
- Continuation is retrieved through `fetch_chunk`.
- Cache TTL is 1 hour.

## 9) Runtime Validation Harness

Manual runtime source of truth:

- `tests/manual/mcp-live-smoke.mjs`

Profiles:

- `fast`: core checks
- `heavy`: includes deep research chunking, continuation retrieval, and directory analysis

Expected behavior:

- Hard-fail on first failed check.
- Produce sign-off matrix with PASS/FAIL status.

## 10) Docs Synchronization Rules

When changing runtime semantics in any of these areas, update this document in the same change:

- CLI argument construction and fallback strategy
- read-only enforcement and policy behavior
- auth classification behavior
- health/status mapping semantics
- setup wizard and startup validation behavior
- logging redaction behavior
- response chunking/continuation behavior

Then reconcile summaries in:

- `docs/project-overview-PRD.md`
- `README.md`
- `CONTRIBUTING.md`