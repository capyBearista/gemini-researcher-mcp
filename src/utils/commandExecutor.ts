/**
 * Command executor utility for spawning child processes
 * Uses cross-spawn with Windows-aware fallbacks for Gemini CLI execution
 */

import spawn from "cross-spawn";
import { Logger } from "./logger.js";

const WINDOWS_RETRYABLE_SPAWN_CODES = new Set(["ENOENT", "EINVAL"]);

type SpawnFunction = typeof spawn;

interface CommandAttempt {
  command: string;
  args: string[];
  shell: boolean;
  label: "direct" | "cmd_shim" | "cmd_shell";
}

class CommandExecutionError extends Error {
  readonly kind: "spawn" | "exit" | "timeout";
  readonly attempt: CommandAttempt;
  readonly errorCode?: string;

  constructor(
    kind: "spawn" | "exit" | "timeout",
    attempt: CommandAttempt,
    message: string,
    errorCode?: string
  ) {
    super(message);
    this.kind = kind;
    this.attempt = attempt;
    this.errorCode = errorCode;
  }
}

interface ExecuteCommandOptions {
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  spawnFn?: SpawnFunction;
}

function commandHasKnownExecutableExtension(command: string): boolean {
  const lowered = command.toLowerCase();
  return lowered.endsWith(".cmd") || lowered.endsWith(".exe") || lowered.endsWith(".bat") || lowered.endsWith(".ps1");
}

function quoteForWindowsCmd(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  const escaped = value.replace(/%/g, "%%").replace(/"/g, '""');
  return /[\s"&|<>^]/.test(value) ? `"${escaped}"` : escaped;
}

function buildWindowsCmdInvocation(command: string, args: string[]): string {
  const parts = [quoteForWindowsCmd(command), ...args.map((arg) => quoteForWindowsCmd(arg))];
  return parts.join(" ");
}

function buildCommandAttempts(command: string, args: string[], platform: NodeJS.Platform): CommandAttempt[] {
  const attempts: CommandAttempt[] = [
    {
      command,
      args,
      shell: false,
      label: "direct",
    },
  ];

  if (platform !== "win32") {
    return attempts;
  }

  if (!commandHasKnownExecutableExtension(command)) {
    attempts.push({
      command: `${command}.cmd`,
      args,
      shell: false,
      label: "cmd_shim",
    });
  }

  attempts.push({
    command: "cmd",
    args: ["/d", "/v:off", "/s", "/c", buildWindowsCmdInvocation(command, args)],
    shell: false,
    label: "cmd_shell",
  });

  return attempts;
}

function formatAttempt(attempt: CommandAttempt): string {
  return `${attempt.label}:${attempt.command}`;
}

function getErrorCode(error: Error): string | undefined {
  const withCode = error as Error & { code?: unknown };
  return typeof withCode.code === "string" ? withCode.code.toUpperCase() : undefined;
}

function canRetryWindowsSpawnFailure(error: CommandExecutionError, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") {
    return false;
  }

  if (error.kind !== "spawn") {
    return false;
  }

  if (error.attempt.label === "cmd_shell") {
    return false;
  }

  return error.errorCode !== undefined && WINDOWS_RETRYABLE_SPAWN_CODES.has(error.errorCode);
}

function buildLaunchFailureMessage(
  command: string,
  error: CommandExecutionError,
  attemptedCommands: string[]
): string {
  return [
    `Command launch failed for '${command}': ${error.message}`,
    `Attempted commands: ${attemptedCommands.join(" -> ")}`,
  ].join(". ");
}

export function isCommandLaunchErrorMessage(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("command launch failed") ||
    lowered.includes("failed to spawn") ||
    (lowered.includes("spawn") && (lowered.includes("enoent") || lowered.includes("einval")))
  );
}

async function runSingleCommandAttempt(
  attempt: CommandAttempt,
  onProgress: ((newOutput: string) => void) | undefined,
  timeoutMs: number | undefined,
  spawnFn: SpawnFunction
): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawnFn(attempt.command, attempt.args, {
      env: process.env,
      shell: attempt.shell,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let isResolved = false;
    let lastReportedLength = 0;

    const timeoutHandle =
      typeof timeoutMs === "number" && timeoutMs > 0
        ? setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              try {
                childProcess.kill("SIGKILL");
              } catch {
                // Ignore kill errors and return timeout.
              }
              reject(
                new CommandExecutionError("timeout", attempt, `Command timed out after ${timeoutMs}ms: ${attempt.command}`)
              );
            }
          }, timeoutMs)
        : null;

    childProcess.stdout?.on("data", (data: Buffer | string) => {
      const chunk = typeof data === "string" ? data : data.toString();
      stdout += chunk;

      if (onProgress && stdout.length > lastReportedLength) {
        const newContent = stdout.substring(lastReportedLength);
        lastReportedLength = stdout.length;
        onProgress(newContent);
      }
    });

    childProcess.stderr?.on("data", (data: Buffer | string) => {
      const chunk = typeof data === "string" ? data : data.toString();
      stderr += chunk;
    });

    childProcess.on("error", (error: Error) => {
      if (!isResolved) {
        isResolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(
          new CommandExecutionError(
            "spawn",
            attempt,
            `Failed to spawn command '${attempt.command}': ${error.message}`,
            getErrorCode(error)
          )
        );
      }
    });

    childProcess.on("close", (code: number | null) => {
      if (!isResolved) {
        isResolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (code === 0) {
          resolve(stdout.trim());
          return;
        }

        const sanitizedStderr = stderr.trim() || "Unknown error";
        reject(new CommandExecutionError("exit", attempt, `Command failed with exit code ${code}: ${sanitizedStderr}`));
      }
    });
  });
}

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
  onProgress?: (newOutput: string) => void,
  options?: ExecuteCommandOptions
): Promise<string> {
  const platform = options?.platform ?? process.platform;
  const spawnFn = options?.spawnFn ?? spawn;
  const timeoutMs = options?.timeoutMs;

  const attempts = buildCommandAttempts(command, args, platform);
  const attemptedCommands: string[] = [];

  for (const attempt of attempts) {
    const startTime = Date.now();
    Logger.commandExecution(attempt.command, attempt.args, startTime);
    attemptedCommands.push(formatAttempt(attempt));

    try {
      const output = await runSingleCommandAttempt(attempt, onProgress, timeoutMs, spawnFn);
      Logger.commandComplete(startTime, 0, output.length);
      return output;
    } catch (error) {
      if (!(error instanceof CommandExecutionError)) {
        throw error;
      }

      if (error.kind === "spawn" && canRetryWindowsSpawnFailure(error, platform)) {
        Logger.warn(
          `Command spawn failed (${error.errorCode ?? "unknown"}) using '${error.attempt.label}', retrying fallback...`
        );
        continue;
      }

      if (error.kind === "spawn") {
        const launchMessage = buildLaunchFailureMessage(command, error, attemptedCommands);
        Logger.error(launchMessage);
        throw new Error(launchMessage);
      }

      if (error.kind === "timeout") {
        Logger.error(error.message);
        throw new Error(error.message);
      }

      Logger.error(error.message);
      throw new Error(error.message);
    }
  }

  const fallbackMessage = `Command launch failed for '${command}'. Attempted commands: ${attemptedCommands.join(" -> ")}`;
  Logger.error(fallbackMessage);
  throw new Error(fallbackMessage);
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
