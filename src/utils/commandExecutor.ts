/**
 * Command executor utility for spawning child processes
 * Uses child_process.spawn for Gemini CLI execution
 */

import { spawn } from "child_process";
import { Logger } from "./logger.js";

/**
 * Execute a command with the given arguments
 *
 * @param command - The command to execute (e.g., "gemini")
 * @param args - Array of command arguments
 * @param onProgress - Optional callback for streaming output
 * @returns Promise resolving to stdout as string
 */
export async function executeCommand(
  command: string,
  args: string[],
  onProgress?: (newOutput: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    Logger.commandExecution(command, args, startTime);

    const childProcess = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let isResolved = false;
    let lastReportedLength = 0;

    // Handle stdout data
    childProcess.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      // Report new content if callback provided
      if (onProgress && stdout.length > lastReportedLength) {
        const newContent = stdout.substring(lastReportedLength);
        lastReportedLength = stdout.length;
        onProgress(newContent);
      }
    });

    // Handle stderr data
    childProcess.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle process spawn errors
    childProcess.on("error", (error: Error) => {
      if (!isResolved) {
        isResolved = true;
        Logger.error(`Process error: ${error.message}`);
        reject(new Error(`Failed to spawn command '${command}': ${error.message}`));
      }
    });

    // Handle process exit
    childProcess.on("close", (code: number | null) => {
      if (!isResolved) {
        isResolved = true;

        if (code === 0) {
          Logger.commandComplete(startTime, code, stdout.length);
          resolve(stdout.trim());
        } else {
          Logger.commandComplete(startTime, code);

          // Sanitize stderr before logging (may contain sensitive info)
          const sanitizedStderr = stderr.trim() || "Unknown error";
          Logger.error(`Command failed with exit code ${code}`);

          reject(new Error(`Command failed with exit code ${code}: ${sanitizedStderr}`));
        }
      }
    });
  });
}

/**
 * Check if a command exists on PATH
 *
 * @param command - The command to check (e.g., "gemini")
 * @returns Promise resolving to true if command exists
 */
export async function commandExists(command: string): Promise<boolean> {
  const checkCommand = process.platform === "win32" ? "where" : "which";

  try {
    await executeCommand(checkCommand, [command]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the version of a command
 *
 * @param command - The command to get version for
 * @returns Promise resolving to version string or null
 */
export async function getCommandVersion(command: string): Promise<string | null> {
  try {
    const output = await executeCommand(command, ["--version"]);
    // Extract version from output (usually first line)
    const firstLine = output.split("\n")[0];
    // Try to extract version number pattern
    const versionMatch = firstLine.match(/(\d+\.\d+\.\d+)/);
    return versionMatch ? versionMatch[1] : firstLine.trim();
  } catch {
    return null;
  }
}
