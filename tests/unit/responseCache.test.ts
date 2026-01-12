/**
 * Unit tests for responseCache utility
 * Tests 1-hour TTL and cache expiration
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import {
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
} from "../../src/utils/responseCache.js";
import type { CachedChunk } from "../../src/types.js";

describe("responseCache", () => {
  beforeEach(() => {
    // Clear cache before each test
    clearAll();
  });

  afterEach(() => {
    // Clean up after tests
    clearAll();
  });

  describe("generateCacheKey", () => {
    it("should generate unique cache keys", () => {
      const key1 = generateCacheKey();
      const key2 = generateCacheKey();
      const key3 = generateCacheKey();

      assert.notStrictEqual(key1, key2);
      assert.notStrictEqual(key2, key3);
      assert.notStrictEqual(key1, key3);
    });

    it("should generate keys with cache_ prefix", () => {
      const key = generateCacheKey();
      assert.ok(key.startsWith("cache_"), `Key should start with 'cache_', got: ${key}`);
    });

    it("should generate keys of reasonable length", () => {
      const key = generateCacheKey();
      // Should be "cache_" + timestamp (base36) + random (8 chars)
      assert.ok(key.length > 10, "Key should have reasonable length");
      assert.ok(key.length < 30, "Key should not be too long");
    });
  });

  describe("cacheResponse", () => {
    it("should store chunks and return cache key", () => {
      const chunks: CachedChunk[] = [
        { content: "Chunk 1", index: 1, total: 2 },
        { content: "Chunk 2", index: 2, total: 2 },
      ];

      const key = cacheResponse(chunks);

      assert.ok(key.startsWith("cache_"));
      assert.ok(hasValidCache(key));
    });

    it("should store chunks with custom TTL", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];

      const key = cacheResponse(chunks, 60000); // 1 minute TTL

      const metadata = getCacheMetadata(key);
      assert.ok(metadata);

      const expectedExpiry = Date.now() + 60000;
      const actualExpiry = metadata.expiresAt.getTime();

      // Allow 1 second tolerance
      assert.ok(
        Math.abs(actualExpiry - expectedExpiry) < 1000,
        "Expiry should be approximately 1 minute from now"
      );
    });

    it("should default to 1-hour TTL", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];

      const key = cacheResponse(chunks);

      const metadata = getCacheMetadata(key);
      assert.ok(metadata);

      const expectedExpiry = Date.now() + 3600000; // 1 hour
      const actualExpiry = metadata.expiresAt.getTime();

      // Allow 1 second tolerance
      assert.ok(
        Math.abs(actualExpiry - expectedExpiry) < 1000,
        "Expiry should be approximately 1 hour from now"
      );
    });
  });

  describe("getResponse", () => {
    it("should retrieve cached entry by key", () => {
      const chunks: CachedChunk[] = [
        { content: "Hello", index: 1, total: 2 },
        { content: "World", index: 2, total: 2 },
      ];

      const key = cacheResponse(chunks);
      const entry = getResponse(key);

      assert.ok(entry);
      assert.strictEqual(entry.chunks.length, 2);
      assert.strictEqual(entry.chunks[0].content, "Hello");
      assert.strictEqual(entry.chunks[1].content, "World");
    });

    it("should return null for non-existent key", () => {
      const entry = getResponse("cache_nonexistent");
      assert.strictEqual(entry, null);
    });

    it("should return null for expired entry", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];

      // Use very short TTL
      const key = cacheResponse(chunks, 1); // 1ms TTL

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait for 10ms
      }

      const entry = getResponse(key);
      assert.strictEqual(entry, null, "Expired entry should return null");
    });
  });

  describe("getChunk", () => {
    it("should retrieve specific chunk by index", () => {
      const chunks: CachedChunk[] = [
        { content: "First", index: 1, total: 3 },
        { content: "Second", index: 2, total: 3 },
        { content: "Third", index: 3, total: 3 },
      ];

      const key = cacheResponse(chunks);

      const chunk1 = getChunk(key, 1);
      const chunk2 = getChunk(key, 2);
      const chunk3 = getChunk(key, 3);

      assert.strictEqual(chunk1?.content, "First");
      assert.strictEqual(chunk2?.content, "Second");
      assert.strictEqual(chunk3?.content, "Third");
    });

    it("should return null for invalid chunk index", () => {
      const chunks: CachedChunk[] = [{ content: "Only", index: 1, total: 1 }];

      const key = cacheResponse(chunks);

      assert.strictEqual(getChunk(key, 0), null); // 0 is invalid (1-based)
      assert.strictEqual(getChunk(key, 2), null); // Out of range
      assert.strictEqual(getChunk(key, -1), null); // Negative
    });

    it("should return null for non-existent cache key", () => {
      const chunk = getChunk("cache_nonexistent", 1);
      assert.strictEqual(chunk, null);
    });

    it("should use 1-based indexing", () => {
      const chunks: CachedChunk[] = [{ content: "First", index: 1, total: 1 }];

      const key = cacheResponse(chunks);

      // Index 0 should fail (we use 1-based)
      assert.strictEqual(getChunk(key, 0), null);

      // Index 1 should work
      assert.strictEqual(getChunk(key, 1)?.content, "First");
    });
  });

  describe("hasValidCache", () => {
    it("should return true for valid cache entry", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];
      const key = cacheResponse(chunks);

      assert.strictEqual(hasValidCache(key), true);
    });

    it("should return false for non-existent key", () => {
      assert.strictEqual(hasValidCache("cache_nonexistent"), false);
    });

    it("should return false for expired entry", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];
      const key = cacheResponse(chunks, 1); // 1ms TTL

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      assert.strictEqual(hasValidCache(key), false);
    });
  });

  describe("getCacheMetadata", () => {
    it("should return metadata for cached entry", () => {
      const chunks: CachedChunk[] = [
        { content: "A", index: 1, total: 3 },
        { content: "B", index: 2, total: 3 },
        { content: "C", index: 3, total: 3 },
      ];

      const key = cacheResponse(chunks);
      const metadata = getCacheMetadata(key);

      assert.ok(metadata);
      assert.strictEqual(metadata.totalChunks, 3);
      assert.ok(metadata.createdAt instanceof Date);
      assert.ok(metadata.expiresAt instanceof Date);
      assert.ok(metadata.expiresAt > metadata.createdAt);
    });

    it("should return null for non-existent key", () => {
      const metadata = getCacheMetadata("cache_nonexistent");
      assert.strictEqual(metadata, null);
    });
  });

  describe("deleteCache", () => {
    it("should delete existing cache entry", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];
      const key = cacheResponse(chunks);

      assert.strictEqual(hasValidCache(key), true);

      const deleted = deleteCache(key);

      assert.strictEqual(deleted, true);
      assert.strictEqual(hasValidCache(key), false);
    });

    it("should return false for non-existent key", () => {
      const deleted = deleteCache("cache_nonexistent");
      assert.strictEqual(deleted, false);
    });
  });

  describe("clearExpired", () => {
    it("should remove expired entries", () => {
      // Create entry with short TTL
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];
      const shortTTLKey = cacheResponse(chunks, 1); // 1ms TTL

      // Create entry with long TTL
      const longTTLKey = cacheResponse(chunks, 3600000); // 1 hour

      // Wait for short TTL to expire
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      const removed = clearExpired();

      // At least 1 expired entry should be removed
      assert.ok(removed >= 1, `Expected at least 1 removed, got ${removed}`);

      // Long TTL entry should still be valid
      assert.strictEqual(hasValidCache(longTTLKey), true);
    });

    it("should return 0 when no expired entries", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];
      cacheResponse(chunks, 3600000); // 1 hour TTL

      const removed = clearExpired();
      assert.strictEqual(removed, 0);
    });
  });

  describe("clearAll", () => {
    it("should remove all cache entries", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];

      const key1 = cacheResponse(chunks);
      const key2 = cacheResponse(chunks);
      const key3 = cacheResponse(chunks);

      clearAll();

      assert.strictEqual(hasValidCache(key1), false);
      assert.strictEqual(hasValidCache(key2), false);
      assert.strictEqual(hasValidCache(key3), false);
    });

    it("should result in empty cache stats", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];
      cacheResponse(chunks);

      clearAll();

      const stats = getCacheStats();
      assert.strictEqual(stats.size, 0);
      assert.strictEqual(stats.oldestEntry, null);
      assert.strictEqual(stats.newestEntry, null);
    });
  });

  describe("getCacheStats", () => {
    it("should return correct stats for empty cache", () => {
      const stats = getCacheStats();

      assert.strictEqual(stats.size, 0);
      assert.strictEqual(stats.oldestEntry, null);
      assert.strictEqual(stats.newestEntry, null);
    });

    it("should track cache size", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];

      cacheResponse(chunks);
      cacheResponse(chunks);
      cacheResponse(chunks);

      const stats = getCacheStats();
      assert.strictEqual(stats.size, 3);
    });

    it("should track oldest and newest entries", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];

      cacheResponse(chunks);

      // Small delay
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait
      }

      cacheResponse(chunks);

      const stats = getCacheStats();

      assert.ok(stats.oldestEntry);
      assert.ok(stats.newestEntry);
      assert.ok(stats.oldestEntry <= stats.newestEntry);
    });
  });

  describe("1-hour TTL behavior", () => {
    it("should use default 1-hour (3600000ms) TTL", () => {
      const chunks: CachedChunk[] = [{ content: "Test", index: 1, total: 1 }];
      const key = cacheResponse(chunks);

      const metadata = getCacheMetadata(key);
      assert.ok(metadata);

      const ttl = metadata.expiresAt.getTime() - metadata.createdAt.getTime();

      // Should be 3600000ms (1 hour) with small tolerance for execution time
      assert.ok(
        Math.abs(ttl - 3600000) < 100,
        `TTL should be ~3600000ms, got ${ttl}ms`
      );
    });
  });
});
