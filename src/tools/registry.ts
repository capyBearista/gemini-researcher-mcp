/**
 * Tool Registry for Better Gemini MCP Server
 * Defines the UnifiedTool interface and provides tool execution functionality
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ZodTypeAny, ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolArguments, ProgressCallback } from "../types.js";

// ============================================================================
// UnifiedTool Interface
// ============================================================================

/**
 * Unified tool definition interface
 * Each tool in the registry follows this structure
 */
export interface UnifiedTool {
  /** Tool name (snake_case, e.g., 'quick_query') */
  name: string;

  /** Human-readable description for MCP tools/list */
  description: string;

  /** Zod schema for input validation */
  zodSchema: ZodTypeAny;

  /** Execute the tool with validated arguments */
  execute: (args: ToolArguments, onProgress?: ProgressCallback) => Promise<string>;

  /** Optional category for grouping */
  category?: "query" | "utility";
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Registry of all available tools
 * Tools are added to this array in src/tools/index.ts
 */
export const toolRegistry: UnifiedTool[] = [];

// ============================================================================
// Registry Helper Functions
// ============================================================================

/**
 * Check if a tool exists in the registry
 */
export function toolExists(toolName: string): boolean {
  return toolRegistry.some((t) => t.name === toolName);
}

/**
 * Get MCP Tool definitions from the registry
 * Converts Zod schemas to JSON Schema format for MCP protocol
 */
export function getToolDefinitions(): Tool[] {
  return toolRegistry.map((tool) => {
    // Convert Zod schema to JSON Schema
    const raw = zodToJsonSchema(tool.zodSchema, tool.name) as any;
    const def = (raw.definitions?.[tool.name] ?? raw) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    // Coerce properties to the expected object map type for MCP SDK
    const properties: { [x: string]: object } = Object.fromEntries(
      Object.entries(def.properties ?? {}).map(([key, value]) => [key, (value ?? {}) as object])
    );

    const inputSchema: Tool["inputSchema"] = {
      type: "object",
      properties,
      required: def.required ?? [],
    };

    return {
      name: tool.name,
      description: tool.description,
      inputSchema,
    };
  });
}

/**
 * Execute a tool by name with the given arguments
 * Validates arguments against the tool's Zod schema before execution
 */
export async function executeTool(
  toolName: string,
  args: ToolArguments,
  onProgress?: ProgressCallback
): Promise<string> {
  const tool = toolRegistry.find((t) => t.name === toolName);

  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  try {
    // Validate arguments against Zod schema
    const validatedArgs = tool.zodSchema.parse(args) as ToolArguments;
    return await tool.execute(validatedArgs, onProgress);
  } catch (error) {
    // Handle Zod validation errors specially
    if (isZodError(error)) {
      const issues = error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");
      throw new Error(`Invalid arguments for ${toolName}: ${issues}`);
    }
    throw error;
  }
}

/**
 * Type guard for Zod errors
 */
function isZodError(error: unknown): error is ZodError {
  return (
    error !== null &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as ZodError).issues)
  );
}

/**
 * Get a tool by name from the registry
 */
export function getTool(toolName: string): UnifiedTool | undefined {
  return toolRegistry.find((t) => t.name === toolName);
}

/**
 * Register a new tool in the registry
 * This is an alternative to directly pushing to toolRegistry
 */
export function registerTool(tool: UnifiedTool): void {
  if (toolExists(tool.name)) {
    throw new Error(`Tool already registered: ${tool.name}`);
  }
  toolRegistry.push(tool);
}
