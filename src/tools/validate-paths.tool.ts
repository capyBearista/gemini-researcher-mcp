/**
 * Validate Paths Tool
 *
 * Preflight check for @path references (existence + within project root).
 * This is a pure validation utility that does not invoke Gemini CLI.
 */

import { z } from "zod";
import type { UnifiedTool } from "./registry.js";
import type { ValidatePathsArgs, ValidatePathsResponse } from "../types.js";
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
    "Verify file paths exist and are accessible before analysis. Use when uncertain about path correctness or troubleshooting 'PATH_NOT_ALLOWED' errors. Example: {paths: ['src/auth.ts', 'config/database.js', '../README.md']}",
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
        } satisfies ValidatePathsResponse,
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
      } satisfies ValidatePathsResponse,
      null,
      2
    );
  },
};
