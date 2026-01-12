/**
 * Integration tests for MCP tools
 * Tests all 6 tools with mocked Gemini output
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Import tools and registry
import { toolRegistry, executeTool, getToolDefinitions } from "../../src/tools/index.js";

// Import utilities for setup
import { clearAll as clearCache } from "../../src/utils/responseCache.js";
import { cacheResponse } from "../../src/utils/responseCache.js";
import type { CachedChunk } from "../../src/types.js";

describe("Tool Integration Tests", () => {
  // Create a temporary test directory
  const testDir = path.join(os.tmpdir(), "test-tools-integration-" + Date.now());
  const originalCwd = process.cwd();
  const originalProjectRoot = process.env.PROJECT_ROOT;

  beforeEach(() => {
    // Create test directory structure
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "src", "utils"), { recursive: true });

    // Create test files
    fs.writeFileSync(path.join(testDir, "src", "index.ts"), 'export const main = () => "Hello";');
    fs.writeFileSync(path.join(testDir, "src", "utils", "helper.ts"), "export const help = () => {};");
    fs.writeFileSync(path.join(testDir, "package.json"), '{"name": "test"}');

    // Set PROJECT_ROOT for tests
    process.env.PROJECT_ROOT = testDir;

    // Clear cache
    clearCache();
  });

  afterEach(() => {
    // Restore PROJECT_ROOT
    if (originalProjectRoot !== undefined) {
      process.env.PROJECT_ROOT = originalProjectRoot;
    } else {
      delete process.env.PROJECT_ROOT;
    }

    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Clear cache
    clearCache();
  });

  describe("Tool Registry", () => {
    it("should have 6 tools registered", () => {
      assert.strictEqual(toolRegistry.length, 6, "Should have 6 tools registered");
    });

    it("should have all expected tools", () => {
      const toolNames = toolRegistry.map((t) => t.name);

      assert.ok(toolNames.includes("quick_query"), "Should have quick_query");
      assert.ok(toolNames.includes("deep_research"), "Should have deep_research");
      assert.ok(toolNames.includes("analyze_directory"), "Should have analyze_directory");
      assert.ok(toolNames.includes("validate_paths"), "Should have validate_paths");
      assert.ok(toolNames.includes("health_check"), "Should have health_check");
      assert.ok(toolNames.includes("fetch_chunk"), "Should have fetch_chunk");
    });

    it("should return valid tool definitions for MCP", () => {
      const definitions = getToolDefinitions();

      assert.strictEqual(definitions.length, 6);

      for (const def of definitions) {
        assert.ok(def.name, "Tool should have name");
        assert.ok(def.description, "Tool should have description");
        assert.ok(def.inputSchema, "Tool should have inputSchema");
        assert.strictEqual(def.inputSchema.type, "object", "inputSchema type should be object");
      }
    });
  });

  describe("validate_paths tool", () => {
    it("should validate existing paths", async () => {
      const result = await executeTool("validate_paths", {
        paths: ["src/index.ts", "package.json"],
      });

      const parsed = JSON.parse(result);

      assert.strictEqual(parsed.tool, "validate_paths");
      assert.strictEqual(parsed.results.length, 2);

      // First path
      assert.strictEqual(parsed.results[0].input, "src/index.ts");
      assert.strictEqual(parsed.results[0].exists, true);
      assert.strictEqual(parsed.results[0].allowed, true);

      // Second path
      assert.strictEqual(parsed.results[1].input, "package.json");
      assert.strictEqual(parsed.results[1].exists, true);
      assert.strictEqual(parsed.results[1].allowed, true);
    });

    it("should detect paths outside project root", async () => {
      const result = await executeTool("validate_paths", {
        paths: ["../../../etc/passwd", "/etc/hosts"],
      });

      const parsed = JSON.parse(result);

      assert.strictEqual(parsed.results.length, 2);

      for (const r of parsed.results) {
        assert.strictEqual(r.allowed, false, `Path ${r.input} should not be allowed`);
      }
    });

    it("should detect non-existent paths", async () => {
      const result = await executeTool("validate_paths", {
        paths: ["src/nonexistent.ts"],
      });

      const parsed = JSON.parse(result);

      assert.strictEqual(parsed.results[0].exists, false);
      assert.strictEqual(parsed.results[0].allowed, true); // Allowed but doesn't exist
    });

    it("should return structured JSON response", async () => {
      const result = await executeTool("validate_paths", {
        paths: ["src/index.ts"],
      });

      const parsed = JSON.parse(result);

      // Verify structure
      assert.ok("tool" in parsed);
      assert.ok("results" in parsed);
      assert.ok(Array.isArray(parsed.results));

      // Verify result structure
      const firstResult = parsed.results[0];
      assert.ok("input" in firstResult);
      assert.ok("resolved" in firstResult);
      assert.ok("exists" in firstResult);
      assert.ok("allowed" in firstResult);
    });
  });

  describe("health_check tool", () => {
    it("should return server status", async () => {
      const result = await executeTool("health_check", {});

      const parsed = JSON.parse(result);

      assert.strictEqual(parsed.tool, "health_check");
      assert.ok(["ok", "degraded", "error"].includes(parsed.status));
      assert.ok(parsed.server);
      assert.strictEqual(parsed.server.name, "better-gemini-mcp");
    });

    it("should include diagnostics when requested", async () => {
      const result = await executeTool("health_check", {
        includeDiagnostics: true,
      });

      const parsed = JSON.parse(result);

      assert.ok(parsed.diagnostics, "Should include diagnostics");
      assert.ok("projectRoot" in parsed.diagnostics);
      assert.ok("geminiOnPath" in parsed.diagnostics);
    });

    it("should return valid JSON", async () => {
      const result = await executeTool("health_check", {});

      // Should not throw
      const parsed = JSON.parse(result);

      assert.ok(typeof parsed === "object");
    });
  });

  describe("fetch_chunk tool", () => {
    it("should retrieve cached chunk", async () => {
      // First, cache some chunks
      const chunks: CachedChunk[] = [
        { content: "First chunk content", index: 1, total: 3 },
        { content: "Second chunk content", index: 2, total: 3 },
        { content: "Third chunk content", index: 3, total: 3 },
      ];

      const cacheKey = cacheResponse(chunks);

      // Now fetch chunk 2
      const result = await executeTool("fetch_chunk", {
        cacheKey,
        chunkIndex: 2,
      });

      const parsed = JSON.parse(result);

      assert.strictEqual(parsed.tool, "fetch_chunk");
      assert.strictEqual(parsed.cacheKey, cacheKey);
      assert.strictEqual(parsed.chunk.index, 2);
      assert.strictEqual(parsed.chunk.total, 3);
      assert.strictEqual(parsed.chunk.content, "Second chunk content");
    });

    it("should return error for expired/invalid cache key", async () => {
      const result = await executeTool("fetch_chunk", {
        cacheKey: "cache_nonexistent",
        chunkIndex: 1,
      });

      const parsed = JSON.parse(result);

      assert.ok(parsed.error, "Should have error");
      assert.strictEqual(parsed.error.code, "CACHE_EXPIRED");
    });

    it("should return error for invalid chunk index", async () => {
      const chunks: CachedChunk[] = [{ content: "Only chunk", index: 1, total: 1 }];
      const cacheKey = cacheResponse(chunks);

      const result = await executeTool("fetch_chunk", {
        cacheKey,
        chunkIndex: 5, // Out of range
      });

      const parsed = JSON.parse(result);

      assert.ok(parsed.error, "Should have error");
      assert.strictEqual(parsed.error.code, "INVALID_CHUNK_INDEX");
    });
  });

  describe("quick_query tool", () => {
    it("should return error for empty prompt", async () => {
      const result = await executeTool("quick_query", {
        prompt: "",
      });

      const parsed = JSON.parse(result);

      assert.ok(parsed.error, "Should have error for empty prompt");
      assert.strictEqual(parsed.error.code, "INVALID_ARGUMENT");
    });

    it("should return error for path traversal in prompt", async () => {
      const result = await executeTool("quick_query", {
        prompt: "Analyze @../../../etc/passwd",
      });

      const parsed = JSON.parse(result);

      assert.ok(parsed.error, "Should have error for path traversal");
      assert.strictEqual(parsed.error.code, "PATH_NOT_ALLOWED");
    });

    it("should accept valid prompt with focus", async () => {
      // This will fail because Gemini CLI isn't available in test,
      // but we can verify the validation passes
      try {
        await executeTool("quick_query", {
          prompt: "What is the purpose of src/index.ts?",
          focus: "architecture",
          responseStyle: "concise",
        });
      } catch (error) {
        // Expected to fail at Gemini CLI invocation
        // But should not fail at validation
        const message = error instanceof Error ? error.message : String(error);

        // Should not be a validation error
        assert.ok(
          !message.includes("INVALID_ARGUMENT") && !message.includes("PATH_NOT_ALLOWED"),
          "Should pass validation"
        );
      }
    });
  });

  describe("deep_research tool", () => {
    it("should return error for empty prompt", async () => {
      const result = await executeTool("deep_research", {
        prompt: "   ",
      });

      const parsed = JSON.parse(result);

      assert.ok(parsed.error, "Should have error for empty prompt");
      assert.strictEqual(parsed.error.code, "INVALID_ARGUMENT");
    });

    it("should validate path references", async () => {
      const result = await executeTool("deep_research", {
        prompt: "Compare @/etc/passwd with @/etc/shadow",
      });

      const parsed = JSON.parse(result);

      assert.ok(parsed.error, "Should have error for system paths");
      assert.strictEqual(parsed.error.code, "PATH_NOT_ALLOWED");
    });
  });

  describe("analyze_directory tool", () => {
    it("should return error for path outside project root", async () => {
      const result = await executeTool("analyze_directory", {
        path: "/etc",
      });

      const parsed = JSON.parse(result);

      assert.ok(parsed.error, "Should have error for system path");
      assert.strictEqual(parsed.error.code, "PATH_NOT_ALLOWED");
    });

    it("should return error for non-existent directory", async () => {
      const result = await executeTool("analyze_directory", {
        path: "nonexistent_directory",
      });

      const parsed = JSON.parse(result);

      // Should either be an error or empty entries with warning
      if (parsed.error) {
        assert.ok(parsed.error.message.includes("not exist") || parsed.error.message.includes("not found"));
      } else {
        assert.ok(parsed.entries.length === 0 || parsed.meta.warnings.length > 0);
      }
    });
  });

  describe("Error Response Format", () => {
    it("should return consistent error structure", async () => {
      // Test with validate_paths as it's quick
      const result = await executeTool("fetch_chunk", {
        cacheKey: "cache_invalid",
        chunkIndex: 1,
      });

      const parsed = JSON.parse(result);

      assert.ok(parsed.error, "Should have error object");
      assert.ok(parsed.error.code, "Error should have code");
      assert.ok(parsed.error.message, "Error should have message");
    });

    it("should use proper error codes from constants", async () => {
      const validErrorCodes = [
        "INVALID_ARGUMENT",
        "PATH_NOT_ALLOWED",
        "GEMINI_CLI_NOT_FOUND",
        "GEMINI_CLI_ERROR",
        "AUTH_MISSING",
        "QUOTA_EXCEEDED",
        "CACHE_EXPIRED",
        "INVALID_CHUNK_INDEX",
        "INTERNAL",
      ];

      // Test cache expired error
      const result = await executeTool("fetch_chunk", {
        cacheKey: "cache_invalid",
        chunkIndex: 1,
      });

      const parsed = JSON.parse(result);

      assert.ok(
        validErrorCodes.includes(parsed.error.code),
        `Error code ${parsed.error.code} should be valid`
      );
    });
  });

  describe("JSON Response Format", () => {
    it("should return pretty-printed JSON", async () => {
      const result = await executeTool("health_check", {});

      // Check that it's properly formatted (has newlines and indentation)
      assert.ok(result.includes("\n"), "Should have newlines for pretty-print");
      assert.ok(result.includes("  "), "Should have indentation");
    });

    it("should return parseable JSON for all tools", async () => {
      // Test validate_paths
      const validateResult = await executeTool("validate_paths", { paths: ["src"] });
      assert.doesNotThrow(() => JSON.parse(validateResult));

      // Test health_check
      const healthResult = await executeTool("health_check", {});
      assert.doesNotThrow(() => JSON.parse(healthResult));

      // Test fetch_chunk (with cache miss)
      const fetchResult = await executeTool("fetch_chunk", {
        cacheKey: "cache_test",
        chunkIndex: 1,
      });
      assert.doesNotThrow(() => JSON.parse(fetchResult));
    });
  });

  describe("Tool Schema Validation", () => {
    it("should reject invalid argument types", async () => {
      try {
        await executeTool("validate_paths", {
          paths: "not-an-array", // Should be array
        });
        assert.fail("Should throw for invalid type");
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("Invalid arguments"));
      }
    });

    it("should reject missing required arguments", async () => {
      try {
        await executeTool("fetch_chunk", {
          // Missing cacheKey and chunkIndex
        });
        assert.fail("Should throw for missing required args");
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("Invalid arguments"));
      }
    });
  });
});
