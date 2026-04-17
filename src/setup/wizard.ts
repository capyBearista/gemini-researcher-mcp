/**
 * Setup Wizard for Gemini Researcher Server
 * Guides first-time users through validating their environment
 * and configuring Gemini CLI authentication.
 */

import { WIZARD_MESSAGES, CLI, ERROR_MESSAGES } from "../constants.js";
import {
  checkGeminiAuth,
  type GeminiAuthCheckResult,
  type GeminiCliCapabilityChecks,
  getGeminiCliCapabilityChecks,
  getReadOnlyPolicyPath,
  hasReadOnlyPolicyFile,
  isAuthRelatedErrorMessage,
  isAdminPolicyEnforced,
} from "../utils/geminiExecutor.js";
import { executeCommand, getCommandVersion, isCommandLaunchErrorMessage } from "../utils/commandExecutor.js";

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  success: boolean;
  message?: string;
  details?: Record<string, unknown>;
  isAuthError?: boolean;
  isAuthUnknown?: boolean;
  isLaunchError?: boolean;
}

export interface GeminiInstallCheck {
  installed: boolean;
  path: string | null;
  version: string | null;
}

interface ValidateEnvironmentDeps {
  isAdminPolicyEnforcedFn?: () => boolean;
  hasReadOnlyPolicyFileFn?: () => boolean;
  checkGeminiInstallationFn?: () => Promise<GeminiInstallCheck>;
  getGeminiCliCapabilityChecksFn?: () => Promise<GeminiCliCapabilityChecks>;
  checkGeminiAuthFn?: () => Promise<GeminiAuthCheckResult>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the path to the gemini binary
 */
async function getGeminiPath(): Promise<string | null> {
  try {
    const checkCommand = process.platform === "win32" ? CLI.COMMANDS.WHERE : CLI.COMMANDS.WHICH;
    const result = await executeCommand(checkCommand, [CLI.COMMANDS.GEMINI]);
    return result.split("\n")[0].trim();
  } catch {
    return null;
  }
}

/**
 * Get the version of the gemini CLI
 */
async function getGeminiVersion(): Promise<string | null> {
  return getCommandVersion(CLI.COMMANDS.GEMINI);
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
    if (auth.launchFailed) {
      return {
        success: false,
        message: ERROR_MESSAGES.GEMINI_CLI_LAUNCH_FAILED,
        isLaunchError: true,
      };
    }

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

    const output = await executeCommand(CLI.COMMANDS.GEMINI, args, undefined, { timeoutMs: 120000 });

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
    const isLaunchError = isCommandLaunchErrorMessage(errorMessage);

    // Check if error is likely auth-related
    const isAuthError = !isLaunchError && isAuthRelatedErrorMessage(errorMessage);
    const isAuthUnknown = !isAuthError && !isLaunchError;

    return {
      success: false,
      message: errorMessage,
      isAuthError,
      isAuthUnknown,
      isLaunchError,
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

      if (testResult.isLaunchError) {
        console.log("");
        console.log(ERROR_MESSAGES.GEMINI_CLI_LAUNCH_FAILED);
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
export async function validateEnvironment(deps?: ValidateEnvironmentDeps): Promise<{ valid: boolean; error?: string }> {
  const enforceAdminPolicy = deps?.isAdminPolicyEnforcedFn?.() ?? isAdminPolicyEnforced();

  // Check Gemini CLI installation
  const checkGeminiInstallationFn = deps?.checkGeminiInstallationFn ?? checkGeminiInstallation;
  const installCheck = await checkGeminiInstallationFn();

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
  const hasReadOnlyPolicyFileFn = deps?.hasReadOnlyPolicyFileFn ?? hasReadOnlyPolicyFile;
  if (enforceAdminPolicy && !hasReadOnlyPolicyFileFn()) {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_ADMIN_POLICY_MISSING,
    };
  }

  const getGeminiCliCapabilityChecksFn = deps?.getGeminiCliCapabilityChecksFn ?? getGeminiCliCapabilityChecks;
  const capabilityChecks = await getGeminiCliCapabilityChecksFn();
  if (!capabilityChecks.probeSucceeded) {
    if (capabilityChecks.launchFailed) {
      return {
        valid: false,
        error: WIZARD_MESSAGES.STARTUP_GEMINI_LAUNCH_FAILED(capabilityChecks.reason || "Unknown launch failure"),
      };
    }

    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_GEMINI_PROBE_FAILED(capabilityChecks.reason || "Unknown probe failure"),
    };
  }

  // Verify Gemini CLI supports --admin-policy (v0.36+)
  if (enforceAdminPolicy && !capabilityChecks.hasAdminPolicyFlag) {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_ADMIN_POLICY_UNSUPPORTED,
    };
  }

  // Verify Gemini CLI supports required output formats (json + stream-json)
  if (!capabilityChecks.supportsRequiredOutputFormats) {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_OUTPUT_FORMAT_UNSUPPORTED,
    };
  }

  // Check authentication (strict, fail-closed for unknown)
  const checkGeminiAuthFn = deps?.checkGeminiAuthFn ?? checkGeminiAuth;
  const auth = await checkGeminiAuthFn();
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
