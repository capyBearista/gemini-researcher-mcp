# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] - 2026-01-26

### ⚠️ Docker-only release (npm package unchanged at 1.1.1)

This release addresses security vulnerabilities in the Docker image only. If you use the npm package (`npx gemini-researcher`), you are unaffected and do not need to update.

### Security

- Addressed security vulnerabilities in bundled npm packages, as reported by Docker Scout:
  - CVE-2026-23950, CVE-2026-23745 (tar)
  - CVE-2025-64756 (glob)
- Updated bundled npm from 10.9.4 to 11.8.0 (includes patched tar and glob)

### Changed

- **Docker base image**: Switched from `node:22-bookworm-slim` (Debian) to `node:22-alpine`
  - Reduced image size from 257 MB to 213 MB
  - Reduced total packages from 874 to 726
  - Reduced LOW severity CVEs from 48 to 2

### Note

- 5 MEDIUM severity CVEs remain in Alpine base packages (curl, busybox) with no upstream fixes available. These are transitive dependencies in the base image, not in application code.

## [1.1.1] - 2026-01-26

### Added

- **Docker support**: New Dockerfile and `.dockerignore` for containerized deployment.
  - See README for Docker usage instructions.
- Command timeout option for `executeCommand` utility (internal API improvement).
- MCP registry metadata files (`server.json`, `glama.json`) for discoverability.

### Changed

- **Project renamed** from "Better Gemini MCP" to "Gemini Researcher" across all documentation and code.
- Startup logs changed from INFO to DEBUG level for silent MCP server operation by default.
  - Fixes "Server not inspectable" issue on Glama.ai and other MCP registries.
  - Set `DEBUG=true` environment variable to see startup logs for troubleshooting.
- Enhanced type definitions and response structures across tools for better type safety.
- Improved integration tests with Gemini CLI availability checks.
- Reorganized test files into `tests/manual/` directory.
- Documentation cleanup: removed obsolete review documents, updated PRD status values.

### Fixed

- Repository URL format in `package.json`.

### Note

- Version 1.1.0 was skipped due to a failed npm publish.

## [1.0.2] - 2026-01-12

### Added

- `CONTRIBUTING.md` with guidelines for environment setup, development standards, and contribution workflows.
- GitHub Actions workflow for automated publishing to npm.

### Changed

- Enhanced setup wizard authentication checks to verify API keys, Vertex AI credentials, or cached CLI sessions.
- Comprehensive update to `README.md` for improved clarity, updated tool descriptions, and streamlined configuration instructions.
- Improved documentation links and setup completion messages in the wizard.

### Fixed

- Synchronized internal version constant in `constants.ts` with `package.json`.
- Resolved GitHub Actions test failures, adding tsx

## [1.0.1] - 2026-01-10

### Changed

- Upgrade `@modelcontextprotocol/sdk` to version 1.25.2.

### Fixed

- Tool definitions handling in `registry.ts` to ensure compatibility with modern MCP SDK by refining type coercion for properties and simplifying required fields extraction.

### Removed

- Unused `notifications` capability from server configuration in `index.ts`.

## [1.0.0] - 2026-01-08

### Added

- **Core MCP Server**: Stateless MCP server with stdio transport for Claude Code and VS Code Copilot integration
- **6 MCP Tools**:
  - `quick_query`: Fast analysis using Gemini flash models
  - `deep_research`: In-depth analysis using Gemini pro models
  - `analyze_directory`: Directory structure summarization with ignore patterns
  - `validate_paths`: Preflight path validation for security
  - `health_check`: Server and Gemini CLI diagnostics
  - `fetch_chunk`: Retrieve chunked response segments for large outputs
- **3-Tier Model Fallback**: Automatic fallback from Gemini 3 → Gemini 2.5 → auto-select on quota errors
- **Response Chunking**: Automatic chunking of responses exceeding 10KB with cache-based retrieval
- **Path Security**: Project root restriction, directory traversal prevention, `@path` validation
- **Ignore Patterns**: Respects `.gitignore` plus hard-coded exclusions (node_modules, .git, dist, etc.)
- **Setup Wizard**: `npx gemini-researcher init` for guided environment validation
- **Progress Notifications**: Keepalive updates every 25 seconds for long-running operations
- **Structured JSON Responses**: All tools return parseable JSON with consistent error format

### Security

- Read-only enforcement: Gemini CLI invoked without `--yolo` flag
- System prompt enforces read-only analysis constraints
- Path validation prevents access outside project root
- API keys never logged

### Technical

- TypeScript with strict mode, ES2022 target
- Node.js 18+ with ES Modules
- Zod schemas for input validation
- 1-hour TTL cache for chunked responses

### Documentation

- Comprehensive README with installation, configuration, and usage
- Product Requirements Document (PRD)

---

## [Unreleased]

### Planned for Future Releases?

- Docker distribution
- Custom allowlist configuration
- Sandbox mode support
- Session support for multi-turn conversations
- Custom `.geminiignore` pattern files
