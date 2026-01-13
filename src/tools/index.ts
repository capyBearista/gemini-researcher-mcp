/**
 * Tool Registry Exports for Better Gemini MCP Server
 *
 * This file registers all tools and exports registry functions.
 * Tools are imported and added to the toolRegistry array here.
 */

import { toolRegistry } from "./registry.js";

// ============================================================================
// Tool Imports
// ============================================================================

import { quickQueryTool } from "./quick-query.tool.js";
import { deepResearchTool } from "./deep-research.tool.js";
import { analyzeDirectoryTool } from "./analyze-directory.tool.js";
import { validatePathsTool } from "./validate-paths.tool.js";
import { healthCheckTool } from "./health-check.tool.js";
import { fetchChunkTool } from "./fetch-chunk.tool.js";

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.push(
  quickQueryTool,
  deepResearchTool,
  analyzeDirectoryTool,
  validatePathsTool,
  healthCheckTool,
  fetchChunkTool
);

// ============================================================================
// Exports
// ============================================================================

// Re-export everything from registry
export * from "./registry.js";

// Export the registry for direct access if needed
export { toolRegistry };

// Export individual tools for direct access
export { quickQueryTool } from "./quick-query.tool.js";
export { deepResearchTool } from "./deep-research.tool.js";
export { analyzeDirectoryTool } from "./analyze-directory.tool.js";
export { validatePathsTool } from "./validate-paths.tool.js";
export { healthCheckTool } from "./health-check.tool.js";
export { fetchChunkTool } from "./fetch-chunk.tool.js";
