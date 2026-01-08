/**
 * Structured logging utility for Better Gemini MCP Server
 * Implements logging with levels: error, warn, info, debug
 * NEVER logs sensitive credentials like GEMINI_API_KEY
 */

import { LOG_PREFIX } from "../constants.js";

/**
 * List of sensitive patterns that should be filtered from logs
 */
const SENSITIVE_PATTERNS = [
  /GEMINI_API_KEY[=:]\s*["']?[^"'\s]+["']?/gi,
  /api[_-]?key[=:]\s*["']?[^"'\s]+["']?/gi,
  /authorization[=:]\s*["']?[^"'\s]+["']?/gi,
  /bearer\s+[a-zA-Z0-9_-]+/gi,
  /token[=:]\s*["']?[^"'\s]+["']?/gi,
];

/**
 * Check if debug logging is enabled via DEBUG env var
 */
function isDebugEnabled(): boolean {
  return process.env.DEBUG === "true" || process.env.DEBUG === "1";
}

/**
 * Get ISO timestamp for log entries
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Sanitize a message by removing sensitive credential patterns
 */
function sanitize(message: string): string {
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}

/**
 * Format a log message with timestamp, level, and prefix
 */
function formatMessage(level: string, message: string): string {
  const sanitizedMessage = sanitize(message);
  return `[${getTimestamp()}] [${level.toUpperCase()}] ${LOG_PREFIX} ${sanitizedMessage}`;
}

/**
 * Safely stringify any value for logging, handling circular references
 */
function safeStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Logger class for structured logging
 */
export class Logger {
  /**
   * Log an error message (always logged)
   */
  static error(message: string, ...args: unknown[]): void {
    const formatted = formatMessage("error", message);
    if (args.length > 0) {
      const argsStr = args.map((arg) => sanitize(safeStringify(arg))).join(" ");
      console.error(formatted, argsStr);
    } else {
      console.error(formatted);
    }
  }

  /**
   * Log a warning message (always logged)
   */
  static warn(message: string, ...args: unknown[]): void {
    const formatted = formatMessage("warn", message);
    if (args.length > 0) {
      const argsStr = args.map((arg) => sanitize(safeStringify(arg))).join(" ");
      console.error(formatted, argsStr);
    } else {
      console.error(formatted);
    }
  }

  /**
   * Log an info message (always logged)
   */
  static info(message: string, ...args: unknown[]): void {
    const formatted = formatMessage("info", message);
    if (args.length > 0) {
      const argsStr = args.map((arg) => sanitize(safeStringify(arg))).join(" ");
      console.error(formatted, argsStr);
    } else {
      console.error(formatted);
    }
  }

  /**
   * Log a debug message (only when DEBUG env var is set)
   */
  static debug(message: string, ...args: unknown[]): void {
    if (!isDebugEnabled()) return;

    const formatted = formatMessage("debug", message);
    if (args.length > 0) {
      const argsStr = args.map((arg) => sanitize(safeStringify(arg))).join(" ");
      console.error(formatted, argsStr);
    } else {
      console.error(formatted);
    }
  }

  /**
   * Log a tool invocation (sanitized parameters, excludes full prompts)
   */
  static toolInvocation(toolName: string, args: Record<string, unknown>): void {
    // Create a copy with truncated prompt for logging
    const sanitizedArgs = { ...args };
    if (typeof sanitizedArgs.prompt === "string" && sanitizedArgs.prompt.length > 100) {
      sanitizedArgs.prompt = sanitizedArgs.prompt.substring(0, 100) + "...[truncated]";
    }
    this.info(`Tool invocation: ${toolName}`, sanitizedArgs);
  }

  /**
   * Log command execution (command args, not output)
   */
  static commandExecution(command: string, args: string[], startTime: number): void {
    // Filter out the actual prompt content from args (it's the last argument after -p)
    const safeArgs = args.map((arg, index) => {
      // If previous arg was -p or --prompt, truncate this arg
      if (index > 0 && (args[index - 1] === "-p" || args[index - 1] === "--prompt")) {
        return arg.length > 100 ? arg.substring(0, 100) + "...[truncated]" : arg;
      }
      return arg;
    });
    this.debug(`[${startTime}] Executing: ${command} ${safeArgs.join(" ")}`);
  }

  /**
   * Log command completion with timing
   */
  static commandComplete(startTime: number, exitCode: number | null, outputLength?: number): void {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.debug(`[${elapsed}s] Process finished with exit code: ${exitCode}`);
    if (outputLength !== undefined) {
      this.debug(`Response length: ${outputLength} chars`);
    }
  }
}
