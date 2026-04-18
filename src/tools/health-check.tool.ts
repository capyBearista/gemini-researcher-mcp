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
  getGeminiCliCapabilityChecks,

  getProjectRoot,
  Logger,
} from "../utils/index.js";

// ============================================================================
// Schema
// ============================================================================

export interface HealthCheckDeps {
  isGeminiCLIInstalledFn?: typeof isGeminiCLIInstalled;
  getGeminiVersionFn?: typeof getGeminiVersion;
  checkGeminiAuthFn?: typeof checkGeminiAuth;
  hasReadOnlyPolicyFileFn?: typeof hasReadOnlyPolicyFile;
  isAdminPolicyEnforcedFn?: typeof isAdminPolicyEnforced;
  getGeminiCliCapabilityChecksFn?: typeof getGeminiCliCapabilityChecks;

  getProjectRootFn?: typeof getProjectRoot;
}


async function executeHealthCheck(
  args: HealthCheckArgs,
  deps?: HealthCheckDeps
): Promise<HealthCheckResponse | { error: { code: string; message: string; details: { phase: string } } }> {
  const { includeDiagnostics } = args;
  const projectRoot = deps?.getProjectRootFn ? deps.getProjectRootFn() : getProjectRoot();

  Logger.info(`health_check: Starting with includeDiagnostics=${includeDiagnostics}`);

  const baseResponse: HealthCheckResponse = {
    tool: "health_check",
    status: "ok",
    server: {
      name: SERVER_INFO.NAME,
      version: SERVER_INFO.VERSION,
    },
  };

  if (!includeDiagnostics) {
    Logger.info("health_check: Basic check completed successfully");
    return baseResponse;
  }

  Logger.debug("health_check: Running diagnostics...");

  try {
    const resolveInstalled = deps?.isGeminiCLIInstalledFn ?? isGeminiCLIInstalled;
    const geminiOnPath = await resolveInstalled();

    const resolveVersion = deps?.getGeminiVersionFn ?? getGeminiVersion;
    let geminiVersion: string | null = null;
    if (geminiOnPath) {
      geminiVersion = await resolveVersion();
    }

    let authConfigured = false;
    let authStatus: "configured" | "unauthenticated" | "unknown" = "unknown";
    let authMethod: string | undefined;
    let authLaunchFailed = false;
    let authResolution: typeof capabilityChecks.resolution | undefined;

    const enforceAdminPolicy = deps?.isAdminPolicyEnforcedFn ? deps.isAdminPolicyEnforcedFn() : isAdminPolicyEnforced();
    const policyFilePresent = deps?.hasReadOnlyPolicyFileFn ? deps.hasReadOnlyPolicyFileFn() : hasReadOnlyPolicyFile();

    const resolveCapabilityChecks = deps?.getGeminiCliCapabilityChecksFn ?? getGeminiCliCapabilityChecks;
    const capabilityChecks = geminiOnPath
      ? await resolveCapabilityChecks()
      : {
          probeSucceeded: false,
          launchFailed: false,
          hasAdminPolicyFlag: false,
          supportsRequiredOutputFormats: false,
          outputFormatChoices: [],
          resolution: undefined
        };

    const adminPolicySupported = enforceAdminPolicy ? capabilityChecks.hasAdminPolicyFlag : true;
    const requiredOutputFormatsSupported = capabilityChecks.supportsRequiredOutputFormats;

    if (geminiOnPath && capabilityChecks.probeSucceeded) {
      const resolveAuth = deps?.checkGeminiAuthFn ?? checkGeminiAuth;
      const auth = await resolveAuth();
      authConfigured = auth.configured;
      authStatus = auth.status;
      authMethod = auth.method;
      authLaunchFailed = auth.launchFailed ?? false;
      authResolution = auth.resolution;
    }

    const resolutionDiagnostics = capabilityChecks.resolution ?? authResolution;

    const warnings: string[] = [];
    if (!geminiOnPath) {
      warnings.push("Gemini CLI not found on PATH. Install with: npm install -g @google/gemini-cli");
    }
    if (geminiOnPath && authStatus === "unauthenticated") {
      warnings.push("Gemini CLI authentication not configured. Run 'gemini' and select 'Login with Google'.");
    }
    if (geminiOnPath && capabilityChecks.probeSucceeded && authStatus === "unknown") {
      warnings.push("Gemini CLI authentication status is unknown due to ambiguous probe failure.");
    }
    if (geminiOnPath && capabilityChecks.probeSucceeded && authLaunchFailed) {
      warnings.push("Gemini CLI auth probe failed due to launch-path issues. Resolve command launching before auth validation.");
    }
    if (enforceAdminPolicy && !policyFilePresent) {
      warnings.push("Read-only admin policy file missing. Expected: policies/read-only-enforcement.toml");
    }
    if (geminiOnPath && !capabilityChecks.probeSucceeded && capabilityChecks.launchFailed) {
      warnings.push(
        "Gemini CLI launch probe failed before capability checks. Verify command launching on this platform and run 'gemini --help' manually."
      );
    }
    if (geminiOnPath && !capabilityChecks.probeSucceeded && !capabilityChecks.launchFailed) {
      warnings.push("Gemini CLI capability probe failed before validation. Retry diagnostics after verifying CLI/network health.");
    }
    if (
      geminiOnPath &&
      resolutionDiagnostics?.attemptSucceeded === "cmd_shell" &&
      resolutionDiagnostics.fallbacksAttempted.includes("cmd_shim")
    ) {
      warnings.push(
        "Gemini CLI resolves only through cmd /c fallback. For better performance and security, configure host command to use the .cmd shim directly."
      );
    }
    if (enforceAdminPolicy && geminiOnPath && capabilityChecks.probeSucceeded && !adminPolicySupported) {
      warnings.push("Gemini CLI does not support --admin-policy. Upgrade to v0.36.0 or newer.");
    }
    if (geminiOnPath && capabilityChecks.probeSucceeded && !requiredOutputFormatsSupported) {
      warnings.push("Gemini CLI does not support required output formats (json, stream-json). Upgrade to v0.36.0 or newer.");
    }
    if (!enforceAdminPolicy) {
      warnings.push("Strict admin policy enforcement disabled by GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY=0.");
    }

    const diagnostics: Diagnostics = {
      projectRoot,
      geminiOnPath,
      geminiVersion,
      authConfigured,
      authStatus,
      readOnlyModeEnforced: enforceAdminPolicy && policyFilePresent && adminPolicySupported,
      ...(resolutionDiagnostics && {
        resolution: {
          command: resolutionDiagnostics.command,
          attemptSucceeded: resolutionDiagnostics.attemptSucceeded,
          resolvedPath: resolutionDiagnostics.resolvedPath,
          fallbacksAttempted: resolutionDiagnostics.fallbacksAttempted,
          ...(resolutionDiagnostics.configuredCommand && {
            configuredCommand: resolutionDiagnostics.configuredCommand,
          }),
          ...(resolutionDiagnostics.configuredArgsPrefix && {
            configuredArgsPrefix: Logger.sanitize(resolutionDiagnostics.configuredArgsPrefix),
          }),
        },
      }),
      ...(authMethod && { authMethod }),
      ...(warnings.length > 0 && { warnings }),
    };

    const status: HealthCheckResponse["status"] =
      geminiOnPath &&
      capabilityChecks.probeSucceeded &&
      requiredOutputFormatsSupported &&
      authConfigured &&
      (!enforceAdminPolicy || (policyFilePresent && adminPolicySupported))
        ? "ok"
        : "degraded";

    Logger.info(`health_check: Diagnostics completed - status=${status}`);

    return {
      tool: "health_check",
      status,
      server: {
        name: SERVER_INFO.NAME,
        version: SERVER_INFO.VERSION,
      },
      diagnostics,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Logger.error(`health_check: Diagnostics failed - ${errorMessage}`);

    return {
      error: {
        code: ERROR_CODES.INTERNAL,
        message: `Health check failed: ${errorMessage}`,
        details: { phase: "diagnostics" },
      },
    };
  }
}

export async function runHealthCheck(args: HealthCheckArgs, deps?: HealthCheckDeps): Promise<string> {
  const response = await executeHealthCheck(args, deps);
  return JSON.stringify(response, null, 2);
}

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

  execute: async (args, _onProgress) => runHealthCheck(args as HealthCheckArgs),
};
