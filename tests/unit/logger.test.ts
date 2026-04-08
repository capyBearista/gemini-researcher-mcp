/**
 * Unit tests for logger argument redaction
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { redactCommandArgs } from "../../src/utils/logger.js";

describe("logger redaction", () => {
  it("redacts positional prompt while keeping safe flags", () => {
    const args = [
      "-m",
      "gemini-2.5-flash",
      "--output-format",
      "json",
      "--approval-mode",
      "default",
      "--admin-policy",
      "/tmp/policy.toml",
      "Analyze @src/index.ts and summarize risks",
    ];

    const redacted = redactCommandArgs(args);

    assert.deepStrictEqual(redacted, [
      "-m",
      "gemini-2.5-flash",
      "--output-format",
      "json",
      "--approval-mode",
      "default",
      "--admin-policy",
      "/tmp/policy.toml",
      "[REDACTED_PROMPT]",
    ]);
  });

  it("redacts legacy -p prompt value fully", () => {
    const args = ["-p", "Sensitive prompt text here", "--output-format", "json"];
    const redacted = redactCommandArgs(args);

    assert.deepStrictEqual(redacted, ["-p", "[REDACTED_PROMPT]", "--output-format", "json"]);
  });

  it("redacts unknown flag values", () => {
    const args = ["--custom", "secret-value", "--output-format", "json"];
    const redacted = redactCommandArgs(args);

    assert.deepStrictEqual(redacted, ["--custom", "[REDACTED_ARG]", "--output-format", "json"]);
  });

  it("redacts multiple positional fragments", () => {
    const args = ["first part", "second part", "--approval-mode", "default"];
    const redacted = redactCommandArgs(args);

    assert.deepStrictEqual(redacted, ["[REDACTED_PROMPT]", "[REDACTED_PROMPT]", "--approval-mode", "default"]);
  });
});
