/**
 * Path validation utility for security enforcement
 *
 * Ensures all paths are within project root to prevent unauthorized access.
 */

import * as path from "path";
import * as fs from "fs";
import type { PathValidationResult } from "../types.js";

/**
 * Regex pattern to extract @path references from prompts
 * Matches @<path> patterns (e.g., @src/auth.ts, @./config.json)
 */
const AT_PATH_PATTERN = /@([\w./-]+)/g;

/**
 * Validate a path for security and existence
 *
 * @param inputPath - The path to validate (relative or absolute)
 * @param projectRoot - The project root directory (absolute path)
 * @returns PathValidationResult with validation details
 */
export function validatePath(inputPath: string, projectRoot: string): PathValidationResult {
  // Normalize the project root
  const normalizedRoot = path.resolve(projectRoot);

  // Resolve the input path relative to project root
  let resolved: string;
  if (path.isAbsolute(inputPath)) {
    resolved = path.resolve(inputPath);
  } else {
    resolved = path.resolve(normalizedRoot, inputPath);
  }

  // Normalize to handle any .. or . in the path
  resolved = path.normalize(resolved);

  // Check if path is within project root
  const allowed = isWithinProjectRoot(resolved, normalizedRoot);

  // Check if path exists
  let exists = false;
  if (allowed) {
    try {
      fs.accessSync(resolved);
      exists = true;
    } catch {
      exists = false;
    }
  }

  // Build result
  const result: PathValidationResult = {
    input: inputPath,
    resolved,
    exists,
    allowed,
  };

  // Add reason for disallowed paths
  if (!allowed) {
    if (inputPath.includes("..")) {
      result.reason = "Path contains parent directory traversal (..)";
    } else {
      result.reason = "Path is outside project root";
    }
  } else if (!exists) {
    result.reason = "Path does not exist";
  }

  return result;
}

/**
 * Check if an absolute path is within the project root
 *
 * @param absolutePath - The absolute path to check
 * @param projectRoot - The project root directory (absolute path)
 * @returns true if the path is within project root
 */
export function isWithinProjectRoot(absolutePath: string, projectRoot: string): boolean {
  // Normalize both paths
  const normalizedPath = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(projectRoot);

  // Check if the path starts with the project root
  // Add trailing separator to avoid matching partial directory names
  // e.g., /home/user/project-test should not match /home/user/project
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;

  // Path is within root if it equals root or starts with root + separator
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(rootWithSep);
}

/**
 * Extract @path references from a prompt string
 *
 * @param prompt - The prompt string to scan
 * @returns Array of path strings found in the prompt
 */
export function extractAtPathReferences(prompt: string): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  AT_PATH_PATTERN.lastIndex = 0;

  while ((match = AT_PATH_PATTERN.exec(prompt)) !== null) {
    matches.push(match[1]);
  }

  return matches;
}

/**
 * Validate all @path references in a prompt
 *
 * @param prompt - The prompt string to validate
 * @param projectRoot - The project root directory
 * @returns Array of validation results for each @path reference
 */
export function validatePromptPaths(
  prompt: string,
  projectRoot: string
): PathValidationResult[] {
  const paths = extractAtPathReferences(prompt);
  return paths.map((p) => validatePath(p, projectRoot));
}

/**
 * Check if a prompt contains any invalid @path references
 *
 * @param prompt - The prompt string to check
 * @param projectRoot - The project root directory
 * @returns Object with isValid flag and array of invalid paths
 */
export function checkPromptPathsValid(
  prompt: string,
  projectRoot: string
): { isValid: boolean; invalidPaths: PathValidationResult[] } {
  const results = validatePromptPaths(prompt, projectRoot);
  const invalidPaths = results.filter((r) => !r.allowed);

  return {
    isValid: invalidPaths.length === 0,
    invalidPaths,
  };
}

/**
 * Get the project root directory
 * Uses PROJECT_ROOT env var if set, otherwise process.cwd()
 *
 * @returns The project root directory (absolute path)
 */
export function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}
