/**
 * Analyze Directory Tool
 *
 * Provides a high-level map of a directory while respecting ignore rules.
 * Uses flash model for speed.
 */

import * as path from "path";
import { z } from "zod";
import type { UnifiedTool } from "./registry.js";
import type { AnalyzeDirectoryArgs } from "../types.js";
import { ERROR_CODES, DEFAULTS } from "../constants.js";
import type { ErrorCode } from "../constants.js";
import {
  executeGeminiCLI,
  getProjectRoot,
  isWithinProjectRoot,
  enumerateDirectory,
  Logger,
} from "../utils/index.js";

// ============================================================================
// Schema
// ============================================================================

const analyzeDirectorySchema = z.object({
  path: z.string().describe("Relative or absolute path to directory"),
  depth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum traversal depth (default: unlimited)"),
  maxFiles: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum files to enumerate (default: 500)"),
});

// ============================================================================
// Types
// ============================================================================

interface DirectoryEntry {
  path: string;
  summary: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse Gemini's response to extract file summaries
 */
function parseFileSummaries(
  response: string,
  files: string[]
): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];

  // Try to parse structured response
  // Look for patterns like "- path/to/file.ts: Summary text"
  // or "**path/to/file.ts**: Summary text"
  const lines = response.split("\n");

  for (const line of lines) {
    // Pattern: "- file.ts: Summary" or "* file.ts: Summary"
    const bulletMatch = line.match(/^[-*]\s*([^:]+):\s*(.+)$/);
    if (bulletMatch) {
      const filePath = bulletMatch[1].trim().replace(/\*\*/g, "");
      const summary = bulletMatch[2].trim();
      if (files.some((f) => f.includes(filePath) || filePath.includes(f))) {
        entries.push({ path: filePath, summary });
        continue;
      }
    }

    // Pattern: "**file.ts**: Summary"
    const boldMatch = line.match(/^\*\*([^*]+)\*\*:\s*(.+)$/);
    if (boldMatch) {
      const filePath = boldMatch[1].trim();
      const summary = boldMatch[2].trim();
      entries.push({ path: filePath, summary });
    }
  }

  // If we couldn't parse structured entries, create basic entries
  if (entries.length === 0) {
    for (const file of files) {
      entries.push({
        path: file,
        summary: "File found in directory (see Gemini response for details)",
      });
    }
  }

  return entries;
}

// ============================================================================
// Tool Implementation
// ============================================================================

export const analyzeDirectoryTool: UnifiedTool = {
  name: "analyze_directory",
  description:
    "Map repository structure and understand what each file/module does. Preferred when questions ask about project organization or 'what's in this directory'. Example: {path: './src', depth: 3, maxFiles: 100}",
  zodSchema: analyzeDirectorySchema,
  category: "utility",

  execute: async (args, onProgress) => {
    const startTime = Date.now();
    const { path: inputPath, depth, maxFiles } = args as AnalyzeDirectoryArgs;
    const projectRoot = getProjectRoot();

    Logger.info(`analyze_directory: Starting for path=${inputPath}, depth=${depth}, maxFiles=${maxFiles}`);

    // Resolve path relative to project root
    let resolvedPath: string;
    if (path.isAbsolute(inputPath)) {
      resolvedPath = path.resolve(inputPath);
    } else {
      resolvedPath = path.resolve(projectRoot, inputPath);
    }

    // Validate path is within project root
    if (!isWithinProjectRoot(resolvedPath, projectRoot)) {
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.PATH_NOT_ALLOWED,
            message: `Path '${inputPath}' is outside project root`,
            details: {
              resolved: resolvedPath,
              projectRoot,
              nextStep: "Use validate_paths tool to check which paths are accessible, or adjust path to be within project root",
            },
          },
        },
        null,
        2
      );
    }

    try {
      // Enumerate files in directory
      const enumResult = await enumerateDirectory(
        resolvedPath,
        projectRoot,
        maxFiles ?? DEFAULTS.MAX_FILES,
        depth ?? -1 // -1 = unlimited depth
      );

      // Filter to only files (not directories)
      const fileEntries = enumResult.entries.filter((e) => !e.isDirectory);
      const filePaths = fileEntries.map((e) => e.relativePath);

      if (filePaths.length === 0) {
        const relativePath = path.relative(projectRoot, resolvedPath) || ".";
        return JSON.stringify(
          {
            tool: "analyze_directory",
            directory: relativePath,
            entries: [],
            meta: {
              excluded: ["node_modules", ".git", "dist", "build", "..."],
              fileCount: 0,
              depthTraversed: depth ?? "unlimited",
              warnings: [
                ...enumResult.warnings,
                "No files found in directory (may be empty or all files ignored)",
              ],
            },
          },
          null,
          2
        );
      }

      // Build prompt for Gemini to summarize files
      const fileListText = filePaths.map((f) => `- ${f}`).join("\n");
      const geminiPrompt = `Analyze the following files from the directory '${inputPath}'.
For each file, provide a one-sentence summary of its responsibility.

Files to analyze:
${fileListText}

You may use @<path> syntax to read file contents if needed (e.g., @${filePaths[0]}).
Do NOT read files outside this list.

Output format:
For each file, output:
- <filepath>: <one-sentence summary>`;

      // Execute Gemini CLI
      const result = await executeGeminiCLI(geminiPrompt, "analyze_directory", onProgress);

      // Parse the response to extract file summaries
      const entries = parseFileSummaries(result.answer, filePaths);

      const latencyMs = Date.now() - startTime;
      const relativePath = path.relative(projectRoot, resolvedPath) || ".";

      // Build response
      const response = {
        tool: "analyze_directory",
        directory: relativePath,
        entries,
        meta: {
          excluded: ["node_modules", ".git", "dist", "build", "coverage", "..."],
          fileCount: filePaths.length,
          depthTraversed: depth ?? "unlimited",
          warnings: enumResult.warnings,
        },
      };

      Logger.info(`analyze_directory: Completed in ${latencyMs}ms, found ${entries.length} entries`);
      return JSON.stringify(response, null, 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(`analyze_directory: Failed - ${errorMessage}`);

      // Determine error code and provide recovery hints
      let code: ErrorCode = ERROR_CODES.GEMINI_CLI_ERROR;
      let nextStep = "Check server logs for details";

      if (errorMessage.includes("not found") || errorMessage.includes("ENOENT")) {
        code = ERROR_CODES.GEMINI_CLI_NOT_FOUND;
        nextStep = "Install Gemini CLI: npm install -g @google/gemini-cli, or run setup wizard: npx better-gemini-mcp init";
      } else if (errorMessage.includes("auth") || errorMessage.includes("login")) {
        code = ERROR_CODES.AUTH_MISSING;
        nextStep = "Authenticate Gemini CLI: run 'gemini' and select 'Login with Google', or set GEMINI_API_KEY environment variable";
      } else if (errorMessage.includes("quota")) {
        code = ERROR_CODES.QUOTA_EXCEEDED;
        nextStep = "Quota exhausted after fallback. Wait for quota reset or upgrade plan.";
      }

      return JSON.stringify(
        {
          error: {
            code,
            message: errorMessage,
            details: {
              tool: "analyze_directory",
              nextStep,
            },
          },
        },
        null,
        2
      );
    }
  },
};
