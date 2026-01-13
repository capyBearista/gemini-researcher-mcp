/**
 * Quick Query Tool
 *
 * Sends a lightweight research prompt to Gemini CLI for fast analysis.
 * Uses flash model for speed and cost efficiency.
 */

import { z } from "zod";
import type { UnifiedTool } from "./registry.js";
import type { QuickQueryArgs } from "../types.js";
import { ERROR_CODES, ERROR_MESSAGES } from "../constants.js";
import type { ErrorCode } from "../constants.js";
import {
  executeGeminiCLI,
  getProjectRoot,
  checkPromptPathsValid,
  chunkResponse,
  needsChunking,
  cacheResponse,
  Logger,
} from "../utils/index.js";

// ============================================================================
// Schema
// ============================================================================

const quickQuerySchema = z.object({
  prompt: z.string().describe("Research question or analysis request"),
  focus: z
    .enum(["security", "architecture", "performance", "general"])
    .optional()
    .describe("Optional focus area to guide analysis"),
  responseStyle: z
    .enum(["concise", "normal", "detailed"])
    .optional()
    .default("normal")
    .describe("Desired verbosity of response"),
});

// ============================================================================
// Focus Area Instructions
// ============================================================================

const FOCUS_INSTRUCTIONS: Record<string, string> = {
  security: "Focus on security implications, vulnerabilities, attack vectors, and security best practices.",
  architecture: "Focus on architectural patterns, design decisions, component relationships, and structural concerns.",
  performance: "Focus on performance characteristics, bottlenecks, optimization opportunities, and efficiency.",
  general: "", // No additional focus instructions
};

// ============================================================================
// Response Style Instructions
// ============================================================================

const STYLE_INSTRUCTIONS: Record<string, string> = {
  concise: "Provide a brief, focused response with only essential information.",
  normal: "Provide a balanced response with key details and explanations.",
  detailed: "Provide a comprehensive response with thorough analysis and examples.",
};

// ============================================================================
// Tool Implementation
// ============================================================================

export const quickQueryTool: UnifiedTool = {
  name: "quick_query",
  description:
    "Analyze code/files quickly using Gemini's large context window. Preferred when questions mention specific files or require reading repository code. Example: {prompt: 'Explain @src/auth.ts security approach', focus: 'security', responseStyle: 'concise'}",
  zodSchema: quickQuerySchema,
  category: "query",

  execute: async (args, onProgress) => {
    const startTime = Date.now();
    const { prompt, focus, responseStyle } = args as QuickQueryArgs;
    const projectRoot = getProjectRoot();

    Logger.info(`quick_query: Starting with focus=${focus || "none"}, style=${responseStyle || "normal"}`);

    // Validate prompt
    if (!prompt || prompt.trim().length === 0) {
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.INVALID_ARGUMENT,
            message: ERROR_MESSAGES.NO_PROMPT_PROVIDED,
            details: { field: "prompt" },
          },
        },
        null,
        2
      );
    }

    // Pre-validate @path references (optional but recommended)
    const pathValidation = checkPromptPathsValid(prompt, projectRoot);
    if (!pathValidation.isValid) {
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.PATH_NOT_ALLOWED,
            message: "Invalid @path references in prompt",
            details: {
              invalidPaths: pathValidation.invalidPaths,
              nextStep: "Use validate_paths tool to check which paths are accessible, or adjust paths to be within project root",
            },
          },
        },
        null,
        2
      );
    }

    // Build the full prompt with focus and style instructions
    let fullPrompt = prompt;

    if (focus && focus !== "general") {
      fullPrompt = `${FOCUS_INSTRUCTIONS[focus]}\n\n${fullPrompt}`;
    }

    if (responseStyle && responseStyle !== "normal") {
      fullPrompt = `${STYLE_INSTRUCTIONS[responseStyle]}\n\n${fullPrompt}`;
    }

    try {
      // Execute Gemini CLI
      const result = await executeGeminiCLI(fullPrompt, "quick_query", onProgress);

      // Handle chunking if needed
      let answer = result.answer;
      let chunks: { cacheKey: string; current: number; total: number } | undefined;

      if (needsChunking(result.answer)) {
        const chunked = chunkResponse(result.answer);
        const cacheKey = cacheResponse(chunked);
        chunks = { cacheKey, current: 1, total: chunked.length };
        answer = chunked[0].content;
        Logger.debug(`quick_query: Response chunked into ${chunked.length} chunks, cacheKey=${cacheKey}`);
      }

      const latencyMs = Date.now() - startTime;

      // Build response
      const response = {
        tool: "quick_query",
        model: result.model,
        focus: focus || "general",
        responseStyle: responseStyle || "normal",
        answer,
        filesAccessed: result.filesAccessed,
        stats: {
          tokensUsed: result.stats.tokensUsed,
          toolCalls: result.stats.toolCalls,
          latencyMs,
        },
        ...(chunks && { chunks }),
        meta: {
          projectRoot,
          truncated: false,
          warnings: chunks ? ["Response chunked due to size. Use fetch_chunk tool to retrieve remaining content."] : [],
        },
      };

      Logger.info(`quick_query: Completed in ${latencyMs}ms`);
      return JSON.stringify(response, null, 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(`quick_query: Failed - ${errorMessage}`);

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
        nextStep = "Quota exhausted after fallback. Wait for quota reset or upgrade plan. Consider using quick_query for lighter tasks.";
      }

      return JSON.stringify(
        {
          error: {
            code,
            message: errorMessage,
            details: {
              tool: "quick_query",
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
