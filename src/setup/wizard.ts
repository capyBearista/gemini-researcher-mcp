/**
 * Setup Wizard for Better Gemini MCP Server
 * Guides first-time users through validating their environment
 * and configuring Gemini CLI authentication.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { WIZARD_MESSAGES, CLI } from "../constants.js";

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  success: boolean;
  message?: string;
  details?: Record<string, unknown>;
  isAuthError?: boolean;
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
  // 1. Check environment variables (Gemini API Key or Vertex AI)
  if (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_CLOUD_PROJECT
  ) {
    return true;
  }

  // 2. Check for cached credentials in home directory
  // Based on gemini CLI docs, it uses ~/.gemini/settings.json or credentials
  const homeDir = os.homedir();
  const geminiDir = path.join(homeDir, ".gemini");

  return fs.existsSync(geminiDir);
}

/**
 * Step 2: Test Gemini CLI invocation
 * This also validates authentication - if auth is missing, command will fail
 */
export async function testGeminiInvocation(): Promise<ValidationResult> {
  try {
    // Use longer timeout for Gemini CLI (takes time to boot and process)
    // Use an unambiguous prompt that won't trigger tool search or file analysis
    const output = await runCommand(CLI.COMMANDS.GEMINI, [
      CLI.FLAGS.PROMPT,
      "What is 2+2? Answer with just the number.",
      CLI.FLAGS.OUTPUT_FORMAT,
      CLI.OUTPUT_FORMATS.JSON,
    ], 120000); // 2 minutes timeout

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
    const isAuthError =
      errorMessage.includes('auth') ||
      errorMessage.includes('login') ||
      errorMessage.includes('credential') ||
      errorMessage.includes('unauthenticated') ||
      errorMessage.includes('timed out'); // Timeout often means waiting for auth prompt

    return {
      success: false,
      message: errorMessage,
      isAuthError,
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
  // Check Gemini CLI installation
  const installCheck = await checkGeminiInstallation();

  if (!installCheck.installed) {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_GEMINI_NOT_FOUND,
    };
  }

  // Check authentication
  if (!isAuthConfigured()) {
    return {
      valid: false,
      error: WIZARD_MESSAGES.STARTUP_AUTH_MISSING,
    };
  }

  return { valid: true };
}
