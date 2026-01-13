/**
 * Health Check Tool
 *
 * Confirms the MCP server is running and validates Gemini CLI setup.
 * Optionally includes detailed diagnostics.
 */

import { z } from "zod";
import type { UnifiedTool } from "./registry.js";
import type { HealthCheckArgs, HealthCheckResponse, Diagnostics } from "../types.js";
import { SERVER_INFO, ERROR_CODES } from "../constants.js";
import {
  isGeminiCLIInstalled,
  getGeminiVersion,
  checkGeminiAuth,
  getProjectRoot,
  Logger,
} from "../utils/index.js";

// ============================================================================
// Schema
// ============================================================================

const healthCheckSchema = z.object({
  includeDiagnostics: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include detailed diagnostics (Gemini CLI version, auth status, etc.)"),
});

// ============================================================================
// Tool Implementation
// ============================================================================

export const healthCheckTool: UnifiedTool = {
  name: "health_check",
  description:
    "Verify server status and Gemini CLI configuration. Use for troubleshooting connection issues or confirming setup. Example: {includeDiagnostics: true}",
  zodSchema: healthCheckSchema,
  category: "utility",

  execute: async (args, _onProgress) => {
    const { includeDiagnostics } = args as HealthCheckArgs;
    const projectRoot = getProjectRoot();

    Logger.info(`health_check: Starting with includeDiagnostics=${includeDiagnostics}`);

    // Basic health check - just verify the server is running
    const baseResponse: HealthCheckResponse = {
      tool: "health_check",
      status: "ok",
      server: {
        name: SERVER_INFO.NAME,
        version: SERVER_INFO.VERSION,
      },
    };

    // If diagnostics not requested, return basic response
    if (!includeDiagnostics) {
      Logger.info("health_check: Basic check completed successfully");
      return JSON.stringify(baseResponse, null, 2);
    }

    // Run diagnostics
    Logger.debug("health_check: Running diagnostics...");

    try {
      // Check Gemini CLI installation
      const geminiOnPath = await isGeminiCLIInstalled();

      // Get version if installed
      let geminiVersion: string | null = null;
      if (geminiOnPath) {
        geminiVersion = await getGeminiVersion();
      }

      // Check authentication
      let authConfigured = false;
      let authMethod: string | undefined;
      if (geminiOnPath) {
        const auth = await checkGeminiAuth();
        authConfigured = auth.configured;
        authMethod = auth.method;
      }

      // Collect warnings for any issues
      const warnings: string[] = [];
      if (!geminiOnPath) {
        warnings.push("Gemini CLI not found on PATH. Install with: npm install -g @google/gemini-cli");
      }
      if (geminiOnPath && !authConfigured) {
        warnings.push("Gemini CLI authentication not configured. Run 'gemini' and select 'Login with Google'.");
      }

      // Build diagnostics with proper typing
      const diagnostics: Diagnostics = {
        projectRoot,
        geminiOnPath,
        geminiVersion,
        authConfigured,
        readOnlyModeEnforced: true, // We never use --yolo flag
        ...(authMethod && { authMethod }),
        ...(warnings.length > 0 && { warnings }),
      };

      // Determine overall status
      const status: HealthCheckResponse["status"] = geminiOnPath && authConfigured ? "ok" : "degraded";

      const response: HealthCheckResponse = {
        tool: "health_check",
        status,
        server: {
          name: SERVER_INFO.NAME,
          version: SERVER_INFO.VERSION,
        },
        diagnostics,
      };

      Logger.info(`health_check: Diagnostics completed - status=${status}`);
      return JSON.stringify(response, null, 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(`health_check: Diagnostics failed - ${errorMessage}`);

      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.INTERNAL,
            message: `Health check failed: ${errorMessage}`,
            details: { phase: "diagnostics" },
          },
        },
        null,
        2
      );
    }
  },
};
