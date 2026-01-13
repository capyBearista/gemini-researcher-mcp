/**
 * Gemini CLI executor utility
 *
 * Handles all interactions with the Gemini CLI binary.
 * Implements a 3-tier model fallback strategy for resilience.
 */

import { SYSTEM_PROMPT, MODEL_TIERS, CLI, ERROR_MESSAGES, STATUS_MESSAGES } from "../constants.js";
import { Logger } from "./logger.js";
import { executeCommand, commandExists, getCommandVersion } from "./commandExecutor.js";
import type { ProgressCallback } from "../types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Response from Gemini CLI execution
 */
export interface GeminiResponse {
  /** The answer/content from Gemini */
  answer: string;
  /** Files that were accessed during analysis */
  filesAccessed: string[];
  /** Execution statistics */
  stats: {
    tokensUsed: number;
    toolCalls: number;
    latencyMs: number;
  };
  /** Model that was used (may differ from requested due to fallback) */
  model: string;
}

/**
 * Tool name for model selection
 */
export type ToolName = "quick_query" | "deep_research" | "analyze_directory";

/**
 * Internal type for model tier configuration
 */
interface ModelTierConfig {
  tier1: string;
  tier2: string;
  tier3: null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get model tiers for a specific tool
 *
 * @param toolName - The tool requesting Gemini execution
 * @returns Array of model names to try in order (null = auto-select)
 */
function getModelTiers(toolName: ToolName): (string | null)[] {
  const config: ModelTierConfig = MODEL_TIERS[toolName] ?? MODEL_TIERS.quick_query;
  return [config.tier1, config.tier2, config.tier3];
}

/**
 * Check if an error is a quota/capacity error that should trigger fallback
 *
 * @param error - The error to check
 * @returns true if this is a quota error
 */
function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("capacity") ||
    message.includes("too many requests") ||
    message.includes("429")
  );
}

/**
 * Build Gemini CLI arguments
 *
 * @param prompt - The full prompt to send
 * @param model - Model name or null for auto-select
 * @returns Array of CLI arguments
 */
function buildGeminiArgs(prompt: string, model: string | null): string[] {
  const args: string[] = [];

  // Add model flag if specified (Tier 3 uses auto-select with no -m flag)
  if (model !== null) {
    args.push(CLI.FLAGS.MODEL, model);
  }

  // Required flags for headless mode
  args.push(CLI.FLAGS.YES); // Auto-approve file reads
  args.push(CLI.FLAGS.OUTPUT_FORMAT, CLI.OUTPUT_FORMATS.JSON);

  // Add prompt
  args.push(CLI.FLAGS.PROMPT, prompt);

  // NEVER add --yolo flag (read-only enforcement)

  return args;
}

/**
 * Parse JSON output from Gemini CLI
 *
 * @param output - Raw stdout from Gemini CLI
 * @returns Parsed response data
 */
function parseGeminiOutput(output: string): {
  text: string;
  tokensUsed?: number;
  toolCalls?: number;
  filesAccessed?: string[];
} {
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(output);

    // Handle different possible response structures
    if (typeof parsed === "object" && parsed !== null) {
      // Look for common response fields
      const text =
        parsed.response ||
        parsed.text ||
        parsed.content ||
        parsed.answer ||
        parsed.result ||
        (typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));

      return {
        text: String(text),
        tokensUsed: parsed.usage?.totalTokens || parsed.tokensUsed || parsed.tokens,
        toolCalls: parsed.toolCalls || parsed.tool_calls?.length || 0,
        filesAccessed: extractFilesFromResponse(parsed),
      };
    }

    return { text: output };
  } catch {
    // If not valid JSON, return raw output
    // This handles cases where Gemini outputs plain text
    return { text: output };
  }
}

/**
 * Extract file paths from Gemini response
 *
 * @param response - Parsed Gemini response object
 * @returns Array of file paths that were accessed
 */
function extractFilesFromResponse(response: unknown): string[] {
  const files: string[] = [];

  if (typeof response !== "object" || response === null) {
    return files;
  }

  const obj = response as Record<string, unknown>;

  // Check common fields for file references
  if (Array.isArray(obj.filesAccessed)) {
    files.push(...(obj.filesAccessed as string[]));
  }

  if (Array.isArray(obj.files)) {
    files.push(...(obj.files as string[]));
  }

  // Extract from tool calls if present
  if (Array.isArray(obj.tool_calls)) {
    for (const call of obj.tool_calls as Array<Record<string, unknown>>) {
      if (call.name === "read_file" && typeof call.path === "string") {
        files.push(call.path);
      }
    }
  }

  // Parse "Files Referenced" section from text if present
  const text = String(obj.response || obj.text || obj.content || "");
  const fileMatches = text.match(/## Files Referenced\n([\s\S]*?)(?:\n##|$)/);
  if (fileMatches) {
    const fileLines = fileMatches[1]
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    files.push(...fileLines);
  }

  // Deduplicate
  return [...new Set(files)];
}

// ============================================================================
// Main Execution Function
// ============================================================================

/**
 * Execute a prompt using Gemini CLI with model fallback
 *
 * @param prompt - The user's research prompt
 * @param toolName - The tool initiating this request (determines model selection)
 * @param onProgress - Optional callback for progress updates
 * @returns GeminiResponse with the answer and metadata
 */
export async function executeGeminiCLI(
  prompt: string,
  toolName: ToolName,
  onProgress?: ProgressCallback
): Promise<GeminiResponse> {
  const startTime = Date.now();

  // Prepend system prompt
  const finalPrompt = `${SYSTEM_PROMPT}\n\n---\n\nUSER REQUEST:\n${prompt}`;

  // Get model tiers for this tool
  const modelTiers = getModelTiers(toolName);

  Logger.info(`Executing Gemini CLI for tool: ${toolName}`);

  // Try each tier with fallback
  let lastError: Error | null = null;

  for (let i = 0; i < modelTiers.length; i++) {
    const model = modelTiers[i];
    const tierName = model ?? "auto-select";

    try {
      Logger.debug(`Attempting tier ${i + 1} with model: ${tierName}`);

      if (i > 0) {
        // Log fallback attempt
        const message = i === 1 ? STATUS_MESSAGES.FALLBACK_RETRY : STATUS_MESSAGES.AUTO_SELECT_RETRY;
        Logger.warn(message);
        onProgress?.(message + "\n");
      }

      const args = buildGeminiArgs(finalPrompt, model);
      const output = await executeCommand(CLI.COMMANDS.GEMINI, args, onProgress);

      // Parse the output
      const parsed = parseGeminiOutput(output);
      const latencyMs = Date.now() - startTime;

      Logger.info(`Gemini CLI completed in ${latencyMs}ms with model: ${tierName}`);

      if (i > 0) {
        Logger.info(STATUS_MESSAGES.FALLBACK_SUCCESS);
      }

      return {
        answer: parsed.text,
        filesAccessed: parsed.filesAccessed || [],
        stats: {
          tokensUsed: parsed.tokensUsed || 0,
          toolCalls: parsed.toolCalls || 0,
          latencyMs,
        },
        model: model ?? "auto",
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is a quota error and we have more tiers to try
      if (isQuotaError(error) && i < modelTiers.length - 1) {
        Logger.warn(`${ERROR_MESSAGES.QUOTA_EXCEEDED_SHORT} (tier ${i + 1})`);
        continue; // Try next tier
      }

      // Not a quota error or no more tiers - throw
      Logger.error(`Gemini CLI failed: ${lastError.message}`);
      throw lastError;
    }
  }

  // Should not reach here, but just in case
  throw lastError ?? new Error("Gemini CLI execution failed");
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if Gemini CLI is installed and accessible
 *
 * @returns true if gemini command exists on PATH
 */
export async function isGeminiCLIInstalled(): Promise<boolean> {
  return commandExists(CLI.COMMANDS.GEMINI);
}

/**
 * Get Gemini CLI version
 *
 * @returns Version string or null if not installed
 */
export async function getGeminiVersion(): Promise<string | null> {
  return getCommandVersion(CLI.COMMANDS.GEMINI);
}

/**
 * Check if Gemini CLI authentication is configured
 * Checks for GEMINI_API_KEY env var or existing authenticated session
 *
 * @returns Object with auth status
 */
export async function checkGeminiAuth(): Promise<{
  configured: boolean;
  method?: "api_key" | "google_login" | "vertex_ai";
}> {
  // Check for API key
  if (process.env.GEMINI_API_KEY) {
    return { configured: true, method: "api_key" };
  }

  // Check for Vertex AI credentials
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.VERTEX_AI_PROJECT) {
    return { configured: true, method: "vertex_ai" };
  }

  // Try a minimal test invocation to check for Google login session
  try {
    await executeCommand(CLI.COMMANDS.GEMINI, [
      CLI.FLAGS.PROMPT,
      "test",
      CLI.FLAGS.OUTPUT_FORMAT,
      CLI.OUTPUT_FORMATS.JSON,
    ]);
    return { configured: true, method: "google_login" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("auth") || message.includes("login") || message.includes("credential")) {
      return { configured: false };
    }
    // Other errors might still mean auth is configured
    return { configured: true, method: "google_login" };
  }
}

/**
 * Validate Gemini CLI setup (installation + auth)
 *
 * @returns Object with validation results
 */
export async function validateGeminiSetup(): Promise<{
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  authMethod?: string;
  errors: string[];
}> {
  const errors: string[] = [];

  // Check installation
  const installed = await isGeminiCLIInstalled();
  if (!installed) {
    errors.push(ERROR_MESSAGES.GEMINI_CLI_NOT_FOUND);
  }

  // Get version
  const version = installed ? await getGeminiVersion() : null;

  // Check auth
  const auth = installed ? await checkGeminiAuth() : { configured: false };
  if (installed && !auth.configured) {
    errors.push(ERROR_MESSAGES.AUTH_MISSING);
  }

  return {
    installed,
    version,
    authenticated: auth.configured,
    authMethod: auth.method,
    errors,
  };
}
