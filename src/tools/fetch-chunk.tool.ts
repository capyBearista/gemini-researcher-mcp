/**
 * Fetch Chunk Tool
 *
 * Retrieves a specific chunk of a large response that was previously split.
 * Used to continue receiving chunked responses after initial tool calls.
 */

import { z } from "zod";
import type { UnifiedTool } from "./registry.js";
import type { FetchChunkArgs, FetchChunkResponse } from "../types.js";
import { ERROR_CODES, ERROR_MESSAGES } from "../constants.js";
import { getResponse, getChunk, getCacheMetadata, Logger } from "../utils/index.js";

// ============================================================================
// Schema
// ============================================================================

const fetchChunkSchema = z.object({
  cacheKey: z.string().describe("Cache key returned in initial chunked response"),
  chunkIndex: z
    .number()
    .int()
    .positive()
    .describe("1-based index of chunk to retrieve"),
});

// ============================================================================
// Tool Implementation
// ============================================================================

export const fetchChunkTool: UnifiedTool = {
  name: "fetch_chunk",
  description:
    "Retrieve continuation of a large response. Use when a previous tool response included 'chunks' metadata indicating more content available. Example: {cacheKey: 'cache_abc123', chunkIndex: 2}",
  zodSchema: fetchChunkSchema,
  category: "utility",

  execute: async (args, _onProgress) => {
    const { cacheKey, chunkIndex } = args as FetchChunkArgs;

    Logger.info(`fetch_chunk: Fetching chunk ${chunkIndex} for cacheKey=${cacheKey}`);

    // Validate cacheKey
    if (!cacheKey || typeof cacheKey !== "string") {
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.INVALID_ARGUMENT,
            message: "cacheKey must be a non-empty string",
            details: { field: "cacheKey" },
          },
        },
        null,
        2
      );
    }

    // Validate chunkIndex
    if (!Number.isInteger(chunkIndex) || chunkIndex < 1) {
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.INVALID_ARGUMENT,
            message: "chunkIndex must be a positive integer (1-based)",
            details: { field: "chunkIndex", provided: chunkIndex },
          },
        },
        null,
        2
      );
    }

    // Check if cache entry exists
    const cacheEntry = getResponse(cacheKey);
    if (!cacheEntry) {
      Logger.warn(`fetch_chunk: Cache key not found or expired: ${cacheKey}`);
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.CACHE_EXPIRED,
            message: ERROR_MESSAGES.CACHE_EXPIRED,
            details: {
              cacheKey,
              nextStep: "Cache expired (1-hour TTL). Re-run the original query to regenerate the response.",
            },
          },
        },
        null,
        2
      );
    }

    // Get cache metadata for total chunks
    const metadata = getCacheMetadata(cacheKey);
    if (!metadata) {
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.CACHE_EXPIRED,
            message: ERROR_MESSAGES.CACHE_EXPIRED,
            details: {
              cacheKey,
              nextStep: "Cache expired (1-hour TTL). Re-run the original query to regenerate the response.",
            },
          },
        },
        null,
        2
      );
    }

    // Validate chunk index is within range
    if (chunkIndex > metadata.totalChunks) {
      Logger.warn(`fetch_chunk: Chunk index ${chunkIndex} out of range (total: ${metadata.totalChunks})`);
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.INVALID_CHUNK_INDEX,
            message: ERROR_MESSAGES.INVALID_CHUNK_INDEX,
            details: {
              requestedIndex: chunkIndex,
              totalChunks: metadata.totalChunks,
              nextStep: `Request a chunk index between 1 and ${metadata.totalChunks}`,
            },
          },
        },
        null,
        2
      );
    }

    // Get the specific chunk
    const chunk = getChunk(cacheKey, chunkIndex);
    if (!chunk) {
      return JSON.stringify(
        {
          error: {
            code: ERROR_CODES.INTERNAL,
            message: "Failed to retrieve chunk from cache",
            details: { cacheKey, chunkIndex },
          },
        },
        null,
        2
      );
    }

    // Build response with proper typing
    const response: FetchChunkResponse = {
      tool: "fetch_chunk",
      cacheKey,
      chunk: {
        index: chunkIndex,
        total: metadata.totalChunks,
        content: chunk.content,
      },
      meta: {
        expiresAt: metadata.expiresAt.toISOString(),
      },
    };

    Logger.info(`fetch_chunk: Successfully retrieved chunk ${chunkIndex}/${metadata.totalChunks}`);
    return JSON.stringify(response, null, 2);
  },
};
