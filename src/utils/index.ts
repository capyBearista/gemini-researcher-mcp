/**
 * Utility module exports for Better Gemini MCP Server
 */

// Logging
export { Logger } from "./logger.js";

// Command execution
export {
  executeCommand,
  commandExists,
  getCommandVersion,
} from "./commandExecutor.js";

// Gemini CLI execution
export {
  executeGeminiCLI,
  isGeminiCLIInstalled,
  getGeminiVersion,
  checkGeminiAuth,
  validateGeminiSetup,
  type GeminiResponse,
  type ToolName,
} from "./geminiExecutor.js";

// Path validation
export {
  validatePath,
  isWithinProjectRoot,
  extractAtPathReferences,
  validatePromptPaths,
  checkPromptPathsValid,
  getProjectRoot,
} from "./pathValidator.js";

// Ignore patterns
export {
  HARD_CODED_IGNORES,
  parseGitignore,
  isIgnored,
  createIgnoreFilter,
  enumerateDirectory,
  enumerateFiles,
  type DirectoryEnumerationEntry,
} from "./ignorePatterns.js";

// Response caching
export {
  generateCacheKey,
  cacheResponse,
  getResponse,
  getChunk,
  hasValidCache,
  getCacheMetadata,
  deleteCache,
  clearExpired,
  clearAll,
  getCacheStats,
} from "./responseCache.js";

// Response chunking
export {
  chunkResponse,
  needsChunking,
  estimateChunkCount,
  getChunkSizeKB,
} from "./responseChunker.js";
