/**
 * Deep Research Tool
 *
 * Sends a heavyweight research prompt to Gemini CLI for in-depth analysis.
 * Uses pro model for deeper reasoning with larger context windows.
 */

import { z } from "zod";
import type { UnifiedTool } from "./registry.js";
import type { DeepResearchArgs } from "../types.js";
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

const deepResearchSchema = z.object({
  prompt: z.string().describe("Complex research question or analysis request"),
  focus: z
    .enum(["security", "architecture", "performance", "general"])
    .optional()
    .describe("Optional focus area to guide analysis"),
  citationMode: z
    .enum(["none", "paths_only"])
    .optional()
    .default("none")
    .describe("Include file citations in response"),
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
// Citation Mode Instructions
// ============================================================================

const CITATION_INSTRUCTIONS: Record<string, string> = {
  none: "",
  paths_only:
    "Include a '## Files Referenced' section at the end of your response listing all file paths you examined or referenced in your analysis.",
};

// ============================================================================
// Tool Implementation
// ============================================================================

export const deepResearchTool: UnifiedTool = {
  name: "deep_research",
  description:
    "Perform comprehensive codebase analysis across multiple files with deep reasoning. Preferred for complex architectural questions or multi-file investigation. Example: {prompt: 'Trace authentication flow from @src/routes to @src/middleware', focus: 'architecture', citationMode: 'paths_only'}",
  zodSchema: deepResearchSchema,
  category: "query",

  execute: async (args, onProgress) => {
    const startTime = Date.now();
    const { prompt, focus, citationMode } = args as DeepResearchArgs;
    const projectRoot = getProjectRoot();

    Logger.info(`deep_research: Starting with focus=${focus || "none"}, citationMode=${citationMode || "none"}`);

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

    // Build the full prompt with focus and citation instructions
    let fullPrompt = prompt;

    if (focus && focus !== "general") {
      fullPrompt = `${FOCUS_INSTRUCTIONS[focus]}\n\n${fullPrompt}`;
    }

    if (citationMode && citationMode !== "none") {
      fullPrompt = `${fullPrompt}\n\n${CITATION_INSTRUCTIONS[citationMode]}`;
    }

    try {
      // Execute Gemini CLI with deep_research tool (uses pro model)
      const result = await executeGeminiCLI(fullPrompt, "deep_research", onProgress);

      // Handle chunking if needed
      let answer = result.answer;
      let chunks: { cacheKey: string; current: number; total: number } | undefined;

      if (needsChunking(result.answer)) {
        const chunked = chunkResponse(result.answer);
        const cacheKey = cacheResponse(chunked);
        chunks = { cacheKey, current: 1, total: chunked.length };
        answer = chunked[0].content;
        Logger.debug(`deep_research: Response chunked into ${chunked.length} chunks, cacheKey=${cacheKey}`);
      }

      const latencyMs = Date.now() - startTime;

      // Build response
      const response = {
        tool: "deep_research",
        model: result.model,
        focus: focus || "general",
        citationMode: citationMode || "none",
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

      Logger.info(`deep_research: Completed in ${latencyMs}ms`);
      return JSON.stringify(response, null, 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(`deep_research: Failed - ${errorMessage}`);

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
              tool: "deep_research",
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
