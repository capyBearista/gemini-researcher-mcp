import assert from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { validateEnvironment, buildWindowsShimSuggestion } from "../../src/setup/wizard.js";


describe("setup wizard startup validation classification", () => {
  beforeEach(() => {
    delete process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY;
  });

  it("reports launch failure before capability and auth checks", async () => {
    const result = await validateEnvironment({
      isAdminPolicyEnforcedFn: () => false,
      checkGeminiInstallationFn: async () => ({
        installed: true,
        path: "gemini",
        version: "0.38.1",
      }),
      getGeminiCliCapabilityChecksFn: async () => ({
        probeSucceeded: false,
        launchFailed: true,
        hasAdminPolicyFlag: false,
        supportsRequiredOutputFormats: false,
        outputFormatChoices: [],
        reason: "Command launch failed for 'gemini': spawn gemini ENOENT",
      }),
      checkGeminiAuthFn: async () => ({
        configured: true,
        status: "configured",
        method: "google_login",
      }),
    });

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes("could not be launched"));
    assert.ok(result.error?.includes("command launch problem"));
  });

  it("reports probe failure distinctly when launch did not fail", async () => {
    const result = await validateEnvironment({
      isAdminPolicyEnforcedFn: () => false,
      checkGeminiInstallationFn: async () => ({
        installed: true,
        path: "gemini",
        version: "0.38.1",
      }),
      getGeminiCliCapabilityChecksFn: async () => ({
        probeSucceeded: false,
        launchFailed: false,
        hasAdminPolicyFlag: false,
        supportsRequiredOutputFormats: false,
        outputFormatChoices: [],
        reason: "Temporary network failure",
      }),
      checkGeminiAuthFn: async () => ({
        configured: true,
        status: "configured",
        method: "google_login",
      }),
    });

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes("capability probe failed"));
    assert.ok(result.error?.includes("Temporary network failure"));
  });
});

describe("setup wizard suggestion helper", () => {
  beforeEach(() => {
    delete process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY;
  });

  it("returns .cmd suggestion when only cmd shell fallback succeeds", () => {
    const suggestion = buildWindowsShimSuggestion({
      command: "gemini",
      attemptSucceeded: "cmd_shell",
      resolvedPath: "cmd",
      fallbacksAttempted: ["direct", "cmd_shim", "cmd_shell"],
    });

    assert.deepStrictEqual(suggestion, {
      command: "gemini.cmd",
      args: [],
    });
  });

  it("suggests shim based on configured command name if applicable", () => {
    const suggestion = buildWindowsShimSuggestion({
      command: "my-gemini",
      configuredCommand: "my-gemini",
      attemptSucceeded: "cmd_shell",
      resolvedPath: "cmd",
      fallbacksAttempted: ["direct", "cmd_shim", "cmd_shell"],
    });

    assert.deepStrictEqual(suggestion, {
      command: "my-gemini.cmd",
      args: [],
    });
  });

  it("does not suggest shim when command is already explicit executable", () => {
    const suggestion = buildWindowsShimSuggestion({
      command: "gemini",
      configuredCommand: "C:/tools/gemini.exe",
      attemptSucceeded: "cmd_shell",
      resolvedPath: "cmd",
      fallbacksAttempted: ["direct", "cmd_shell"],
    });

    assert.strictEqual(suggestion, null);
  });

});
