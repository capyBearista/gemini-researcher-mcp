/**
 * Behavior-level unit tests for geminiExecutor CLI contract.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  executeGeminiCLI,
  checkGeminiAuth,
  isAdminPolicyEnforced,
  getReadOnlyPolicyPath,
  isAuthRelatedErrorMessage,
  isQuotaOrCapacityErrorMessage,
  getGeminiCliCapabilityChecks,
  supportsRequiredOutputFormats,
  getGeminiCommandConfig,
} from "../../src/utils/geminiExecutor.js";
import { MODELS } from "../../src/constants.js";

type ExecuteCommandMock = (
  command: string,
  args: string[],
  onProgress?: (newOutput: string) => void
) => Promise<string>;

function getExpectedPromptSuffix(prompt: string): string {
  return `\n\n---\n\nUSER REQUEST:\n${prompt}`;
}

describe("geminiExecutor CLI contract", () => {
  beforeEach(() => {
    delete process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY;
    delete process.env.GEMINI_RESEARCHER_GEMINI_COMMAND;
    delete process.env.GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.VERTEX_AI_PROJECT;
  });

  it("builds exact tier-1 argv for quick_query with strict admin policy", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      return JSON.stringify({ response: "ok", usage: { totalTokens: 5 }, toolCalls: 0 });
    };

    await executeGeminiCLI("Analyze auth flow", "quick_query", undefined, {
      executeCommandFn: mockExecuteCommand,
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, "gemini");

    const expected = [
      "-m",
      MODELS.FLASH_DEFAULT,
      "--output-format",
      "json",
      "--approval-mode",
      "default",
      "--admin-policy",
      getReadOnlyPolicyPath(),
    ];

    assert.deepStrictEqual(calls[0].args.slice(0, expected.length), expected);

    const promptFlagIndex = calls[0].args.indexOf("-p");
    assert.ok(promptFlagIndex > -1);
    const promptArg = calls[0].args[promptFlagIndex + 1];
    assert.ok(promptArg.includes(getExpectedPromptSuffix("Analyze auth flow")));
    assert.ok(!calls[0].args.includes("-y"));
    assert.ok(!calls[0].args.includes("--yolo"));
  });

  it("builds exact tier-1 argv without admin policy when enforcement disabled", async () => {
    process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY = "0";

    const calls: Array<{ command: string; args: string[] }> = [];
    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      return JSON.stringify({ response: "ok", usage: { totalTokens: 5 }, toolCalls: 0 });
    };

    await executeGeminiCLI("Analyze cache", "quick_query", undefined, {
      executeCommandFn: mockExecuteCommand,
    });

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args.slice(0, 6), [
      "-m",
      MODELS.FLASH_DEFAULT,
      "--output-format",
      "json",
      "--approval-mode",
      "default",
    ]);
    assert.ok(!calls[0].args.includes("--admin-policy"));
  });

  it("falls back from flash to flash_lite on quota-like error with exact argv", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    let invocation = 0;

    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      invocation += 1;

      if (invocation === 1) {
        throw new Error("Quota exceeded for quota metric");
      }

      return JSON.stringify({ response: "fallback ok", usage: { totalTokens: 10 }, toolCalls: 0 });
    };

    const result = await executeGeminiCLI("Analyze fallback", "quick_query", undefined, {
      executeCommandFn: mockExecuteCommand,
    });

    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0].args.slice(0, 2), ["-m", MODELS.FLASH_DEFAULT]);
    assert.deepStrictEqual(calls[1].args.slice(0, 2), ["-m", MODELS.FLASH_LITE_DEFAULT]);
    assert.strictEqual(result.model, MODELS.FLASH_LITE_DEFAULT);
  });

  it("falls back to auto-select (no -m flag) after flash and flash_lite quota errors", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    let invocation = 0;

    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      invocation += 1;

      if (invocation <= 2) {
        throw new Error("RESOURCE_EXHAUSTED: Rate limit exceeded");
      }

      return JSON.stringify({ response: "auto ok", usage: { totalTokens: 7 }, toolCalls: 0 });
    };

    const result = await executeGeminiCLI("Analyze auto", "quick_query", undefined, {
      executeCommandFn: mockExecuteCommand,
    });

    assert.strictEqual(calls.length, 3);
    assert.deepStrictEqual(calls[0].args.slice(0, 2), ["-m", MODELS.FLASH_DEFAULT]);
    assert.deepStrictEqual(calls[1].args.slice(0, 2), ["-m", MODELS.FLASH_LITE_DEFAULT]);
    assert.ok(calls[2].args[0] !== "-m");
    assert.ok(!calls[2].args.includes("-m"));
    assert.strictEqual(result.model, "auto");
  });

  it("uses deep_research fallback chain pro -> flash -> flash_lite -> auto", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    let invocation = 0;

    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      invocation += 1;

      if (invocation <= 3) {
        throw new Error("RESOURCE_EXHAUSTED: quota issue");
      }

      return JSON.stringify({ response: "deep ok", usage: { totalTokens: 22 }, toolCalls: 0 });
    };

    const result = await executeGeminiCLI("Deep chain", "deep_research", undefined, {
      executeCommandFn: mockExecuteCommand,
    });

    assert.strictEqual(calls.length, 4);
    assert.deepStrictEqual(calls[0].args.slice(0, 2), ["-m", MODELS.PRO_DEFAULT]);
    assert.deepStrictEqual(calls[1].args.slice(0, 2), ["-m", MODELS.FLASH_DEFAULT]);
    assert.deepStrictEqual(calls[2].args.slice(0, 2), ["-m", MODELS.FLASH_LITE_DEFAULT]);
    assert.ok(!calls[3].args.includes("-m"));
    assert.strictEqual(result.model, "auto");
  });

  it("does not fallback on non-quota errors", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      throw new Error("Authentication failed");
    };

    await assert.rejects(
      executeGeminiCLI("Analyze error", "quick_query", undefined, {
        executeCommandFn: mockExecuteCommand,
      }),
      /Authentication failed/
    );

    assert.strictEqual(calls.length, 1);
  });

  it("falls back for api_key auth when selected model is unavailable", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const calls: Array<{ command: string; args: string[] }> = [];
    let invocation = 0;

    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      invocation += 1;

      if (invocation === 1) {
        throw new Error("Model gemini-3-pro-preview is not available for this API key");
      }

      return JSON.stringify({ response: "api-key fallback ok", usage: { totalTokens: 6 }, toolCalls: 0 });
    };

    const result = await executeGeminiCLI("Analyze api key fallback", "deep_research", undefined, {
      executeCommandFn: mockExecuteCommand,
    });

    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0].args.slice(0, 2), ["-m", MODELS.PRO_DEFAULT]);
    assert.deepStrictEqual(calls[1].args.slice(0, 2), ["-m", MODELS.FLASH_DEFAULT]);
    assert.strictEqual(result.model, MODELS.FLASH_DEFAULT);
  });

  it("does not fallback on model-unavailable errors for non-api_key auth", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      throw new Error("Model gemini-3-pro-preview is not available for this account");
    };

    await assert.rejects(
      executeGeminiCLI("Analyze unavailable model", "deep_research", undefined, {
        executeCommandFn: mockExecuteCommand,
      }),
      /not available/
    );

    assert.strictEqual(calls.length, 1);
  });

  it("uses GEMINI_RESEARCHER_GEMINI_COMMAND override for all invocations", async () => {
    process.env.GEMINI_RESEARCHER_GEMINI_COMMAND = "my-gemini-wrapper";

    const calls: Array<{ command: string; args: string[] }> = [];
    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      return JSON.stringify({ response: "ok" });
    };

    await executeGeminiCLI("Analyze auth flow", "quick_query", undefined, {
      executeCommandFn: mockExecuteCommand,
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, "my-gemini-wrapper");
  });

  it("prepends GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX before generated args", async () => {
    process.env.GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX = '--config "C:/Program Files/Gemini/config.json" --sandbox';

    const calls: Array<{ command: string; args: string[] }> = [];
    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      return JSON.stringify({ response: "ok", usage: { totalTokens: 1 }, toolCalls: 0 });
    };

    await executeGeminiCLI("Analyze args", "quick_query", undefined, {
      executeCommandFn: mockExecuteCommand,
    });

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args.slice(0, 3), [
      "--config",
      "C:/Program Files/Gemini/config.json",
      "--sandbox",
    ]);
    assert.ok(calls[0].args.includes("-p"));
  });
});

describe("checkGeminiAuth behavior", () => {
  beforeEach(() => {
    delete process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY;
    delete process.env.GEMINI_RESEARCHER_GEMINI_COMMAND;
    delete process.env.GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.VERTEX_AI_PROJECT;
  });

  it("returns configured/api_key when GEMINI_API_KEY is set and does not probe", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    let called = false;
    const mockExecuteCommand: ExecuteCommandMock = async () => {
      called = true;
      return "";
    };

    const auth = await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });
    assert.deepStrictEqual(auth, { configured: true, status: "configured", method: "api_key" });
    assert.strictEqual(called, false);
  });

  it("returns configured/vertex_ai when vertex env is set and does not probe", async () => {
    process.env.VERTEX_AI_PROJECT = "proj";

    let called = false;
    const mockExecuteCommand: ExecuteCommandMock = async () => {
      called = true;
      return "";
    };

    const auth = await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });
    assert.deepStrictEqual(auth, { configured: true, status: "configured", method: "vertex_ai" });
    assert.strictEqual(called, false);
  });

  it("returns configured/google_login on successful probe with exact args", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      return JSON.stringify({ response: "ok" });
    };

    const auth = await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args.slice(0, 8), [
      "-m",
      MODELS.FLASH_LITE_DEFAULT,
      "--output-format",
      "json",
      "--approval-mode",
      "default",
      "--admin-policy",
      getReadOnlyPolicyPath(),
    ]);
    const promptFlagIndex = calls[0].args.indexOf("-p");
    assert.ok(promptFlagIndex > -1);
    assert.strictEqual(calls[0].args[promptFlagIndex + 1], "Respond with exactly OK. Do not call any tools.");
    assert.deepStrictEqual(auth, { configured: true, status: "configured", method: "google_login" });
  });

  it("uses command override and args prefix for auth probe", async () => {
    process.env.GEMINI_RESEARCHER_GEMINI_COMMAND = "custom-gemini";
    process.env.GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX = "--config custom.toml";

    const calls: Array<{ command: string; args: string[] }> = [];
    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      return JSON.stringify({ response: "ok" });
    };

    const auth = await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, "custom-gemini");
    assert.deepStrictEqual(calls[0].args.slice(0, 2), ["--config", "custom.toml"]);
    assert.strictEqual(auth.status, "configured");
  });

  it("omits admin policy in auth probe when enforcement disabled", async () => {
    process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY = "false";

    const calls: Array<{ command: string; args: string[] }> = [];
    const mockExecuteCommand: ExecuteCommandMock = async (command, args) => {
      calls.push({ command, args: [...args] });
      return JSON.stringify({ response: "ok" });
    };

    await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });

    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].args.includes("-p"));
    assert.ok(!calls[0].args.includes("--admin-policy"));
  });

  it("classifies auth-like failures as unauthenticated", async () => {
    const mockExecuteCommand: ExecuteCommandMock = async () => {
      throw new Error("Unauthenticated: login required");
    };

    const auth = await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });

    assert.strictEqual(auth.configured, false);
    assert.strictEqual(auth.status, "unauthenticated");
    assert.ok(typeof auth.reason === "string");
  });

  it("classifies permission denied failures as unauthenticated", async () => {
    const mockExecuteCommand: ExecuteCommandMock = async () => {
      throw new Error("Permission denied: cannot access keychain");
    };

    const auth = await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });

    assert.strictEqual(auth.configured, false);
    assert.strictEqual(auth.status, "unauthenticated");
  });

  it("classifies ambiguous failures as unknown", async () => {
    const mockExecuteCommand: ExecuteCommandMock = async () => {
      throw new Error("Temporary network failure");
    };

    const auth = await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });

    assert.strictEqual(auth.configured, false);
    assert.strictEqual(auth.status, "unknown");
    assert.ok(typeof auth.reason === "string");
  });

  it("marks launch-path failures as unknown with launchFailed=true", async () => {
    const mockExecuteCommand: ExecuteCommandMock = async () => {
      throw new Error(
        "Command launch failed for 'gemini': Failed to spawn command 'gemini': spawn gemini ENOENT. Attempted commands: direct:gemini"
      );
    };

    const auth = await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });

    assert.strictEqual(auth.configured, false);
    assert.strictEqual(auth.status, "unknown");
    assert.strictEqual(auth.launchFailed, true);
  });
});

describe("auth error classifier", () => {
  it("detects auth-like error messages consistently", () => {
    assert.strictEqual(isAuthRelatedErrorMessage("Unauthenticated: login required"), true);
    assert.strictEqual(isAuthRelatedErrorMessage("Permission denied while loading credentials"), true);
    assert.strictEqual(isAuthRelatedErrorMessage("Temporary network failure"), false);
  });
});

describe("quota/capacity error classifier", () => {
  it("detects quota and capacity-like errors consistently", () => {
    assert.strictEqual(isQuotaOrCapacityErrorMessage("Quota exceeded for quota metric"), true);
    assert.strictEqual(isQuotaOrCapacityErrorMessage("RESOURCE_EXHAUSTED: Rate limit exceeded"), true);
    assert.strictEqual(isQuotaOrCapacityErrorMessage("429 Too Many Requests"), true);
    assert.strictEqual(isQuotaOrCapacityErrorMessage("Temporary network failure"), false);
  });
});

describe("output format capability checks", () => {
  it("returns true when help shows both json and stream-json output formats", async () => {
    const mockHelp = `
Options:
  -o, --output-format  The format of the CLI output. [string] [choices: "text", "json", "stream-json"]
`;

    const mockExecuteCommand: ExecuteCommandMock = async () => mockHelp;
    const supported = await supportsRequiredOutputFormats({ executeCommandFn: mockExecuteCommand });
    assert.strictEqual(supported, true);
  });

  it("returns false when stream-json is missing from help output choices", async () => {
    const mockHelp = `
Options:
  -o, --output-format  The format of the CLI output. [string] [choices: "text", "json"]
`;

    const mockExecuteCommand: ExecuteCommandMock = async () => mockHelp;
    const supported = await supportsRequiredOutputFormats({ executeCommandFn: mockExecuteCommand });
    assert.strictEqual(supported, false);
  });

  it("reports launch-first probe diagnostics when help command cannot be spawned", async () => {
    const mockExecuteCommand: ExecuteCommandMock = async () => {
      throw new Error(
        "Command launch failed for 'gemini': Failed to spawn command 'gemini': spawn gemini ENOENT. Attempted commands: direct:gemini"
      );
    };

    const checks = await getGeminiCliCapabilityChecks({ executeCommandFn: mockExecuteCommand });
    assert.strictEqual(checks.probeSucceeded, false);
    assert.strictEqual(checks.launchFailed, true);
    assert.strictEqual(checks.hasAdminPolicyFlag, false);
    assert.strictEqual(checks.supportsRequiredOutputFormats, false);
    assert.ok(checks.reason?.includes("Command launch failed"));
  });

  it("surfaces resolution metadata when help probe fallback succeeds", async () => {

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-help-fallback-"));
    const commandBase = path.join(tempDir, "gemini-help");
    const commandShim = `${commandBase}.cmd`;

    fs.writeFileSync(
      commandShim,
      [
        "#!/usr/bin/env node",
        'process.stdout.write(\'Options:\\n  --output-format [choices: "text", "json", "stream-json"]\\n  --admin-policy <path>\\n\');',
        "",
      ].join("\n"),
      { encoding: "utf-8", mode: 0o755 }
    );
    fs.chmodSync(commandShim, 0o755);

    const relativeCommand = path.relative(process.cwd(), commandBase).split(path.sep).join("/");
    const originalCommand = process.env.GEMINI_RESEARCHER_GEMINI_COMMAND;
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

    process.env.GEMINI_RESEARCHER_GEMINI_COMMAND = relativeCommand;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const checks = await getGeminiCliCapabilityChecks();
      assert.strictEqual(checks.probeSucceeded, true);
      assert.strictEqual(checks.resolution?.attemptSucceeded, "cmd_shim");
      assert.deepStrictEqual(checks.resolution?.fallbacksAttempted, ["direct", "cmd_shim"]);

    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(process, "platform", originalPlatformDescriptor);
      }

      if (originalCommand !== undefined) {
        process.env.GEMINI_RESEARCHER_GEMINI_COMMAND = originalCommand;
      } else {
        delete process.env.GEMINI_RESEARCHER_GEMINI_COMMAND;
      }

        fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("marks probe as failed (not unsupported) when help command fails ambiguously", async () => {
    const mockExecuteCommand: ExecuteCommandMock = async () => {
      throw new Error("Temporary network failure");
    };

    const checks = await getGeminiCliCapabilityChecks({ executeCommandFn: mockExecuteCommand });
    assert.strictEqual(checks.probeSucceeded, false);
    assert.strictEqual(checks.launchFailed, false);
    assert.strictEqual(checks.hasAdminPolicyFlag, false);
    assert.strictEqual(checks.supportsRequiredOutputFormats, false);
    assert.ok(checks.reason?.includes("Temporary network failure"));
  });
});

describe("admin policy enforcement toggle", () => {
  it("defaults to enforced when env is unset", () => {
    delete process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY;
    assert.strictEqual(isAdminPolicyEnforced(), true);
  });

  it("disables enforcement for recognized falsey values", () => {
    const values = ["0", "false", "no", "off", "FALSE", " Off "];

    for (const value of values) {
      process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY = value;
      assert.strictEqual(isAdminPolicyEnforced(), false);
    }
  });

  it("keeps enforcement for other values", () => {
    process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY = "1";
    assert.strictEqual(isAdminPolicyEnforced(), true);

    process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY = "true";
    assert.strictEqual(isAdminPolicyEnforced(), true);
  });
});

describe("gemini command config", () => {
  beforeEach(() => {
    delete process.env.GEMINI_RESEARCHER_GEMINI_COMMAND;
    delete process.env.GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX;
  });

  it("defaults to gemini command with no args prefix", () => {
    const config = getGeminiCommandConfig();
    assert.strictEqual(config.command, "gemini");
    assert.deepStrictEqual(config.argsPrefix, []);
  });

  it("parses args prefix with quotes and spacing", () => {
    process.env.GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX = '--config "C:/Program Files/Gemini/config.toml" --sandbox';
    const config = getGeminiCommandConfig();

    assert.deepStrictEqual(config.argsPrefix, [
      "--config",
      "C:/Program Files/Gemini/config.toml",
      "--sandbox",
    ]);
  });

  it("preserves Windows backslashes in args prefix", () => {
    process.env.GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX = "--config C:\\tools\\gemini.toml --flag";
    const config = getGeminiCommandConfig();

    assert.deepStrictEqual(config.argsPrefix, ["--config", "C:\\tools\\gemini.toml", "--flag"]);
  });
});
