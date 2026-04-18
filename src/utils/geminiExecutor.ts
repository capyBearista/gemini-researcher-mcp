/**
 * Gemini CLI executor utility
 *
 * Handles all interactions with the Gemini CLI binary.
 * Implements a 3-tier model fallback strategy for resilience.
 */

import { SYSTEM_PROMPT, MODEL_TIERS, CLI, ERROR_MESSAGES, STATUS_MESSAGES, MODELS } from "../constants.js";
import { Logger } from "./logger.js";
import {
  executeCommand,
  executeCommandWithResolution,
  CommandLaunchError,
  commandExists,
  getCommandVersion,
  isCommandLaunchErrorMessage,
  type CommandResolution,
} from "./commandExecutor.js";
import type { ProgressCallback } from "../types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

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

const READ_ONLY_POLICY_FILE = "read-only-enforcement.toml";
const ADMIN_POLICY_ENFORCEMENT_ENV = "GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY";
const GEMINI_COMMAND_ENV = "GEMINI_RESEARCHER_GEMINI_COMMAND";
const GEMINI_ARGS_PREFIX_ENV = "GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX";
const ADMIN_POLICY_HELP_TIMEOUT_MS = 5000;
const AUTH_PROBE_TIMEOUT_MS = 120000;
const AUTH_PROBE_PROMPT = "Respond with exactly OK. Do not call any tools.";
const REQUIRED_OUTPUT_FORMATS = [CLI.OUTPUT_FORMATS.JSON, CLI.OUTPUT_FORMATS.STREAM_JSON] as const;
const AUTH_ERROR_HINTS = ["auth", "login", "credential", "unauthenticated", "permission denied"] as const;

export type AuthStatus = "configured" | "unauthenticated" | "unknown";

export interface GeminiAuthCheckResult {
  configured: boolean;
  status: AuthStatus;
  method?: "api_key" | "google_login" | "vertex_ai";
  reason?: string;
  launchFailed?: boolean;
  resolution?: GeminiCommandResolution;
}

export interface GeminiCliCapabilityChecks {
  probeSucceeded: boolean;
  launchFailed: boolean;
  hasAdminPolicyFlag: boolean;
  supportsRequiredOutputFormats: boolean;
  outputFormatChoices: string[];
  resolution?: GeminiCommandResolution;
  reason?: string;
}

export interface GeminiCommandConfig {
  command: string;
  argsPrefix: string[];
  configuredCommand?: string;
  configuredArgsPrefix?: string;
}

export interface GeminiCommandResolution extends CommandResolution {
  configuredCommand?: string;
  configuredArgsPrefix?: string;
}

type ExecuteCommandFn = typeof executeCommand;

interface GeminiExecutorDeps {
  executeCommandFn?: ExecuteCommandFn;
}

function parseCommandArgsPrefix(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      if (inSingleQuote) {
        current += char;
        continue;
      }

      if (inDoubleQuote) {
        const nextChar = trimmed[i + 1];
        if (nextChar === "\\" || nextChar === '"') {
          escaping = true;
          continue;
        }
      }

      current += char;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export function getGeminiCommandConfig(): GeminiCommandConfig {
  const configuredCommand = process.env[GEMINI_COMMAND_ENV]?.trim();
  const configuredArgsPrefixRaw = process.env[GEMINI_ARGS_PREFIX_ENV]?.trim();

  return {
    command: configuredCommand && configuredCommand.length > 0 ? configuredCommand : CLI.COMMANDS.GEMINI,
    argsPrefix: configuredArgsPrefixRaw ? parseCommandArgsPrefix(configuredArgsPrefixRaw) : [],
    configuredCommand: configuredCommand && configuredCommand.length > 0 ? configuredCommand : undefined,
    configuredArgsPrefix:
      configuredArgsPrefixRaw && configuredArgsPrefixRaw.length > 0 ? configuredArgsPrefixRaw : undefined,
  };
}

function buildGeminiCommandResolution(
  resolution: CommandResolution,
  commandConfig?: Pick<GeminiCommandConfig, "configuredCommand" | "configuredArgsPrefix">
): GeminiCommandResolution {
  const merged: GeminiCommandResolution = {
    ...resolution,
    ...(commandConfig?.configuredCommand && { configuredCommand: commandConfig.configuredCommand }),
    ...(commandConfig?.configuredArgsPrefix && { configuredArgsPrefix: commandConfig.configuredArgsPrefix }),
  };

  return merged;
}

function getPoliciesDirectory(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "..", "..", "policies");
}

export function getReadOnlyPolicyPath(): string {
  return path.join(getPoliciesDirectory(), READ_ONLY_POLICY_FILE);
}

export function hasReadOnlyPolicyFile(): boolean {
  return fs.existsSync(getReadOnlyPolicyPath());
}

export function isAdminPolicyEnforced(): boolean {
  const value = process.env[ADMIN_POLICY_ENFORCEMENT_ENV];

  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off");
}

export function isAuthRelatedErrorMessage(message: string): boolean {
  const lowered = message.toLowerCase();
  return AUTH_ERROR_HINTS.some((hint) => lowered.includes(hint));
}

function extractOutputFormatChoices(helpText: string): string[] {
  const outputFormatLine = helpText
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().includes(CLI.FLAGS.OUTPUT_FORMAT));

  if (!outputFormatLine) {
    return [];
  }

  const choicesMatch = outputFormatLine.match(/\[choices:\s*([^\]]+)\]/i);
  if (!choicesMatch) {
    return [];
  }

  const rawChoices = choicesMatch[1];
  const quotedChoices = [...rawChoices.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (quotedChoices.length > 0) {
    return quotedChoices;
  }

  return rawChoices
    .split(",")
    .map((choice) => choice.trim().replace(/^['"]|['"]$/g, ""))
    .filter((choice) => choice.length > 0);
}

export async function getGeminiCliCapabilityChecks(deps?: GeminiExecutorDeps): Promise<GeminiCliCapabilityChecks> {
  const runCommand = deps?.executeCommandFn ?? executeCommand;
  const commandConfig = getGeminiCommandConfig();
  const command = commandConfig.command;
  const args = [...commandConfig.argsPrefix, CLI.FLAGS.HELP];
  let capabilityResolution: GeminiCommandResolution | null = null;

  try {
    let helpText: string;

    if (deps?.executeCommandFn) {
      helpText = await runCommand(command, args, undefined, {
        timeoutMs: ADMIN_POLICY_HELP_TIMEOUT_MS,
      });
    } else {
      const execution = await executeCommandWithResolution(command, args, undefined, {
        timeoutMs: ADMIN_POLICY_HELP_TIMEOUT_MS,
      });
      helpText = execution.output;
      capabilityResolution = buildGeminiCommandResolution(execution.resolution, commandConfig);
    }

    const hasAdminPolicyFlag = helpText.includes(CLI.FLAGS.ADMIN_POLICY);
    const outputFormatChoices = extractOutputFormatChoices(helpText);
    const available = new Set(outputFormatChoices.map((choice) => choice.toLowerCase()));
    const supportsRequiredOutputFormats = REQUIRED_OUTPUT_FORMATS.every((requiredFormat) => available.has(requiredFormat));

    return {
      probeSucceeded: true,
      launchFailed: false,
      hasAdminPolicyFlag,
      supportsRequiredOutputFormats,
      outputFormatChoices,
      ...(capabilityResolution ? { resolution: capabilityResolution } : {}),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (error instanceof CommandLaunchError) {
      capabilityResolution = buildGeminiCommandResolution(error.resolution, commandConfig);
    }

    return {
      probeSucceeded: false,
      launchFailed: isCommandLaunchErrorMessage(reason),
      hasAdminPolicyFlag: false,
      supportsRequiredOutputFormats: false,
      outputFormatChoices: [],
      ...(capabilityResolution ? { resolution: capabilityResolution } : {}),
      reason,
    };
  }
}

export async function supportsAdminPolicyFlag(deps?: GeminiExecutorDeps): Promise<boolean> {
  const checks = await getGeminiCliCapabilityChecks(deps);
  return checks.probeSucceeded ? checks.hasAdminPolicyFlag : false;
}

export async function supportsRequiredOutputFormats(deps?: GeminiExecutorDeps): Promise<boolean> {
  const checks = await getGeminiCliCapabilityChecks(deps);
  return checks.probeSucceeded ? checks.supportsRequiredOutputFormats : false;
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

  // Required flags for headless mode and fail-closed read-only contract
  args.push(CLI.FLAGS.OUTPUT_FORMAT, CLI.OUTPUT_FORMATS.JSON);
  args.push(CLI.FLAGS.APPROVAL_MODE, CLI.APPROVAL_MODES.DEFAULT);

  if (isAdminPolicyEnforced()) {
    args.push(CLI.FLAGS.ADMIN_POLICY, getReadOnlyPolicyPath());
  }

  // Explicit prompt flag required for non-interactive mode on current CLI line.
  args.push(CLI.FLAGS.PROMPT, prompt);

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
  onProgress?: ProgressCallback,
  deps?: GeminiExecutorDeps
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
      const commandConfig = getGeminiCommandConfig();

      if (i > 0) {
        // Log fallback attempt
        const message = i === 1 ? STATUS_MESSAGES.FALLBACK_RETRY : STATUS_MESSAGES.AUTO_SELECT_RETRY;
        Logger.warn(message);
        onProgress?.(message + "\n");
      }

      const args = [...commandConfig.argsPrefix, ...buildGeminiArgs(finalPrompt, model)];
      let output: string;

      if (deps?.executeCommandFn) {
        output = await deps.executeCommandFn(commandConfig.command, args, onProgress);
      } else {
        const execution = await executeCommandWithResolution(commandConfig.command, args, onProgress);
        output = execution.output;
      }

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
  const commandConfig = getGeminiCommandConfig();
  return commandExists(commandConfig.command);
}

/**
 * Get Gemini CLI version
 *
 * @returns Version string or null if not installed
 */
export async function getGeminiVersion(): Promise<string | null> {
  const commandConfig = getGeminiCommandConfig();
  return getCommandVersion(commandConfig.command);
}

/**
 * Check if Gemini CLI authentication is configured
 * Checks for GEMINI_API_KEY env var or existing authenticated session
 *
 * @returns Object with auth status
 */
export async function checkGeminiAuth(deps?: GeminiExecutorDeps): Promise<GeminiAuthCheckResult> {
  const runCommand = deps?.executeCommandFn ?? executeCommand;
  const commandConfig = getGeminiCommandConfig();
  // Check for API key
  if (process.env.GEMINI_API_KEY) {
    return { configured: true, status: "configured", method: "api_key" };
  }

  // Check for Vertex AI credentials
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.VERTEX_AI_PROJECT) {
    return { configured: true, status: "configured", method: "vertex_ai" };
  }

  // Try a minimal test invocation to check for Google login session
  const probeArgs: string[] = [
    // Force a broadly-available model for this probe so health checks don't hang
    // when preview models have poor availability.
    CLI.FLAGS.MODEL,
    MODELS.FLASH_FALLBACK,
    CLI.FLAGS.OUTPUT_FORMAT,
    CLI.OUTPUT_FORMATS.JSON,
    CLI.FLAGS.APPROVAL_MODE,
    CLI.APPROVAL_MODES.DEFAULT,
  ];

  if (isAdminPolicyEnforced()) {
    probeArgs.push(CLI.FLAGS.ADMIN_POLICY, getReadOnlyPolicyPath());
  }

  let resolution: GeminiCommandResolution | undefined;

  try {
    probeArgs.push(CLI.FLAGS.PROMPT, AUTH_PROBE_PROMPT);

    const invocationArgs = [...commandConfig.argsPrefix, ...probeArgs];

    if (deps?.executeCommandFn) {
      await runCommand(commandConfig.command, invocationArgs, undefined, {
        timeoutMs: AUTH_PROBE_TIMEOUT_MS,
      });
    } else {
      const execution = await executeCommandWithResolution(commandConfig.command, invocationArgs, undefined, {
        timeoutMs: AUTH_PROBE_TIMEOUT_MS,
      });
      resolution = buildGeminiCommandResolution(execution.resolution, commandConfig);
    }

    return { configured: true, status: "configured", method: "google_login", ...(resolution ? { resolution } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof CommandLaunchError) {
      resolution = buildGeminiCommandResolution(error.resolution, commandConfig);
    }

    const launchFailed = isCommandLaunchErrorMessage(message);

    if (launchFailed) {
      return { configured: false, status: "unknown", reason: message, launchFailed: true, ...(resolution ? { resolution } : {}) };
    }

    const isAuthFailure = isAuthRelatedErrorMessage(message);

    if (isAuthFailure) {
      return { configured: false, status: "unauthenticated", reason: message, ...(resolution ? { resolution } : {}) };
    }

    return { configured: false, status: "unknown", reason: message, launchFailed, ...(resolution ? { resolution } : {}) };
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
  authStatus?: AuthStatus;
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
  const auth = installed ? await checkGeminiAuth() : { configured: false, status: "unknown" as AuthStatus };
  if (installed && !auth.configured) {
    if (auth.status === "unknown" && auth.launchFailed) {
      errors.push(ERROR_MESSAGES.GEMINI_CLI_LAUNCH_FAILED);
    } else if (auth.status === "unknown") {
      errors.push(ERROR_MESSAGES.AUTH_UNKNOWN);
    } else {
      errors.push(ERROR_MESSAGES.AUTH_MISSING);
    }
  }

  return {
    installed,
    version,
    authenticated: auth.configured,
    authStatus: auth.status,
    authMethod: auth.method,
    errors,
  };
}
