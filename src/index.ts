#!/usr/bin/env node

/**
 * Better Gemini MCP Server
 * 
 * A stateless MCP server that proxies research queries to Gemini CLI,
 * reducing agent context/model usage.
 * 
 * @see docs/project-overview-PRD.md for full specification
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

import { PROTOCOL, SERVER_INFO, LOG_PREFIX } from "./constants.js";
import type { ToolArguments } from "./types.js";
import { getToolDefinitions, executeTool, toolExists } from "./tools/index.js";

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
      notifications: {},
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
 * Send a notification to the client
 */
async function sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
  try {
    await server.notification({ method, params });
  } catch (error) {
    logError("notification failed:", error);
  }
}

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
    `🧠 ${operationName} - Gemini is analyzing your request...`,
    `📊 ${operationName} - Processing files and generating insights...`,
    `✨ ${operationName} - Creating structured response for your review...`,
    `⏱️ ${operationName} - Large analysis in progress (this is normal for big requests)...`,
    `🔍 ${operationName} - Still working... Gemini takes time for quality results...`,
  ];

  let messageIndex = 0;
  let progress = 0;

  // Send immediate acknowledgment if progress requested
  if (progressToken) {
    sendProgressNotification(
      progressToken,
      0,
      undefined, // No total - indeterminate progress
      `🔍 Starting ${operationName}`
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
        ? `${baseMessage}\n📝 Output: ...${outputPreview}`
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
 * Log debug message to stderr (stdout reserved for MCP protocol)
 */
function logDebug(message: string, ...args: unknown[]): void {
  if (process.env.DEBUG) {
    console.error(`${LOG_PREFIX} [DEBUG]`, message, ...args);
  }
}

/**
 * Log info message to stderr
 */
function logInfo(message: string, ...args: unknown[]): void {
  console.error(`${LOG_PREFIX} [INFO]`, message, ...args);
}

/**
 * Log error message to stderr
 */
function logError(message: string, ...args: unknown[]): void {
  console.error(`${LOG_PREFIX} [ERROR]`, message, ...args);
}

/**
 * Log tool invocation for debugging
 */
function logToolInvocation(toolName: string, args: unknown): void {
  logDebug(`Tool invoked: ${toolName}`, JSON.stringify(args, null, 2));
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
                  code: "INTERNAL",
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
 * Main entry point
 * Initializes the MCP server with stdio transport
 */
async function main(): Promise<void> {
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
