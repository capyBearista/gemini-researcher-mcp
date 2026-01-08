/**
 * Validate Paths Tool
 * Preflight check for @path references (existence + within project root)
 * NO Gemini CLI invocation - pure validation utility (PRD §5.5)
 */

import { z } from "zod";
import type { UnifiedTool } from "./registry.js";
import type { ValidatePathsArgs } from "../types.js";
import { ERROR_CODES } from "../constants.js";
import { validatePath, getProjectRoot, Logger } from "../utils/index.js";

// ============================================================================
// Schema
// ============================================================================

const validatePathsSchema = z.object({
  paths: z.array(z.string()).describe("Array of paths to validate"),
});

// ============================================================================
// Tool Implementation
// ============================================================================

export const validatePathsTool: UnifiedTool = {
  name: "validate_paths",
  description:
    "Preflight check for @path references. Validates existence and project root restriction so agents can correct paths quickly before invoking research tools.",
  zodSchema: validatePathsSchema,
  category: "utility",

  execute: async (args, _onProgress) => {
    const { paths } = args as ValidatePathsArgs;
    const projectRoot = getProjectRoot();

    Logger.info(`validate_paths: Validating ${paths.length} paths`);

    // Validate input
    if (!Array.isArray(paths)) {
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.INVALID_ARGUMENT,
            message: "paths must be an array of strings",
            details: { field: "paths" },
          },
        },
        null,
        2
      );
    }

    if (paths.length === 0) {
      return JSON.stringify(
        {
          tool: "validate_paths",
          results: [],
        },
        null,
        2
      );
    }

    // Validate each path
    const results = paths.map((inputPath) => {
      const validation = validatePath(inputPath, projectRoot);
      return {
        input: inputPath,
        resolved: validation.resolved,
        exists: validation.exists,
        allowed: validation.allowed,
        ...(validation.reason && { reason: validation.reason }),
      };
    });

    // Log summary
    const validCount = results.filter((r) => r.allowed && r.exists).length;
    const invalidCount = results.length - validCount;
    Logger.info(`validate_paths: Completed - ${validCount} valid, ${invalidCount} invalid`);

    return JSON.stringify(
      {
        tool: "validate_paths",
        results,
      },
      null,
      2
    );
  },
};
