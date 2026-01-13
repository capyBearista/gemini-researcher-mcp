/**
 * Response chunker utility for splitting large responses
 *
 * Implements chunking with configurable size (default: 10KB per chunk).
 */

import type { CachedChunk } from "../types.js";
import { DEFAULTS } from "../constants.js";

/**
 * Chunk a response string into smaller pieces
 *
 * @param response - The full response string to chunk
 * @param chunkSizeKB - Size of each chunk in kilobytes (default: 10KB)
 * @returns Array of CachedChunk objects with metadata
 */
export function chunkResponse(
  response: string,
  chunkSizeKB: number = DEFAULTS.RESPONSE_CHUNK_SIZE_KB
): CachedChunk[] {
  const chunkSizeBytes = chunkSizeKB * 1024;

  // If response fits in one chunk, return single chunk
  if (response.length <= chunkSizeBytes) {
    return [
      {
        content: response,
        index: 1,
        total: 1,
      },
    ];
  }

  const chunks: CachedChunk[] = [];

  // Split at natural boundaries (newlines) when possible
  let currentPosition = 0;
  let chunkIndex = 1;

  while (currentPosition < response.length) {
    let endPosition = currentPosition + chunkSizeBytes;

    // If we're not at the end, try to find a natural break point
    if (endPosition < response.length) {
      // Look for the last newline within the chunk size
      const searchStart = Math.max(currentPosition, endPosition - 500); // Search within last 500 chars
      const lastNewline = response.lastIndexOf("\n", endPosition);

      if (lastNewline > searchStart) {
        endPosition = lastNewline + 1; // Include the newline
      }
    } else {
      endPosition = response.length;
    }

    const chunkContent = response.slice(currentPosition, endPosition);

    chunks.push({
      content: chunkContent,
      index: chunkIndex,
      total: 0, // Will be updated after all chunks are created
    });

    currentPosition = endPosition;
    chunkIndex++;
  }

  // Update total count for all chunks
  const totalChunks = chunks.length;
  for (const chunk of chunks) {
    chunk.total = totalChunks;
  }

  return chunks;
}

/**
 * Check if a response needs chunking
 *
 * @param response - The response string to check
 * @param chunkSizeKB - Chunk size threshold in KB
 * @returns true if the response exceeds the chunk size
 */
export function needsChunking(
  response: string,
  chunkSizeKB: number = DEFAULTS.RESPONSE_CHUNK_SIZE_KB
): boolean {
  const chunkSizeBytes = chunkSizeKB * 1024;
  return response.length > chunkSizeBytes;
}

/**
 * Get the number of chunks that would be created for a response
 *
 * @param response - The response string
 * @param chunkSizeKB - Chunk size in KB
 * @returns Estimated number of chunks
 */
export function estimateChunkCount(
  response: string,
  chunkSizeKB: number = DEFAULTS.RESPONSE_CHUNK_SIZE_KB
): number {
  const chunkSizeBytes = chunkSizeKB * 1024;
  return Math.ceil(response.length / chunkSizeBytes);
}

/**
 * Get the chunk size configuration from environment or default
 *
 * @returns Chunk size in KB
 */
export function getChunkSizeKB(): number {
  const envValue = process.env.RESPONSE_CHUNK_SIZE_KB;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULTS.RESPONSE_CHUNK_SIZE_KB;
}
