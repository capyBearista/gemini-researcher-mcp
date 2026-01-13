/**
 * Ignore patterns utility for directory enumeration
 *
 * Respects .gitignore and applies hard-coded exclusions for common directories.
 */

import * as fs from "fs";
import * as path from "path";
import ignore, { type Ignore } from "ignore";
import { DEFAULT_IGNORE_PATTERNS } from "../constants.js";
import { isWithinProjectRoot } from "./pathValidator.js";

// Cast the import to the correct type (ESM interop workaround)
const createIgnore = ignore as unknown as () => Ignore;

/**
 * Hard-coded ignore patterns that are always applied
 * These are common directories that should never be sent to Gemini
 */
export const HARD_CODED_IGNORES: readonly string[] = DEFAULT_IGNORE_PATTERNS;

/**
 * Parse .gitignore file and return an ignore instance
 *
 * @param projectRoot - The project root directory
 * @returns Ignore instance configured with .gitignore rules
 */
export function parseGitignore(projectRoot: string): Ignore {
  const ig = createIgnore();

  // Always add hard-coded patterns first
  ig.add(HARD_CODED_IGNORES as unknown as string[]);

  // Try to read .gitignore
  const gitignorePath = path.join(projectRoot, ".gitignore");
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      ig.add(content);
    }
  } catch {
    // Silently ignore errors reading .gitignore
  }

  return ig;
}

/**
 * Check if a file path should be ignored
 *
 * @param filePath - Relative file path (from project root)
 * @param projectRoot - The project root directory
 * @returns true if the file should be ignored
 */
export function isIgnored(filePath: string, projectRoot: string): boolean {
  const ig = parseGitignore(projectRoot);
  // Normalize path to use forward slashes for ignore matching
  const normalizedPath = filePath.replace(/\\/g, "/");
  return ig.ignores(normalizedPath);
}

/**
 * Create an ignore filter function
 *
 * @param projectRoot - The project root directory
 * @returns Function that returns true if a path should be ignored
 */
export function createIgnoreFilter(projectRoot: string): (filePath: string) => boolean {
  const ig = parseGitignore(projectRoot);
  return (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, "/");
    return ig.ignores(normalizedPath);
  };
}

/**
 * Directory entry for enumeration results
 */
export interface DirectoryEnumerationEntry {
  path: string;
  relativePath: string;
  isDirectory: boolean;
}

/**
 * Enumerate files in a directory, respecting ignore rules
 *
 * @param dirPath - Absolute path to directory to enumerate
 * @param projectRoot - The project root directory
 * @param maxFiles - Maximum number of files to return (default: 500)
 * @param maxDepth - Maximum traversal depth (default: unlimited = -1)
 * @returns Array of file entries with relative paths
 */
export async function enumerateDirectory(
  dirPath: string,
  projectRoot: string,
  maxFiles: number = 500,
  maxDepth: number = -1
): Promise<{ entries: DirectoryEnumerationEntry[]; truncated: boolean; warnings: string[] }> {
  const entries: DirectoryEnumerationEntry[] = [];
  const warnings: string[] = [];
  const ignoreFilter = createIgnoreFilter(projectRoot);

  // Validate that dirPath is within project root
  if (!isWithinProjectRoot(dirPath, projectRoot)) {
    warnings.push(`Directory ${dirPath} is outside project root`);
    return { entries, truncated: false, warnings };
  }

  // Check directory exists
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      warnings.push(`${dirPath} is not a directory`);
      return { entries, truncated: false, warnings };
    }
  } catch {
    warnings.push(`Directory ${dirPath} does not exist or is not accessible`);
    return { entries, truncated: false, warnings };
  }

  // Recursive enumeration with depth tracking
  async function enumerateRecursive(currentPath: string, currentDepth: number): Promise<void> {
    // Check depth limit
    if (maxDepth >= 0 && currentDepth > maxDepth) {
      return;
    }

    // Check file limit
    if (entries.length >= maxFiles) {
      return;
    }

    try {
      const items = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const item of items) {
        // Check file limit again for each item
        if (entries.length >= maxFiles) {
          break;
        }

        const absolutePath = path.join(currentPath, item.name);
        const relativePath = path.relative(projectRoot, absolutePath);
        const normalizedRelative = relativePath.replace(/\\/g, "/");

        // Check if this path should be ignored
        // For directories, check with trailing slash
        const checkPath = item.isDirectory()
          ? normalizedRelative + "/"
          : normalizedRelative;

        if (ignoreFilter(checkPath)) {
          continue;
        }

        if (item.isDirectory()) {
          // Add directory entry and recurse
          entries.push({
            path: absolutePath,
            relativePath: normalizedRelative,
            isDirectory: true,
          });

          // Recurse into subdirectory
          await enumerateRecursive(absolutePath, currentDepth + 1);
        } else if (item.isFile()) {
          entries.push({
            path: absolutePath,
            relativePath: normalizedRelative,
            isDirectory: false,
          });
        }
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      // Log permission errors but continue
      if (error.code === "EACCES" || error.code === "EPERM") {
        warnings.push(`Permission denied: ${currentPath}`);
      }
    }
  }

  await enumerateRecursive(dirPath, 0);

  const truncated = entries.length >= maxFiles;
  if (truncated) {
    warnings.push(`Exceeded maxFiles limit; showing first ${maxFiles} files only`);
  }

  return { entries, truncated, warnings };
}

/**
 * Get only file entries (not directories) from enumeration
 *
 * @param dirPath - Absolute path to directory to enumerate
 * @param projectRoot - The project root directory
 * @param maxFiles - Maximum number of files to return
 * @param maxDepth - Maximum traversal depth
 * @returns Array of file paths (relative to project root)
 */
export async function enumerateFiles(
  dirPath: string,
  projectRoot: string,
  maxFiles: number = 500,
  maxDepth: number = -1
): Promise<{ files: string[]; truncated: boolean; warnings: string[] }> {
  const result = await enumerateDirectory(dirPath, projectRoot, maxFiles, maxDepth);

  const files = result.entries
    .filter((e) => !e.isDirectory)
    .map((e) => e.relativePath);

  return {
    files,
    truncated: result.truncated,
    warnings: result.warnings,
  };
}
