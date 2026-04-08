/**
 * Behavior-level unit tests for geminiExecutor CLI contract.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  executeGeminiCLI,
  checkGeminiAuth,
  isAdminPolicyEnforced,
  getReadOnlyPolicyPath,
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

    const promptArg = calls[0].args[calls[0].args.length - 1];
    assert.ok(promptArg.includes(getExpectedPromptSuffix("Analyze auth flow")));
    assert.ok(!calls[0].args.includes("-p"));
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

  it("falls back to tier-2 on quota error with exact argv", async () => {
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
    assert.deepStrictEqual(calls[1].args.slice(0, 2), ["-m", MODELS.FLASH_FALLBACK]);
    assert.strictEqual(result.model, MODELS.FLASH_FALLBACK);
  });

  it("falls back to tier-3 auto-select (no -m flag) after two quota errors", async () => {
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
    assert.ok(calls[2].args[0] !== "-m");
    assert.ok(!calls[2].args.includes("-m"));
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
});

describe("checkGeminiAuth behavior", () => {
  beforeEach(() => {
    delete process.env.GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY;
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
      MODELS.FLASH_FALLBACK,
      "--output-format",
      "json",
      "--approval-mode",
      "default",
      "--admin-policy",
      getReadOnlyPolicyPath(),
    ]);
    assert.strictEqual(calls[0].args[calls[0].args.length - 1], "test");
    assert.deepStrictEqual(auth, { configured: true, status: "configured", method: "google_login" });
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

  it("classifies ambiguous failures as unknown", async () => {
    const mockExecuteCommand: ExecuteCommandMock = async () => {
      throw new Error("Temporary network failure");
    };

    const auth = await checkGeminiAuth({ executeCommandFn: mockExecuteCommand });

    assert.strictEqual(auth.configured, false);
    assert.strictEqual(auth.status, "unknown");
    assert.ok(typeof auth.reason === "string");
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
