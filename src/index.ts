#!/usr/bin/env node

/**
 * Better Gemini MCP Server
 *
 * A stateless MCP server that proxies research queries to Gemini CLI,
 * reducing agent context/model usage.
 *
 * @see ./docs/project-overview-PRD.md for full specification
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { ERROR_CODES, PROTOCOL, SERVER_INFO, WIZARD_MESSAGES } from "./constants.js";
import type { ToolArguments } from "./types.js";
import { getToolDefinitions, executeTool, toolExists } from "./tools/index.js";
import { runSetupWizard, validateEnvironment } from "./setup/index.js";
import { Logger } from "./utils/index.js";

// ============================================================================
// Server Instance
// ============================================================================

const server = new Server(
  {
    name: SERVER_INFO.NAME,
    version: SERVER_INFO.VERSION,
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  }
);

// ============================================================================
// Progress Tracking State
// ============================================================================

let isProcessing = false;
let currentOperationName = "";
let latestOutput = "";

// ============================================================================
// Notification Helpers
// ============================================================================

/**
 * Send a progress notification to the client
 * @param progressToken - The progress token provided by the client
 * @param progress - The current progress value
 * @param total - Optional total value (for determinate progress)
 * @param message - Optional status message
 */
async function sendProgressNotification(
  progressToken: string | number | undefined,
  progress: number,
  total?: number,
  message?: string
): Promise<void> {
  // Only send if client requested progress updates
  if (!progressToken) return;

  try {
    const params: Record<string, unknown> = {
      progressToken,
      progress,
    };

    if (total !== undefined) params.total = total;
    if (message) params.message = message;

    await server.notification({
      method: PROTOCOL.NOTIFICATIONS.PROGRESS,
      params,
    });
  } catch (error) {
    logError("Failed to send progress notification:", error);
  }
}

// ============================================================================
// Progress Update Management
// ============================================================================

interface ProgressData {
  interval: NodeJS.Timeout;
  progressToken?: string | number;
}

/**
 * Start periodic progress updates for long-running operations
 */
function startProgressUpdates(
  operationName: string,
  progressToken?: string | number
): ProgressData {
  isProcessing = true;
  currentOperationName = operationName;
  latestOutput = "";

  const progressMessages = [
    `${operationName} - Gemini is analyzing your request...`,
    `${operationName} - Processing files and generating insights...`,
    `${operationName} - Creating structured response for your review...`,
    `${operationName} - Large analysis in progress (this is normal for big requests)...`,
    `${operationName} - Still working... Gemini takes time for quality results...`,
  ];

  let messageIndex = 0;
  let progress = 0;

  // Send immediate acknowledgment if progress requested
  if (progressToken) {
    sendProgressNotification(
      progressToken,
      0,
      undefined, // No total - indeterminate progress
      `Starting ${operationName}`
    );
  }

  // Keep client alive with periodic updates
  const progressInterval = setInterval(async () => {
    if (isProcessing && progressToken) {
      progress += 1;

      // Include latest output preview if available
      const baseMessage = progressMessages[messageIndex % progressMessages.length];
      const outputPreview = latestOutput.slice(-150).trim();
      const message = outputPreview
        ? `${baseMessage}\nOutput: ...${outputPreview}`
        : baseMessage;

      await sendProgressNotification(
        progressToken,
        progress,
        undefined, // No total - indeterminate progress
        message
      );
      messageIndex++;
    } else if (!isProcessing) {
      clearInterval(progressInterval);
    }
  }, PROTOCOL.KEEPALIVE_INTERVAL);

  return { interval: progressInterval, progressToken };
}

/**
 * Stop progress updates and send final notification
 */
function stopProgressUpdates(progressData: ProgressData, success: boolean = true): void {
  const operationName = currentOperationName;
  isProcessing = false;
  currentOperationName = "";
  clearInterval(progressData.interval);

  // Send final progress notification if client requested progress
  if (progressData.progressToken) {
    sendProgressNotification(
      progressData.progressToken,
      100,
      100,
      success
        ? `✅ ${operationName} completed successfully`
        : `❌ ${operationName} failed`
    );
  }
}

// ============================================================================
// Logging Helpers
// ============================================================================

/**
 * Log debug message using Logger utility with sanitization
 */
function logDebug(message: string, ...args: unknown[]): void {
  Logger.debug(message, ...args);
}

/**
 * Log info message using Logger utility with sanitization
 */
function logInfo(message: string, ...args: unknown[]): void {
  Logger.info(message, ...args);
}

/**
 * Log error message using Logger utility with sanitization
 */
function logError(message: string, ...args: unknown[]): void {
  Logger.error(message, ...args);
}

/**
 * Log tool invocation using Logger utility with sanitization
 */
function logToolInvocation(toolName: string, args: unknown): void {
  Logger.toolInvocation(toolName, args as Record<string, unknown>);
}

// ============================================================================
// Request Handlers
// ============================================================================

/**
 * Handle tools/list request
 * Returns the list of available tools with their schemas
 */
server.setRequestHandler(
  ListToolsRequestSchema,
  async (_request: ListToolsRequest): Promise<{ tools: Tool[] }> => {
    logDebug("tools/list request received");
    return { tools: getToolDefinitions() };
  }
);

/**
 * Handle tools/call request
 * Executes the requested tool and returns the result
 */
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest): Promise<CallToolResult> => {
    const toolName = request.params.name;
    logDebug(`tools/call request received for: ${toolName}`);

    if (!toolExists(toolName)) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // Check if client requested progress updates
    const progressToken = (request.params as { _meta?: { progressToken?: string | number } })
      ._meta?.progressToken;

    // Start progress updates if client requested them
    const progressData = startProgressUpdates(toolName, progressToken);

    try {
      // Get arguments from request
      const args: ToolArguments = (request.params.arguments as ToolArguments) || {};

      logToolInvocation(toolName, request.params.arguments);

      // Execute the tool with progress callback
      const result = await executeTool(toolName, args, (newOutput: string) => {
        latestOutput = newOutput;
      });

      // Stop progress updates on success
      stopProgressUpdates(progressData, true);

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
        isError: false,
      };
    } catch (error) {
      // Stop progress updates on error
      stopProgressUpdates(progressData, false);

      logError(`Error in tool '${toolName}':`, error);

      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: {
                  code: ERROR_CODES.INTERNAL,
                  message: `Error executing ${toolName}: ${errorMessage}`,
                },
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Server Startup
// ============================================================================

/**
 * Handle the 'init' command (setup wizard)
 */
async function handleInitCommand(): Promise<void> {
  const success = await runSetupWizard();
  process.exit(success ? 0 : 1);
}

/**
 * Perform startup validation
 * Checks that Gemini CLI is installed and authentication is configured
 */
async function performStartupValidation(): Promise<boolean> {
  const result = await validateEnvironment();

  if (!result.valid) {
    console.error(result.error);
    return false;
  }

  logInfo(WIZARD_MESSAGES.STARTUP_SUCCESS);
  return true;
}

/**
 * Main entry point
 * Initializes the MCP server with stdio transport
 */
async function main(): Promise<void> {
  // Check for 'init' command
  if (process.argv.includes("init")) {
    await handleInitCommand();
    return;
  }

  // Perform startup validation
  const isValid = await performStartupValidation();
  if (!isValid) {
    process.exit(1);
  }

  logInfo(`Initializing ${SERVER_INFO.NAME} v${SERVER_INFO.VERSION}`);

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);

  logInfo(`${SERVER_INFO.NAME} listening on stdio`);
}

// Start the server
main().catch((error) => {
  logError("Fatal error:", error);
  process.exit(1);
});
