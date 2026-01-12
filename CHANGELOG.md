# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **Setup Wizard**: `npx better-gemini-mcp init` for guided environment validation
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
