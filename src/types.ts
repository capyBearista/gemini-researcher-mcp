/**
 * Shared TypeScript types for Better Gemini MCP Server
 */

import type { ErrorCode } from "./constants.js";

// ============================================================================
// Tool Arguments
// ============================================================================

/**
 * Base interface for tool arguments
 * Tools extend this with their specific parameters
 */
export interface ToolArguments {
  [key: string]: string | boolean | number | string[] | undefined;
}

/**
 * Arguments for quick_query tool
 */
export interface QuickQueryArgs extends ToolArguments {
  prompt: string;
  focus?: "security" | "architecture" | "performance" | "general";
  responseStyle?: "concise" | "normal" | "detailed";
}

/**
 * Arguments for deep_research tool
 */
export interface DeepResearchArgs extends ToolArguments {
  prompt: string;
  focus?: "security" | "architecture" | "performance" | "general";
  citationMode?: "none" | "paths_only";
}

/**
 * Arguments for analyze_directory tool
 */
export interface AnalyzeDirectoryArgs extends ToolArguments {
  path: string;
  depth?: number;
  maxFiles?: number;
}

/**
 * Arguments for validate_paths tool
 */
export interface ValidatePathsArgs extends ToolArguments {
  paths: string[];
}

/**
 * Arguments for health_check tool
 */
export interface HealthCheckArgs extends ToolArguments {
  includeDiagnostics?: boolean;
}

/**
 * Arguments for fetch_chunk tool
 */
export interface FetchChunkArgs extends ToolArguments {
  cacheKey: string;
  chunkIndex: number;
}

// ============================================================================
// Tool Response Types
// ============================================================================

/**
 * Statistics for a tool execution
 */
export interface ToolStats {
  tokensUsed?: number;
  toolCalls?: number;
  latencyMs: number;
}

/**
 * Chunking metadata (present when response is chunked)
 */
export interface ChunkInfo {
  cacheKey: string;
  current: number;
  total: number;
}

/**
 * Metadata included in tool responses
 */
export interface ResponseMeta {
  projectRoot: string;
  truncated: boolean;
  warnings: string[];
}

/**
 * Base structure for successful tool responses
 */
export interface BaseToolResponse {
  tool: string;
  meta: ResponseMeta;
}

/**
 * Response structure for quick_query and deep_research tools
 */
export interface QueryToolResponse extends BaseToolResponse {
  model: string;
  focus?: string;
  responseStyle?: string;
  citationMode?: string;
  answer: string;
  filesAccessed: string[];
  stats: ToolStats;
  chunks?: ChunkInfo;
}

/**
 * Directory entry in analyze_directory response
 */
export interface DirectoryEntry {
  path: string;
  summary: string;
}

/**
 * Response structure for analyze_directory tool
 */
export interface AnalyzeDirectoryResponse extends BaseToolResponse {
  directory: string;
  entries: DirectoryEntry[];
  meta: ResponseMeta & {
    excluded: string[];
    fileCount: number;
    depthTraversed: number;
  };
}

/**
 * Path validation result
 */
export interface PathValidationResult {
  input: string;
  resolved: string;
  exists: boolean;
  allowed: boolean;
  reason?: string;
}

/**
 * Response structure for validate_paths tool
 * Note: Does not include meta field (simpler utility response)
 */
export interface ValidatePathsResponse {
  tool: string;
  results: PathValidationResult[];
}

/**
 * Diagnostics information for health_check tool
 */
export interface Diagnostics {
  projectRoot: string;
  geminiOnPath: boolean;
  geminiVersion?: string | null;
  authConfigured: boolean;
  authMethod?: string;
  readOnlyModeEnforced: boolean;
  gitIgnoreRespected?: boolean;
  warnings?: string[];
}

/**
 * Response structure for health_check tool
 * Note: Does not include meta field (simpler utility response)
 */
export interface HealthCheckResponse {
  tool: string;
  status: "ok" | "degraded" | "error";
  server: {
    name: string;
    version: string;
  };
  diagnostics?: Diagnostics;
}

/**
 * Response structure for fetch_chunk tool
 * Note: Has simplified meta with just expiresAt
 */
export interface FetchChunkResponse {
  tool: string;
  cacheKey: string;
  chunk: {
    index: number;
    total: number;
    content: string;
  };
  meta: {
    expiresAt: string;
  };
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Structured error response
 */
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ============================================================================
// Gemini CLI Types
// ============================================================================

/**
 * Model tier configuration
 */
export interface ModelTier {
  tier1: string;
  tier2: string;
  tier3: null; // Auto-select
}

/**
 * Gemini CLI execution result
 */
export interface GeminiExecutionResult {
  success: boolean;
  output: string;
  model: string;
  tokensUsed?: number;
  toolCalls?: number;
  filesAccessed?: string[];
  error?: string;
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cached chunk data
 */
export interface CachedChunk {
  content: string;
  index: number;
  total: number;
}

/**
 * Cache entry for chunked responses
 */
export interface CacheEntry {
  chunks: CachedChunk[];
  createdAt: number;
  expiresAt: number;
}

// ============================================================================
// Progress Types
// ============================================================================

/**
 * Progress callback function type
 */
export type ProgressCallback = (output: string) => void;
