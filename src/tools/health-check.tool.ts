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
  hasReadOnlyPolicyFile,
  isAdminPolicyEnforced,
  supportsAdminPolicyFlag,
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
      let authStatus: "configured" | "unauthenticated" | "unknown" = "unknown";
      let authMethod: string | undefined;
      const enforceAdminPolicy = isAdminPolicyEnforced();
      const policyFilePresent = hasReadOnlyPolicyFile();
      const adminPolicySupported = geminiOnPath && enforceAdminPolicy ? await supportsAdminPolicyFlag() : true;
      if (geminiOnPath) {
        const auth = await checkGeminiAuth();
        authConfigured = auth.configured;
        authStatus = auth.status;
        authMethod = auth.method;
      }

      // Collect warnings for any issues
      const warnings: string[] = [];
      if (!geminiOnPath) {
        warnings.push("Gemini CLI not found on PATH. Install with: npm install -g @google/gemini-cli");
      }
      if (geminiOnPath && authStatus === "unauthenticated") {
        warnings.push("Gemini CLI authentication not configured. Run 'gemini' and select 'Login with Google'.");
      }
      if (geminiOnPath && authStatus === "unknown") {
        warnings.push("Gemini CLI authentication status is unknown due to ambiguous probe failure.");
      }
      if (enforceAdminPolicy && !policyFilePresent) {
        warnings.push("Read-only admin policy file missing. Expected: policies/read-only-enforcement.toml");
      }
      if (enforceAdminPolicy && geminiOnPath && !adminPolicySupported) {
        warnings.push("Gemini CLI does not support --admin-policy. Upgrade to v0.36.0 or newer.");
      }
      if (!enforceAdminPolicy) {
        warnings.push("Strict admin policy enforcement disabled by GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY=0.");
      }

      // Build diagnostics with proper typing
      const diagnostics: Diagnostics = {
        projectRoot,
        geminiOnPath,
        geminiVersion,
        authConfigured,
        authStatus,
        readOnlyModeEnforced: enforceAdminPolicy && policyFilePresent && adminPolicySupported,
        ...(authMethod && { authMethod }),
        ...(warnings.length > 0 && { warnings }),
      };

      // Determine overall status
      const status: HealthCheckResponse["status"] =
        geminiOnPath && authConfigured && (!enforceAdminPolicy || (policyFilePresent && adminPolicySupported))
          ? "ok"
          : "degraded";

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
