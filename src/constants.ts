/**
 * Constants for Gemini Researcher Server
 * Error codes, model configurations, system prompt, and protocol constants
 */

// ============================================================================
// Logging
// ============================================================================

export const LOG_PREFIX = "[BGMCP]";

// ============================================================================
// Error Codes
// ============================================================================

export const ERROR_CODES = {
  /** Tool called with invalid parameters */
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  /** Path is outside project root */
  PATH_NOT_ALLOWED: "PATH_NOT_ALLOWED",
  /** gemini binary not on PATH */
  GEMINI_CLI_NOT_FOUND: "GEMINI_CLI_NOT_FOUND",
  /** Gemini CLI execution failed */
  GEMINI_CLI_ERROR: "GEMINI_CLI_ERROR",
  /** Gemini CLI authentication not configured */
  AUTH_MISSING: "AUTH_MISSING",
  /** Gemini API quota exhausted (after fallback) */
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  /** Chunk cache key not found or expired */
  CACHE_EXPIRED: "CACHE_EXPIRED",
  /** Requested chunk index out of range */
  INVALID_CHUNK_INDEX: "INVALID_CHUNK_INDEX",
  /** Unexpected server error */
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  QUOTA_EXCEEDED: "Quota exceeded for quota metric",
  QUOTA_EXCEEDED_SHORT: "⚠️ Gemini API quota exceeded. Falling back to alternative model...",
  TOOL_NOT_FOUND: "not found in registry",
  NO_PROMPT_PROVIDED: "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@src/auth.ts explain what this does') or ask general questions",
  GEMINI_CLI_NOT_FOUND: "Gemini CLI not found on PATH. Install with: npm install -g @google/gemini-cli",
  AUTH_MISSING: "Gemini CLI authentication not configured. Run 'gemini' and select 'Login with Google', or set GEMINI_API_KEY environment variable.",
  AUTH_UNKNOWN:
    "Gemini CLI authentication could not be confirmed due to an ambiguous probe failure. Check network/CLI health and run 'gemini' to verify login.",
  ADMIN_POLICY_MISSING:
    "Gemini CLI read-only admin policy not found. Reinstall package or verify policies/read-only-enforcement.toml exists.",
  ADMIN_POLICY_UNSUPPORTED:
    "Gemini CLI version does not support --admin-policy. Upgrade to Gemini CLI v0.36.0 or newer.",
  OUTPUT_FORMAT_UNSUPPORTED:
    "Gemini CLI version does not support required --output-format values (json, stream-json). Upgrade Gemini CLI.",
  PATH_NOT_ALLOWED: "Path is outside project root",
  CACHE_EXPIRED: "Cache key not found or expired. Re-run original query to regenerate response.",
  INVALID_CHUNK_INDEX: "Requested chunk index out of range",
} as const;

// ============================================================================
// Status Messages
// ============================================================================

export const STATUS_MESSAGES = {
  QUOTA_SWITCHING: "🚫 Primary model quota exceeded, switching to fallback model...",
  FALLBACK_RETRY: "⚡ Retrying with fallback model...",
  FALLBACK_SUCCESS: "✅ Fallback model completed successfully",
  AUTO_SELECT_RETRY: "🔄 Retrying with auto-selected model...",
  PROCESSING_START: "🔍 Starting analysis (may take 5-15 minutes for large codebases)",
  PROCESSING_CONTINUE: "⏳ Still processing... Gemini is working on your request",
  PROCESSING_COMPLETE: "✅ Analysis completed successfully",
} as const;

// ============================================================================
// Model Configuration
// ============================================================================

export const MODELS = {
  // Tier 1: Default models (Gemini 3 - requires Preview Features)
  FLASH_DEFAULT: "gemini-3-flash-preview",
  PRO_DEFAULT: "gemini-3-pro-preview",

  // Tier 2: Fallback models (Gemini 2.5)
  FLASH_FALLBACK: "gemini-2.5-flash",
  PRO_FALLBACK: "gemini-2.5-pro",

  // Tier 3: Auto-select (no -m flag, let Gemini CLI choose)
  AUTO_SELECT: null,
} as const;

/**
 * Model selection configuration per tool
 */
export const MODEL_TIERS = {
  quick_query: {
    tier1: MODELS.FLASH_DEFAULT,
    tier2: MODELS.FLASH_FALLBACK,
    tier3: MODELS.AUTO_SELECT,
  },
  deep_research: {
    tier1: MODELS.PRO_DEFAULT,
    tier2: MODELS.PRO_FALLBACK,
    tier3: MODELS.AUTO_SELECT,
  },
  analyze_directory: {
    tier1: MODELS.FLASH_DEFAULT,
    tier2: MODELS.FLASH_FALLBACK,
    tier3: MODELS.AUTO_SELECT,
  },
} as const;

// ============================================================================
// MCP Protocol Constants
// ============================================================================

export const PROTOCOL = {
  // Message roles
  ROLES: {
    USER: "user",
    ASSISTANT: "assistant",
  },
  // Content types
  CONTENT_TYPES: {
    TEXT: "text",
  },
  // Status codes
  STATUS: {
    SUCCESS: "success",
    ERROR: "error",
    FAILED: "failed",
  },
  // Notification methods
  NOTIFICATIONS: {
    PROGRESS: "notifications/progress",
  },
  // Timeout prevention - keep client alive with periodic updates
  KEEPALIVE_INTERVAL: 25000, // 25 seconds
} as const;

// ============================================================================
// CLI Constants
// ============================================================================

export const CLI = {
  // Command names
  COMMANDS: {
    GEMINI: "gemini",
    WHICH: "which",
    WHERE: "where", // Windows
  },
  // Command flags
  FLAGS: {
    MODEL: "-m",
    PROMPT: "-p",
    APPROVAL_MODE: "--approval-mode",
    ADMIN_POLICY: "--admin-policy",
    OUTPUT_FORMAT: "--output-format",
    VERSION: "--version",
    HELP: "--help",
  },
  // Approval modes
  APPROVAL_MODES: {
    DEFAULT: "default",
  },
  // Output formats
  OUTPUT_FORMATS: {
    JSON: "json",
    STREAM_JSON: "stream-json",
  },
} as const;

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULTS = {
  /** Maximum files to enumerate in analyze_directory */
  MAX_FILES: 500,
  /** Response chunk size in KB (for chunking large responses) */
  RESPONSE_CHUNK_SIZE_KB: 10,
  /** Cache TTL in milliseconds (1 hour) */
  CACHE_TTL_MS: 3600000,
  /** Maximum response size before truncation (50KB) */
  MAX_RESPONSE_SIZE: 50 * 1024,
} as const;

// ============================================================================
// Ignore Patterns (for analyze_directory)
// ============================================================================

export const DEFAULT_IGNORE_PATTERNS = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  "coverage/",
  ".venv/",
  "venv/",
  "__pycache__/",
] as const;

// ============================================================================
// System Prompt
// ============================================================================

export const SYSTEM_PROMPT = `
You are analyzing a codebase on behalf of an AI coding agent.

WHEN TO USE THIS TOOL:
- The calling agent should use MCP tools (quick_query, deep_research, analyze_directory) FIRST when questions involve repository files or code analysis
- This reduces the calling agent's context and model usage by offloading heavy reading/analysis to Gemini CLI's large context window
- Prefer using tools over asking the agent to read files directly

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

// ============================================================================
// Server Info
// ============================================================================

export const SERVER_INFO = {
  NAME: "gemini-researcher",
  VERSION: "1.2.2",
  DESCRIPTION: "Stateless MCP server that proxies research queries to Gemini CLI",
} as const;

// ============================================================================
// Setup Wizard Messages
// ============================================================================

export const WIZARD_MESSAGES = {
  HEADER: `
Gemini Researcher — Setup Wizard
================================
`,
  SUCCESS_HEADER: `
Setup Complete! 🎉
==================
`,
  STEP_GEMINI_INSTALL: "[1/2] Checking Gemini CLI installation...",
  STEP_TEST: "[2/2] Testing Gemini CLI...",

  GEMINI_FOUND: (path: string, version: string) => `  ✓ Gemini CLI found at ${path} (version ${version})`,
  GEMINI_NOT_FOUND: `  ✗ Gemini CLI not found

  Install Gemini CLI:
    npm install -g @google/gemini-cli

  Documentation:
    https://github.com/google-gemini/gemini-cli`,

  AUTH_NOT_FOUND: `  ✗ No authentication configured

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
    - See: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md#vertex-ai`,

  TEST_SUCCESS: "  ✓ Test invocation successful",
  TEST_FAILED: (error: string) => `  ✗ Test invocation failed: ${error}`,

  NEXT_STEPS: `
Next steps:
1. Configure your MCP client (Claude Desktop, VS Code, Cursor, etc.)
2. See the README for detailed configuration instructions
3. Restart your MCP client
4. Test with: "Can you list your available tools?"

Documentation: https://github.com/capyBearista/gemini-researcher-mcp
`,

  FIX_ISSUES: `
Please fix the issues above and run 'npx gemini-researcher init' again.
`,

  // Startup validation messages
  STARTUP_SUCCESS: "✅ All checks passed! Server starting...",
  STARTUP_GEMINI_NOT_FOUND: `❌ Gemini CLI not found on PATH
→ Install: npm install -g @google/gemini-cli
→ Docs: https://github.com/google-gemini/gemini-cli
→ Run 'npx gemini-researcher init' for guided setup`,
  STARTUP_AUTH_MISSING: `❌ Gemini CLI authentication not configured
→ Recommended: Run 'gemini' and select "Login with Google"
→ Alternative: Set GEMINI_API_KEY environment variable
   - Get API key: https://aistudio.google.com/app/apikey
   - Set in terminal: export GEMINI_API_KEY="your-key-here"
→ Run 'npx gemini-researcher init' for guided setup`,
  STARTUP_AUTH_UNKNOWN: `❌ Gemini CLI authentication status is unknown
→ Authentication could not be confirmed due to an ambiguous probe failure
→ Verify network and CLI health, then run 'gemini' and ensure login succeeds
→ Retry startup or run 'npx gemini-researcher init' for guided setup`,
  STARTUP_ADMIN_POLICY_MISSING: `❌ Gemini Researcher read-only policy missing
→ Expected file: policies/read-only-enforcement.toml
→ Reinstall package and retry
→ Run 'npx gemini-researcher init' for guided setup`,
  STARTUP_ADMIN_POLICY_UNSUPPORTED: `❌ Gemini CLI does not support --admin-policy
→ Upgrade Gemini CLI to v0.36.0 or newer
→ Current command: gemini --help
→ Run 'npx gemini-researcher init' after upgrade`,
  STARTUP_OUTPUT_FORMAT_UNSUPPORTED: `❌ Gemini CLI does not support required output formats
→ Required: --output-format json and --output-format stream-json
→ Verify with: gemini --help
→ Upgrade Gemini CLI to v0.36.0 or newer`,
  STARTUP_ADMIN_POLICY_RELAXED: `⚠ Strict admin policy enforcement disabled by GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY=0
→ Server will continue without hard-failing admin policy checks
→ This weakens fail-closed safety guarantees`,
} as const;
