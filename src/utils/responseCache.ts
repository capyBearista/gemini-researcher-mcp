/**
 * Response cache utility for chunked responses
 *
 * Implements in-memory cache with 1-hour TTL for large response chunks.
 */

import type { CacheEntry, CachedChunk } from "../types.js";
import { DEFAULTS } from "../constants.js";

/**
 * In-memory cache storage
 */
const cache = new Map<string, CacheEntry>();

/**
 * Generate a unique cache key
 *
 * @returns Cache key in format "cache_<random>"
 */
export function generateCacheKey(): string {
  const random = Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now().toString(36);
  return `cache_${timestamp}${random}`;
}

/**
 * Store chunked response in cache
 *
 * @param chunks - Array of cached chunks to store
 * @param ttlMs - Time-to-live in milliseconds (default: 1 hour)
 * @returns The generated cache key
 */
export function cacheResponse(
  chunks: CachedChunk[],
  ttlMs: number = DEFAULTS.CACHE_TTL_MS
): string {
  const key = generateCacheKey();
  const now = Date.now();

  const entry: CacheEntry = {
    chunks,
    createdAt: now,
    expiresAt: now + ttlMs,
  };

  cache.set(key, entry);

  // Schedule cleanup of expired entries
  scheduleCleanup();

  return key;
}

/**
 * Retrieve cached response by key
 *
 * @param key - The cache key
 * @returns CacheEntry if found and not expired, null otherwise
 */
export function getResponse(key: string): CacheEntry | null {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry;
}

/**
 * Get a specific chunk from cached response
 *
 * @param key - The cache key
 * @param chunkIndex - 1-based chunk index
 * @returns The chunk if found, null otherwise
 */
export function getChunk(key: string, chunkIndex: number): CachedChunk | null {
  const entry = getResponse(key);

  if (!entry) {
    return null;
  }

  // Validate chunk index (1-based)
  if (chunkIndex < 1 || chunkIndex > entry.chunks.length) {
    return null;
  }

  return entry.chunks[chunkIndex - 1];
}

/**
 * Check if a cache key exists and is valid
 *
 * @param key - The cache key
 * @returns true if key exists and not expired
 */
export function hasValidCache(key: string): boolean {
  return getResponse(key) !== null;
}

/**
 * Get cache entry metadata without full content
 *
 * @param key - The cache key
 * @returns Metadata object or null if not found
 */
export function getCacheMetadata(
  key: string
): { totalChunks: number; expiresAt: Date; createdAt: Date } | null {
  const entry = getResponse(key);

  if (!entry) {
    return null;
  }

  return {
    totalChunks: entry.chunks.length,
    expiresAt: new Date(entry.expiresAt),
    createdAt: new Date(entry.createdAt),
  };
}

/**
 * Delete a cache entry
 *
 * @param key - The cache key to delete
 * @returns true if entry was deleted
 */
export function deleteCache(key: string): boolean {
  return cache.delete(key);
}

/**
 * Clear all expired cache entries
 *
 * @returns Number of entries removed
 */
export function clearExpired(): number {
  const now = Date.now();
  let removed = 0;

  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key);
      removed++;
    }
  }

  return removed;
}

/**
 * Clear the entire cache
 */
export function clearAll(): void {
  cache.clear();
}

/**
 * Get current cache statistics
 *
 * @returns Object with cache stats
 */
export function getCacheStats(): {
  size: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
} {
  let oldest: number | null = null;
  let newest: number | null = null;

  for (const entry of cache.values()) {
    if (oldest === null || entry.createdAt < oldest) {
      oldest = entry.createdAt;
    }
    if (newest === null || entry.createdAt > newest) {
      newest = entry.createdAt;
    }
  }

  return {
    size: cache.size,
    oldestEntry: oldest ? new Date(oldest) : null,
    newestEntry: newest ? new Date(newest) : null,
  };
}

// ============================================================================
// Cleanup scheduling
// ============================================================================

let cleanupScheduled = false;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Schedule periodic cleanup of expired entries
 */
function scheduleCleanup(): void {
  if (cleanupScheduled) {
    return;
  }

  cleanupScheduled = true;

  // Use unref() so the timer doesn't keep the process alive
  const timer = setInterval(() => {
    clearExpired();

    // Stop cleanup if cache is empty
    if (cache.size === 0) {
      clearInterval(timer);
      cleanupScheduled = false;
    }
  }, CLEANUP_INTERVAL_MS);

  timer.unref();
}
