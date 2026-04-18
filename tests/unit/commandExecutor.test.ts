import assert from "node:assert";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import {
  executeCommand,
  executeCommandWithResolution,
  isCommandNotFoundErrorMessage,
} from "../../src/utils/commandExecutor.js";

type FakeSpawnStep =
  | {
      type: "spawn_error";
      code: string;
      message: string;
    }
  | {
      type: "exit";
      code: number;
      stdout?: string;
      stderr?: string;
    };

interface FakeSpawnCall {
  command: string;
  args: string[];
  shell: boolean;
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(_signal?: NodeJS.Signals | number): boolean {
    this.emit("killed");
    return true;
  }
}

function createSpawnFn(script: FakeSpawnStep[], calls: FakeSpawnCall[]) {
  let index = 0;

  return (command: string, args: readonly string[], options: { shell?: boolean }) => {
    calls.push({
      command,
      args: [...args],
      shell: Boolean(options.shell),
    });

    const proc = new FakeChildProcess();
    const step = script[index++];

    setImmediate(() => {
      if (!step) {
        proc.emit("close", 0);
        return;
      }

      if (step.type === "spawn_error") {
        const error = Object.assign(new Error(step.message), { code: step.code });
        proc.emit("error", error);
        return;
      }

      if (step.stdout) {
        proc.stdout.emit("data", Buffer.from(step.stdout));
      }
      if (step.stderr) {
        proc.stderr.emit("data", Buffer.from(step.stderr));
      }
      proc.emit("close", step.code);
    });

    return proc;
  };
}

describe("commandExecutor Windows launch fallbacks", () => {
  it("retries with .cmd shim on win32 after ENOENT", async () => {
    const calls: FakeSpawnCall[] = [];
    const spawnFn = createSpawnFn(
      [
        { type: "spawn_error", code: "ENOENT", message: "spawn gemini ENOENT" },
        { type: "exit", code: 0, stdout: "ok\n" },
      ],
      calls
    );

    const output = await executeCommand(
      "gemini",
      ["--version"],
      undefined,
      { platform: "win32", spawnFn } as never
    );

    assert.strictEqual(output, "ok");
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].command, "gemini");
    assert.strictEqual(calls[1].command, "gemini.cmd");
    assert.strictEqual(calls[1].shell, false);
  });

  it("uses shell fallback on win32 when direct and .cmd launches fail", async () => {
    const calls: FakeSpawnCall[] = [];
    const spawnFn = createSpawnFn(
      [
        { type: "spawn_error", code: "ENOENT", message: "spawn gemini ENOENT" },
        { type: "spawn_error", code: "EINVAL", message: "spawn gemini.cmd EINVAL" },
        { type: "exit", code: 0, stdout: "from-shell\n" },
      ],
      calls
    );

    const output = await executeCommand(
      "gemini",
      ["--help"],
      undefined,
      { platform: "win32", spawnFn } as never
    );

    assert.strictEqual(output, "from-shell");
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[0].shell, false);
    assert.strictEqual(calls[1].shell, false);
    assert.strictEqual(calls[2].shell, false);
  });

  it("escapes percent signs before cmd fallback invocation", async () => {
    const calls: FakeSpawnCall[] = [];
    const spawnFn = createSpawnFn(
      [
        { type: "spawn_error", code: "ENOENT", message: "spawn gemini ENOENT" },
        { type: "spawn_error", code: "EINVAL", message: "spawn gemini.cmd EINVAL" },
        { type: "exit", code: 0, stdout: "ok\n" },
      ],
      calls
    );

    await executeCommand(
      "gemini",
      ["-p", "show %PATH%"],
      undefined,
      { platform: "win32", spawnFn } as never
    );

    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[2].command, "cmd");
    assert.ok(calls[2].args[4].includes("%%PATH%%"));
  });

  it("does not use Windows fallback chain on non-win32 platforms", async () => {
    const calls: FakeSpawnCall[] = [];
    const spawnFn = createSpawnFn(
      [{ type: "spawn_error", code: "ENOENT", message: "spawn gemini ENOENT" }],
      calls
    );

    await assert.rejects(
      executeCommand(
        "gemini",
        ["--version"],
        undefined,
        { platform: "linux", spawnFn } as never
      ),
      /spawn gemini ENOENT/
    );

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, "gemini");
  });

  it("does not fallback when process starts but exits non-zero", async () => {
    const calls: FakeSpawnCall[] = [];
    const spawnFn = createSpawnFn(
      [{ type: "exit", code: 1, stderr: "real command failure" }],
      calls
    );

    await assert.rejects(
      executeCommand(
        "gemini",
        ["--version"],
        undefined,
        { platform: "win32", spawnFn } as never
      ),
      /exit code 1/
    );

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, "gemini");
  });

  it("reports resolution metadata when cmd shim fallback succeeds", async () => {
    const calls: FakeSpawnCall[] = [];
    const spawnFn = createSpawnFn(
      [
        { type: "spawn_error", code: "ENOENT", message: "spawn gemini ENOENT" },
        { type: "exit", code: 0, stdout: "ok\n" },
      ],
      calls
    );

    const result = await executeCommandWithResolution(
      "gemini",
      ["--version"],
      undefined,
      { platform: "win32", spawnFn } as never
    );

    assert.strictEqual(result.output, "ok");
    assert.strictEqual(result.resolution.command, "gemini");
    assert.strictEqual(result.resolution.attemptSucceeded, "cmd_shim");
    assert.strictEqual(result.resolution.resolvedPath, "gemini.cmd");
    assert.deepStrictEqual(result.resolution.fallbacksAttempted, ["direct", "cmd_shim"]);
  });

  it("skips win32 fallback chain for absolute command paths", async () => {
    const calls: FakeSpawnCall[] = [];
    const spawnFn = createSpawnFn(
      [{ type: "spawn_error", code: "ENOENT", message: "spawn C:\\tools\\gemini.exe ENOENT" }],
      calls
    );

    await assert.rejects(
      executeCommand(
        "C:\\tools\\gemini.exe",
        ["--version"],
        undefined,
        { platform: "win32", spawnFn } as never
      ),
      /Command launch failed for 'C:\\tools\\gemini\.exe'/
    );

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, "C:\\tools\\gemini.exe");
  });
});

describe("commandExecutor not-found classifier", () => {
  it("detects common command-not-found messages across platforms", () => {
    assert.strictEqual(
      isCommandNotFoundErrorMessage("Failed to spawn command 'gemini': spawn gemini ENOENT"),
      true
    );
    assert.strictEqual(isCommandNotFoundErrorMessage("/bin/sh: gemini: command not found"), true);
    assert.strictEqual(
      isCommandNotFoundErrorMessage(
        "'gemini' is not recognized as an internal or external command, operable program or batch file."
      ),
      true
    );
  });

  it("does not classify unrelated process failures as not-found", () => {
    assert.strictEqual(isCommandNotFoundErrorMessage("Command failed with exit code 1: rate limit exceeded"), false);
  });
});
