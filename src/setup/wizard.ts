/**
 * Setup Wizard for Gemini Researcher Server
 * Guides first-time users through validating their environment
 * and configuring Gemini CLI authentication.
 */

import { spawn } from "child_process";
import { WIZARD_MESSAGES, CLI, ERROR_MESSAGES } from "../constants.js";
import {
  checkGeminiAuth,
  getReadOnlyPolicyPath,
  hasReadOnlyPolicyFile,
  isAdminPolicyEnforced,
  supportsAdminPolicyFlag,
} from "../utils/geminiExecutor.js";

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  success: boolean;
  message?: string;
  details?: Record<string, unknown>;
  isAuthError?: boolean;
  isAuthUnknown?: boolean;
}

export interface GeminiInstallCheck {
  installed: boolean;
  path: string | null;
  version: string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Execute a command and return stdout with timeout support
 */
async function runCommand(command: string, args: string[], timeoutMs: number = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Set up timeout to kill process if it hangs
    const timeout = setTimeout(() => {
      timedOut = true;
      childProcess.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    childProcess.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn '${command}': ${error.message}`));
    });

    childProcess.on("close", (code: number | null) => {
      clearTimeout(timeout);
      if (timedOut) {
        return; // Already rejected by timeout
      }
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
      }
    });
  });
}

/**
 * Get the path to the gemini binary
 */
async function getGeminiPath(): Promise<string | null> {
  const whichCommand = process.platform === "win32" ? CLI.COMMANDS.WHERE : CLI.COMMANDS.WHICH;
  try {
    const result = await runCommand(whichCommand, [CLI.COMMANDS.GEMINI]);
    // 'which' may return multiple lines on some systems, get the first one
    return result.split("\n")[0].trim();
  } catch {
    return null;
  }
}

/**
 * Get the version of the gemini CLI
 */
async function getGeminiVersion(): Promise<string | null> {
  try {
    const output = await runCommand(CLI.COMMANDS.GEMINI, [CLI.FLAGS.VERSION]);
    // Try to extract version number pattern (e.g., "1.2.3")
    const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
    return versionMatch ? versionMatch[1] : output.split("\n")[0].trim();
  } catch {
    return null;
  }
}

// ============================================================================
// Validation Steps
// ============================================================================

/**
 * Step 1: Check if Gemini CLI is installed
 */
export async function checkGeminiInstallation(): Promise<GeminiInstallCheck> {
  const geminiPath = await getGeminiPath();

  if (!geminiPath) {
    return {
      installed: false,
      path: null,
      version: null,
    };
  }

  const version = await getGeminiVersion();

  return {
    installed: true,
    path: geminiPath,
    version: version,
  };
}

/**
 * Fast check if authentication is likely configured
 */
export function isAuthConfigured(): boolean {
  // Deprecated heuristic kept for backward compatibility with tests/imports.
  // Runtime startup validation now uses checkGeminiAuth() for strict fail-closed semantics.
  return Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_CLOUD_PROJECT
  );
}

/**
 * Step 2: Test Gemini CLI invocation
 * This also validates authentication - if auth is missing, command will fail
 */
export async function testGeminiInvocation(): Promise<ValidationResult> {
  const auth = await checkGeminiAuth();
  if (!auth.configured && auth.status === "unauthenticated") {
    return {
      success: false,
      message: ERROR_MESSAGES.AUTH_MISSING,
      isAuthError: true,
    };
  }

  if (!auth.configured && auth.status === "unknown") {
    return {
      success: false,
      message: ERROR_MESSAGES.AUTH_UNKNOWN,
      isAuthUnknown: true,
    };
  }

  try {
    // Use longer timeout for Gemini CLI (takes time to boot and process)
    // Use an unambiguous prompt that won't trigger tool search or file analysis
    const args: string[] = [
      CLI.FLAGS.OUTPUT_FORMAT,
      CLI.OUTPUT_FORMATS.JSON,
      CLI.FLAGS.APPROVAL_MODE,
      CLI.APPROVAL_MODES.DEFAULT,
      CLI.FLAGS.PROMPT,
      "What is 2+2? Answer with just the number.",
    ];

    if (isAdminPolicyEnforced()) {
      args.splice(args.length - 2, 0, CLI.FLAGS.ADMIN_POLICY, getReadOnlyPolicyPath());
    }

    const output = await runCommand(CLI.COMMANDS.GEMINI, args, 120000); // 2 minutes timeout

    // Try to parse JSON output to verify it's working correctly
    try {
      JSON.parse(output);
    } catch {
      // Even if we can't parse JSON, if we got output, it worked
    }

    return {
      success: true,
      message: "Test invocation successful",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if error is likely auth-related
    const lowered = errorMessage.toLowerCase();
    const isAuthError =
      lowered.includes("auth") ||
      lowered.includes("login") ||
      lowered.includes("credential") ||
      lowered.includes("unauthenticated");
    const isAuthUnknown = !isAuthError;

    return {
      success: false,
      message: errorMessage,
      isAuthError,
      isAuthUnknown,
    };
  }
}

// ============================================================================
// Main Wizard Function
// ============================================================================

/**
 * Run the complete setup wizard
 * Performs all validation steps and displays results to the user
 */
export async function runSetupWizard(): Promise<boolean> {
  let hasErrors = false;

  // Print header
  console.log(WIZARD_MESSAGES.HEADER);

  // Step 1: Check Gemini CLI installation
  console.log(WIZARD_MESSAGES.STEP_GEMINI_INSTALL);
  const installCheck = await checkGeminiInstallation();

  if (installCheck.installed && installCheck.path && installCheck.version) {
    console.log(WIZARD_MESSAGES.GEMINI_FOUND(installCheck.path, installCheck.version));
  } else if (installCheck.installed && installCheck.path) {
    console.log(WIZARD_MESSAGES.GEMINI_FOUND(installCheck.path, "unknown"));
  } else {
    console.log(WIZARD_MESSAGES.GEMINI_NOT_FOUND);
    hasErrors = true;
  }

  console.log(); // Empty line for spacing

  // Step 2: Test invocation (only if Gemini is installed)
  console.log(WIZARD_MESSAGES.STEP_TEST);

  if (!installCheck.installed) {
    console.log("  ⚠ Skipped (Gemini CLI not installed)");
  } else {
    const testResult = await testGeminiInvocation();

    if (testResult.success) {
      console.log(WIZARD_MESSAGES.TEST_SUCCESS);
    } else {
      console.log(WIZARD_MESSAGES.TEST_FAILED(testResult.message || "Unknown error"));
      hasErrors = true;

      // If error is likely auth-related, show auth instructions
      if (testResult.isAuthError) {
        console.log("");
        console.log(WIZARD_MESSAGES.AUTH_NOT_FOUND);
      }

      if (testResult.isAuthUnknown) {
        console.log("");
        console.log(ERROR_MESSAGES.AUTH_UNKNOWN);
      }
    }
  }

  console.log(); // Empty line before final section

  // Print result
  if (hasErrors) {
    console.log(WIZARD_MESSAGES.FIX_ISSUES);
    return false;
  } else {
    console.log(WIZARD_MESSAGES.SUCCESS_HEADER);
    console.log(WIZARD_MESSAGES.NEXT_STEPS);
    return true;
  }
}

// ============================================================================
// Startup Validation (for use in index.ts)
// ============================================================================

/**
 * Validate environment at startup (quick validation, no user interaction)
 * Returns true if environment is valid, false otherwise
 */
export async function validateEnvironment(): Promise<{ valid: boolean; error?: string }> {
  const enforceAdminPolicy = isAdminPolicyEnforced();

  // Check Gemini CLI installation
  const installCheck = await checkGeminiInstallation();

  if (!installCheck.installed) {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_GEMINI_NOT_FOUND,
    };
  }

  if (!enforceAdminPolicy) {
    console.warn(WIZARD_MESSAGES.STARTUP_ADMIN_POLICY_RELAXED);
  }

  // Verify read-only admin policy file is available
  if (enforceAdminPolicy && !hasReadOnlyPolicyFile()) {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_ADMIN_POLICY_MISSING,
    };
  }

  // Verify Gemini CLI supports --admin-policy (v0.36+)
  const hasAdminPolicySupport = enforceAdminPolicy ? await supportsAdminPolicyFlag() : true;
  if (enforceAdminPolicy && !hasAdminPolicySupport) {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_ADMIN_POLICY_UNSUPPORTED,
    };
  }

  // Check authentication (strict, fail-closed for unknown)
  const auth = await checkGeminiAuth();
  if (!auth.configured && auth.status === "unauthenticated") {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_AUTH_MISSING,
    };
  }

  if (!auth.configured && auth.status === "unknown") {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_AUTH_UNKNOWN,
    };
  }

  return { valid: true };
}
