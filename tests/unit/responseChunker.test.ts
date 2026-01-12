/**
 * Unit tests for responseChunker utility
 * Tests chunking at 10KB boundary and chunk metadata
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import {
  chunkResponse,
  needsChunking,
  estimateChunkCount,
  getChunkSizeKB,
} from "../../src/utils/responseChunker.js";

describe("responseChunker", () => {
  const originalEnv = process.env.RESPONSE_CHUNK_SIZE_KB;

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.RESPONSE_CHUNK_SIZE_KB = originalEnv;
    } else {
      delete process.env.RESPONSE_CHUNK_SIZE_KB;
    }
  });

  describe("chunkResponse", () => {
    it("should return single chunk for small response", () => {
      const smallResponse = "This is a small response";
      const chunks = chunkResponse(smallResponse, 10); // 10KB

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].content, smallResponse);
      assert.strictEqual(chunks[0].index, 1);
      assert.strictEqual(chunks[0].total, 1);
    });

    it("should split response exceeding chunk size", () => {
      // Create a response larger than 1KB (using 1KB for easier testing)
      const largeResponse = "A".repeat(2500); // 2.5KB
      const chunks = chunkResponse(largeResponse, 1); // 1KB chunks

      assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);

      // Verify all content is preserved
      const reconstructed = chunks.map((c) => c.content).join("");
      assert.strictEqual(reconstructed, largeResponse);
    });

    it("should set correct index and total on all chunks", () => {
      const response = "X".repeat(5120); // 5KB
      const chunks = chunkResponse(response, 1); // 1KB chunks

      // Should have ~5 chunks
      assert.ok(chunks.length >= 4, "Should have multiple chunks");

      for (let i = 0; i < chunks.length; i++) {
        assert.strictEqual(chunks[i].index, i + 1, `Chunk ${i} should have index ${i + 1}`);
        assert.strictEqual(
          chunks[i].total,
          chunks.length,
          `Chunk ${i} should have total ${chunks.length}`
        );
      }
    });

    it("should prefer splitting at newline boundaries", () => {
      // Create response with newlines
      const lines = [];
      for (let i = 0; i < 20; i++) {
        lines.push("Line " + i + ": " + "content".repeat(50));
      }
      const response = lines.join("\n");

      const chunks = chunkResponse(response, 1); // 1KB chunks

      // Check that most chunks end with newline (within reason)
      let endsWithNewline = 0;
      for (let i = 0; i < chunks.length - 1; i++) {
        // Last chunk doesn't need to end with newline
        if (chunks[i].content.endsWith("\n")) {
          endsWithNewline++;
        }
      }

      // At least some chunks should end with newline
      // (not all will, especially if lines are very long)
      assert.ok(
        endsWithNewline > 0 || chunks.length === 1,
        "Should try to split at newlines"
      );
    });

    it("should handle empty response", () => {
      const chunks = chunkResponse("", 10);

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].content, "");
      assert.strictEqual(chunks[0].index, 1);
      assert.strictEqual(chunks[0].total, 1);
    });

    it("should handle response exactly at chunk boundary", () => {
      const exactSize = 1024; // Exactly 1KB
      const response = "A".repeat(exactSize);
      const chunks = chunkResponse(response, 1);

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].content.length, exactSize);
    });

    it("should handle response just over chunk boundary", () => {
      const justOver = 1025; // 1KB + 1 byte
      const response = "A".repeat(justOver);
      const chunks = chunkResponse(response, 1);

      assert.strictEqual(chunks.length, 2);

      // Verify content is preserved
      const total = chunks.reduce((sum, c) => sum + c.content.length, 0);
      assert.strictEqual(total, justOver);
    });
  });

  describe("needsChunking", () => {
    it("should return false for small response", () => {
      const smallResponse = "Small content";
      assert.strictEqual(needsChunking(smallResponse, 10), false);
    });

    it("should return true for response exceeding threshold", () => {
      const largeResponse = "X".repeat(11 * 1024); // 11KB
      assert.strictEqual(needsChunking(largeResponse, 10), true);
    });

    it("should return false for response exactly at threshold", () => {
      const exactResponse = "X".repeat(10 * 1024); // Exactly 10KB
      assert.strictEqual(needsChunking(exactResponse, 10), false);
    });

    it("should return true for response 1 byte over threshold", () => {
      const overResponse = "X".repeat(10 * 1024 + 1);
      assert.strictEqual(needsChunking(overResponse, 10), true);
    });

    it("should use default 10KB if not specified", () => {
      const under10KB = "X".repeat(9 * 1024);
      const over10KB = "X".repeat(11 * 1024);

      assert.strictEqual(needsChunking(under10KB), false);
      assert.strictEqual(needsChunking(over10KB), true);
    });
  });

  describe("estimateChunkCount", () => {
    it("should return 1 for small response", () => {
      const smallResponse = "Small";
      assert.strictEqual(estimateChunkCount(smallResponse, 10), 1);
    });

    it("should estimate correctly for exact multiples", () => {
      const response = "X".repeat(30 * 1024); // 30KB
      assert.strictEqual(estimateChunkCount(response, 10), 3);
    });

    it("should round up for partial chunks", () => {
      const response = "X".repeat(25 * 1024); // 25KB -> should be 3 chunks
      assert.strictEqual(estimateChunkCount(response, 10), 3);
    });

    it("should handle 1 byte over boundary", () => {
      const response = "X".repeat(10 * 1024 + 1);
      assert.strictEqual(estimateChunkCount(response, 10), 2);
    });
  });

  describe("getChunkSizeKB", () => {
    it("should return default value when env not set", () => {
      delete process.env.RESPONSE_CHUNK_SIZE_KB;
      const size = getChunkSizeKB();
      assert.strictEqual(size, 10); // Default from constants
    });

    it("should read from environment variable", () => {
      process.env.RESPONSE_CHUNK_SIZE_KB = "20";
      const size = getChunkSizeKB();
      assert.strictEqual(size, 20);
    });

    it("should handle invalid env values", () => {
      process.env.RESPONSE_CHUNK_SIZE_KB = "invalid";
      const size = getChunkSizeKB();
      assert.strictEqual(size, 10); // Should fall back to default
    });

    it("should handle negative values", () => {
      process.env.RESPONSE_CHUNK_SIZE_KB = "-5";
      const size = getChunkSizeKB();
      assert.strictEqual(size, 10); // Should fall back to default
    });

    it("should handle zero", () => {
      process.env.RESPONSE_CHUNK_SIZE_KB = "0";
      const size = getChunkSizeKB();
      assert.strictEqual(size, 10); // Should fall back to default
    });
  });

  describe("10KB boundary (default)", () => {
    it("should chunk 50KB response into approximately 5 chunks", () => {
      const response = "X".repeat(50 * 1024);
      const chunks = chunkResponse(response, 10);

      // Should be approximately 5 chunks (may vary slightly due to newline splitting)
      assert.ok(chunks.length >= 4 && chunks.length <= 6, `Expected ~5 chunks, got ${chunks.length}`);
    });

    it("should preserve complete content across chunks", () => {
      // Create structured content
      const content = Array.from({ length: 100 }, (_, i) => `Item ${i}: ${"data".repeat(100)}`).join(
        "\n"
      );

      const chunks = chunkResponse(content, 10);
      const reconstructed = chunks.map((c) => c.content).join("");

      assert.strictEqual(reconstructed, content, "Reconstructed content should match original");
    });
  });
});
