/**
 * Unit tests for ignorePatterns utility
 * Tests .gitignore parsing and hard-coded ignores
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  HARD_CODED_IGNORES,
  parseGitignore,
  isIgnored,
  createIgnoreFilter,
  enumerateDirectory,
} from "../../src/utils/ignorePatterns.js";

describe("ignorePatterns", () => {
  // Create a temporary test directory
  const testDir = path.join(os.tmpdir(), "test-ignore-patterns-" + Date.now());

  beforeEach(() => {
    // Create test directory structure
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "node_modules", "lodash"), { recursive: true });
    fs.mkdirSync(path.join(testDir, ".git"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "dist"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "coverage"), { recursive: true });

    // Create test files
    fs.writeFileSync(path.join(testDir, "src", "index.ts"), "export {};");
    fs.writeFileSync(path.join(testDir, "src", "app.ts"), "export {};");
    fs.writeFileSync(path.join(testDir, "package.json"), "{}");
    fs.writeFileSync(path.join(testDir, "node_modules", "lodash", "index.js"), "");
    fs.writeFileSync(path.join(testDir, ".git", "config"), "");
    fs.writeFileSync(path.join(testDir, "dist", "bundle.js"), "");
  });

  afterEach(() => {
    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("HARD_CODED_IGNORES", () => {
    it("should include .git/", () => {
      assert.ok(HARD_CODED_IGNORES.includes(".git/"), "Should ignore .git/");
    });

    it("should include node_modules/", () => {
      assert.ok(HARD_CODED_IGNORES.includes("node_modules/"), "Should ignore node_modules/");
    });

    it("should include dist/", () => {
      assert.ok(HARD_CODED_IGNORES.includes("dist/"), "Should ignore dist/");
    });

    it("should include build/", () => {
      assert.ok(HARD_CODED_IGNORES.includes("build/"), "Should ignore build/");
    });

    it("should include coverage/", () => {
      assert.ok(HARD_CODED_IGNORES.includes("coverage/"), "Should ignore coverage/");
    });

    it("should include Python virtual environment directories", () => {
      assert.ok(HARD_CODED_IGNORES.includes(".venv/"), "Should ignore .venv/");
      assert.ok(HARD_CODED_IGNORES.includes("venv/"), "Should ignore venv/");
      assert.ok(HARD_CODED_IGNORES.includes("__pycache__/"), "Should ignore __pycache__/");
    });

    it("should include common build output directories", () => {
      assert.ok(HARD_CODED_IGNORES.includes("out/"), "Should ignore out/");
      assert.ok(HARD_CODED_IGNORES.includes(".next/"), "Should ignore .next/");
    });
  });

  describe("parseGitignore", () => {
    it("should return ignore instance with hard-coded patterns", () => {
      const ig = parseGitignore(testDir);

      // Test hard-coded patterns are applied
      assert.strictEqual(ig.ignores("node_modules/"), true);
      assert.strictEqual(ig.ignores(".git/"), true);
      assert.strictEqual(ig.ignores("dist/"), true);
    });

    it("should parse .gitignore file if present", () => {
      // Create .gitignore
      fs.writeFileSync(path.join(testDir, ".gitignore"), "*.log\n.env\nsecrets/");

      const ig = parseGitignore(testDir);

      // Test custom patterns from .gitignore
      assert.strictEqual(ig.ignores("debug.log"), true);
      assert.strictEqual(ig.ignores(".env"), true);
      assert.strictEqual(ig.ignores("secrets/"), true);

      // Test non-ignored files
      assert.strictEqual(ig.ignores("src/index.ts"), false);
    });

    it("should work without .gitignore file", () => {
      // Ensure no .gitignore
      const gitignorePath = path.join(testDir, ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        fs.unlinkSync(gitignorePath);
      }

      const ig = parseGitignore(testDir);

      // Hard-coded patterns should still work
      assert.strictEqual(ig.ignores("node_modules/"), true);
    });

    it("should combine hard-coded and .gitignore patterns", () => {
      fs.writeFileSync(path.join(testDir, ".gitignore"), "*.tmp\n*.bak");

      const ig = parseGitignore(testDir);

      // Hard-coded
      assert.strictEqual(ig.ignores("node_modules/"), true);
      assert.strictEqual(ig.ignores("dist/"), true);

      // From .gitignore
      assert.strictEqual(ig.ignores("backup.tmp"), true);
      assert.strictEqual(ig.ignores("old.bak"), true);

      // Not ignored
      assert.strictEqual(ig.ignores("src/app.ts"), false);
    });
  });

  describe("isIgnored", () => {
    it("should return true for node_modules", () => {
      assert.strictEqual(isIgnored("node_modules/lodash/index.js", testDir), true);
    });

    it("should return true for .git", () => {
      assert.strictEqual(isIgnored(".git/config", testDir), true);
    });

    it("should return true for dist", () => {
      assert.strictEqual(isIgnored("dist/bundle.js", testDir), true);
    });

    it("should return false for source files", () => {
      assert.strictEqual(isIgnored("src/index.ts", testDir), false);
    });

    it("should return false for package.json", () => {
      assert.strictEqual(isIgnored("package.json", testDir), false);
    });

    it("should handle Windows-style paths", () => {
      // Even on Unix, should handle backslashes correctly
      assert.strictEqual(isIgnored("node_modules\\lodash\\index.js", testDir), true);
    });
  });

  describe("createIgnoreFilter", () => {
    it("should create reusable filter function", () => {
      const filter = createIgnoreFilter(testDir);

      assert.strictEqual(filter("node_modules/test.js"), true);
      assert.strictEqual(filter("src/app.ts"), false);
      assert.strictEqual(filter(".git/HEAD"), true);
    });

    it("should be efficient for multiple checks", () => {
      const filter = createIgnoreFilter(testDir);

      // Check multiple paths with same filter
      const paths = [
        "src/index.ts",
        "src/utils/helper.ts",
        "node_modules/lodash/index.js",
        "dist/main.js",
        "package.json",
        "coverage/lcov.info",
      ];

      const results = paths.map((p) => ({ path: p, ignored: filter(p) }));

      assert.strictEqual(results.find((r) => r.path === "src/index.ts")?.ignored, false);
      assert.strictEqual(results.find((r) => r.path === "node_modules/lodash/index.js")?.ignored, true);
      assert.strictEqual(results.find((r) => r.path === "dist/main.js")?.ignored, true);
      assert.strictEqual(results.find((r) => r.path === "coverage/lcov.info")?.ignored, true);
    });
  });

  describe("enumerateDirectory", () => {
    it("should enumerate files respecting ignore patterns", async () => {
      const result = await enumerateDirectory(testDir, testDir);

      // Should include source files
      const srcIndex = result.entries.find((e) => e.relativePath === "src/index.ts");
      assert.ok(srcIndex, "Should include src/index.ts");

      // Should NOT include node_modules
      const nodeModulesEntry = result.entries.find((e) =>
        e.relativePath.startsWith("node_modules")
      );
      assert.ok(!nodeModulesEntry, "Should not include node_modules");

      // Should NOT include .git
      const gitEntry = result.entries.find((e) => e.relativePath.startsWith(".git"));
      assert.ok(!gitEntry, "Should not include .git");

      // Should NOT include dist
      const distEntry = result.entries.find((e) => e.relativePath.startsWith("dist"));
      assert.ok(!distEntry, "Should not include dist");
    });

    it("should respect maxFiles limit", async () => {
      // Create many files
      for (let i = 0; i < 20; i++) {
        fs.writeFileSync(path.join(testDir, `file${i}.txt`), "content");
      }

      const result = await enumerateDirectory(testDir, testDir, 5);

      assert.ok(result.entries.length <= 5, `Should have at most 5 entries, got ${result.entries.length}`);
      assert.strictEqual(result.truncated, true);
      assert.ok(
        result.warnings.some((w) => w.includes("maxFiles")),
        "Should have warning about maxFiles"
      );
    });

    it("should respect maxDepth limit", async () => {
      // Create nested directories
      fs.mkdirSync(path.join(testDir, "level1", "level2", "level3"), { recursive: true });
      fs.writeFileSync(path.join(testDir, "level1", "file1.txt"), "");
      fs.writeFileSync(path.join(testDir, "level1", "level2", "file2.txt"), "");
      fs.writeFileSync(path.join(testDir, "level1", "level2", "level3", "file3.txt"), "");

      const result = await enumerateDirectory(testDir, testDir, 500, 1);

      // Should include level1 files but not deep nested files
      const deepFile = result.entries.find((e) =>
        e.relativePath.includes("level3")
      );
      assert.ok(!deepFile, "Should not include files beyond maxDepth");
    });

    it("should return warnings for inaccessible directories", async () => {
      const result = await enumerateDirectory(
        path.join(testDir, "nonexistent"),
        testDir
      );

      assert.strictEqual(result.entries.length, 0);
      assert.ok(
        result.warnings.some((w) => w.includes("does not exist")),
        "Should have warning about non-existent directory"
      );
    });

    it("should reject paths outside project root", async () => {
      const result = await enumerateDirectory("/etc", testDir);

      assert.strictEqual(result.entries.length, 0);
      assert.ok(
        result.warnings.some((w) => w.includes("outside project root")),
        "Should have warning about path outside project root"
      );
    });

    it("should include both files and directories in entries", async () => {
      const result = await enumerateDirectory(testDir, testDir);

      const dirEntry = result.entries.find((e) => e.isDirectory);
      const fileEntry = result.entries.find((e) => !e.isDirectory);

      assert.ok(dirEntry, "Should include directory entries");
      assert.ok(fileEntry, "Should include file entries");
    });
  });

  describe("gitignore patterns", () => {
    it("should handle negation patterns", () => {
      fs.writeFileSync(
        path.join(testDir, ".gitignore"),
        "*.log\n!important.log"
      );

      const ig = parseGitignore(testDir);

      assert.strictEqual(ig.ignores("debug.log"), true);
      assert.strictEqual(ig.ignores("important.log"), false);
    });

    it("should handle directory-specific patterns", () => {
      fs.writeFileSync(path.join(testDir, ".gitignore"), "/build/\nlogs/");

      const ig = parseGitignore(testDir);

      // /build/ matches at root
      assert.strictEqual(ig.ignores("build/"), true);
      // Note: The ignore library may still match nested paths depending on implementation
      // We test that root build/ is definitely ignored

      // logs/ matches anywhere
      assert.strictEqual(ig.ignores("logs/"), true);
      assert.strictEqual(ig.ignores("src/logs/"), true);
    });

    it("should handle glob patterns", () => {
      fs.writeFileSync(path.join(testDir, ".gitignore"), "*.min.js\n**/*.map");

      const ig = parseGitignore(testDir);

      assert.strictEqual(ig.ignores("bundle.min.js"), true);
      assert.strictEqual(ig.ignores("src/utils/helper.map"), true);
      assert.strictEqual(ig.ignores("deep/nested/path/style.map"), true);
    });

    it("should handle comments and empty lines", () => {
      fs.writeFileSync(
        path.join(testDir, ".gitignore"),
        "# This is a comment\n\n*.log\n\n# Another comment\n*.tmp"
      );

      const ig = parseGitignore(testDir);

      assert.strictEqual(ig.ignores("# This is a comment"), false);
      assert.strictEqual(ig.ignores("debug.log"), true);
      assert.strictEqual(ig.ignores("temp.tmp"), true);
    });
  });
});
