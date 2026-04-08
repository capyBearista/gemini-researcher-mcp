#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const PROJECT_ROOT = process.env.PROJECT_ROOT || REPO_ROOT;

const EXPECTED_TOOLS = [
  "analyze_directory",
  "deep_research",
  "fetch_chunk",
  "health_check",
  "quick_query",
  "validate_paths",
].sort();

const VALID_PROFILES = new Set(["fast", "heavy"]);
const DEFAULT_PROFILE = "heavy";

const stderrLines = [];
const checks = [];

let client;
let transport;

function printUsage() {
  process.stdout.write(
    [
      "Usage: node tests/manual/mcp-live-smoke.mjs [--profile fast|heavy]",
      "",
      "Profiles:",
      "  heavy (default) - full end-to-end flow including deep_research, fetch_chunk continuation, and analyze_directory",
      "  fast            - core smoke checks only (skips heavy long-running checks)",
      "",
      "Examples:",
      "  npm run test:smoke:live",
      "  npm run test:smoke:live -- --profile fast",
      "",
    ].join("\n")
  );
}

function parseCliArgs(argv) {
  let profile = DEFAULT_PROFILE;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      return { help: true, profile };
    }

    if (arg === "--profile") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --profile");
      }
      if (!VALID_PROFILES.has(value)) {
        throw new Error(`Invalid profile '${value}'. Expected one of: fast, heavy`);
      }
      profile = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help: false, profile };
}

function nowIso() {
  return new Date().toISOString();
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function pushStderr(data) {
  const lines = String(data)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    stderrLines.push(line);
  }

  if (stderrLines.length > 200) {
    stderrLines.splice(0, stderrLines.length - 200);
  }
}

function parseJsonTextResult(result, toolName) {
  const textItem = result?.content?.find((item) => item?.type === "text");
  if (!textItem || typeof textItem.text !== "string") {
    throw new Error(`${toolName} did not return a text payload`);
  }

  try {
    return JSON.parse(textItem.text);
  } catch (error) {
    throw new Error(`${toolName} returned non-JSON text: ${toErrorMessage(error)}`);
  }
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCheck(name, fn) {
  const startedAt = Date.now();
  process.stdout.write(`[${nowIso()}] RUN  ${name}\n`);
  try {
    const details = await fn();
    const durationMs = Date.now() - startedAt;
    checks.push({ name, status: "PASS", durationMs, details });
    process.stdout.write(`[${nowIso()}] PASS ${name} (${durationMs}ms)\n`);
    return details;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = toErrorMessage(error);
    checks.push({ name, status: "FAIL", durationMs, details: message });
    process.stdout.write(`[${nowIso()}] FAIL ${name} (${durationMs}ms): ${message}\n`);
    throw error;
  }
}

function printMatrix() {
  process.stdout.write("\n=== Live Smoke Sign-Off Matrix ===\n");
  for (const check of checks) {
    const line = `${check.status.padEnd(4)} | ${String(check.durationMs).padStart(7)} ms | ${check.name}`;
    process.stdout.write(`${line}\n`);
  }
}

function printStderrTail() {
  if (stderrLines.length === 0) {
    return;
  }

  process.stdout.write("\n=== Server STDERR Tail ===\n");
  const tail = stderrLines.slice(-40);
  for (const line of tail) {
    process.stdout.write(`${line}\n`);
  }
}

async function main(profile) {
  process.stdout.write("Gemini Researcher Live MCP Smoke Test\n");
  process.stdout.write(`Repository root: ${REPO_ROOT}\n`);
  process.stdout.write(`Project root: ${PROJECT_ROOT}\n`);
  process.stdout.write(`Profile: ${profile}\n`);
  process.stdout.write("Fail mode: hard-fail on first error\n\n");

  transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PROJECT_ROOT,
      RESPONSE_CHUNK_SIZE_KB: "1",
    },
    stderr: "pipe",
  });

  if (transport.stderr) {
    transport.stderr.on("data", pushStderr);
  }

  client = new Client(
    { name: "gemini-researcher-live-smoke", version: "1.0.0" },
    { capabilities: {} }
  );

  await runCheck("Initialize MCP session", async () => {
    await client.connect(transport, { timeout: 180000 });
    return { connected: true };
  });

  await runCheck("tools/list returns expected tool set", async () => {
    const listed = await client.listTools(undefined, { timeout: 120000 });
    const names = listed.tools.map((tool) => tool.name).sort();
    assertCondition(
      JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS),
      `tools/list mismatch. expected=${EXPECTED_TOOLS.join(",")} actual=${names.join(",")}`
    );
    return { names };
  });

  await runCheck("health_check diagnostics are healthy", async () => {
    const result = await client.callTool(
      { name: "health_check", arguments: { includeDiagnostics: true } },
      undefined,
      {
        timeout: 180000,
        maxTotalTimeout: 240000,
        resetTimeoutOnProgress: true,
      }
    );
    const payload = parseJsonTextResult(result, "health_check");
    assertCondition(payload.tool === "health_check", "health_check tool field mismatch");
    assertCondition(payload.status === "ok", `health_check status expected ok, got ${payload.status}`);
    assertCondition(payload.diagnostics?.authStatus === "configured", "authStatus must be configured");
    assertCondition(payload.diagnostics?.readOnlyModeEnforced === true, "readOnlyModeEnforced must be true");
    return {
      status: payload.status,
      authStatus: payload.diagnostics?.authStatus,
      readOnlyModeEnforced: payload.diagnostics?.readOnlyModeEnforced,
      geminiVersion: payload.diagnostics?.geminiVersion,
    };
  });

  await runCheck("quick_query returns valid response", async () => {
    const result = await client.callTool(
      {
        name: "quick_query",
        arguments: {
          prompt: "Respond with exactly OK.",
          responseStyle: "concise",
        },
      },
      undefined,
      {
        timeout: 300000,
        maxTotalTimeout: 420000,
        resetTimeoutOnProgress: true,
      }
    );
    const payload = parseJsonTextResult(result, "quick_query");
    assertCondition(payload.tool === "quick_query", "quick_query tool field mismatch");
    assertCondition(typeof payload.answer === "string", "quick_query answer missing");
    assertCondition(/\bok\b/i.test(payload.answer), `quick_query answer did not contain OK: ${payload.answer}`);
    return { model: payload.model, latencyMs: payload.stats?.latencyMs, answer: payload.answer };
  });

  if (profile === "heavy") {
    const deepPayload = await runCheck("deep_research returns chunked response", async () => {
      const result = await client.callTool(
        {
          name: "deep_research",
          arguments: {
            prompt:
              "Provide 260 concise bullet points about software testing techniques. Keep each bullet one sentence.",
            citationMode: "none",
          },
        },
        undefined,
        {
          timeout: 600000,
          maxTotalTimeout: 900000,
          resetTimeoutOnProgress: true,
        }
      );
      const payload = parseJsonTextResult(result, "deep_research");
      assertCondition(payload.tool === "deep_research", "deep_research tool field mismatch");
      assertCondition(payload.chunks?.cacheKey, "deep_research did not include chunks.cacheKey");
      assertCondition(payload.chunks?.total > 1, `expected chunk total > 1, got ${payload.chunks?.total}`);
      return payload;
    });

    await runCheck("fetch_chunk returns continuation chunk", async () => {
      const result = await client.callTool(
        {
          name: "fetch_chunk",
          arguments: {
            cacheKey: deepPayload.chunks.cacheKey,
            chunkIndex: 2,
          },
        },
        undefined,
        { timeout: 120000 }
      );
      const payload = parseJsonTextResult(result, "fetch_chunk");
      assertCondition(payload.tool === "fetch_chunk", "fetch_chunk tool field mismatch");
      assertCondition(payload.chunk?.index === 2, `fetch_chunk index expected 2, got ${payload.chunk?.index}`);
      assertCondition(payload.chunk?.total >= 2, `fetch_chunk total expected >=2, got ${payload.chunk?.total}`);
      assertCondition(
        typeof payload.chunk?.content === "string" && payload.chunk.content.length > 0,
        "fetch_chunk content is empty"
      );
      return { index: payload.chunk.index, total: payload.chunk.total, contentLength: payload.chunk.content.length };
    });

    await runCheck("analyze_directory returns source inventory", async () => {
      const result = await client.callTool(
        {
          name: "analyze_directory",
          arguments: {
            path: ".",
            maxFiles: 80,
            depth: 4,
          },
        },
        undefined,
        {
          timeout: 900000,
          maxTotalTimeout: 1200000,
          resetTimeoutOnProgress: true,
        }
      );
      const payload = parseJsonTextResult(result, "analyze_directory");
      assertCondition(payload.tool === "analyze_directory", "analyze_directory tool field mismatch");
      assertCondition(Array.isArray(payload.entries), "analyze_directory entries missing");
      assertCondition(payload.entries.length > 0, "analyze_directory returned zero entries");
      assertCondition(payload.meta?.fileCount <= 80, `fileCount exceeds maxFiles: ${payload.meta?.fileCount}`);
      return { entryCount: payload.entries.length, fileCount: payload.meta?.fileCount };
    });
  } else {
    checks.push({
      name: "Heavy checks skipped (deep_research, fetch_chunk continuation, analyze_directory)",
      status: "PASS",
      durationMs: 0,
      details: { profile },
    });
    process.stdout.write(`[${nowIso()}] PASS Heavy checks skipped for profile '${profile}'\n`);
  }

  await runCheck("validate_paths enforces traversal restrictions", async () => {
    const result = await client.callTool(
      {
        name: "validate_paths",
        arguments: { paths: ["src/index.ts", "../../../etc/passwd"] },
      },
      undefined,
      { timeout: 120000 }
    );
    const payload = parseJsonTextResult(result, "validate_paths");
    const valid = payload.results?.find((entry) => entry.input === "src/index.ts");
    const invalid = payload.results?.find((entry) => entry.input === "../../../etc/passwd");
    assertCondition(valid?.allowed === true, "expected src/index.ts to be allowed");
    assertCondition(invalid?.allowed === false, "expected traversal path to be denied");
    return { validAllowed: valid.allowed, invalidAllowed: invalid.allowed };
  });

  await runCheck("quick_query blocks invalid @path prompt", async () => {
    const result = await client.callTool(
      {
        name: "quick_query",
        arguments: { prompt: "Analyze @../../../etc/passwd" },
      },
      undefined,
      { timeout: 120000 }
    );
    const payload = parseJsonTextResult(result, "quick_query/path-block");
    assertCondition(payload.error?.code === "PATH_NOT_ALLOWED", `expected PATH_NOT_ALLOWED, got ${payload.error?.code}`);
    return { errorCode: payload.error.code };
  });

  await runCheck("fetch_chunk invalid key returns structured error", async () => {
    const result = await client.callTool(
      {
        name: "fetch_chunk",
        arguments: { cacheKey: "cache_does_not_exist", chunkIndex: 1 },
      },
      undefined,
      { timeout: 120000 }
    );
    const payload = parseJsonTextResult(result, "fetch_chunk/invalid-key");
    assertCondition(payload.error?.code === "CACHE_EXPIRED", `expected CACHE_EXPIRED, got ${payload.error?.code}`);
    assertCondition(typeof payload.error?.message === "string", "error.message missing");
    assertCondition(payload.error?.details && typeof payload.error.details === "object", "error.details missing");
    return { errorCode: payload.error.code };
  });
}

async function shutdown() {
  if (client) {
    try {
      await client.close();
    } catch {
      // ignore close errors
    }
  }
}

let parsedArgs;

try {
  parsedArgs = parseCliArgs(process.argv.slice(2));
} catch (error) {
  process.stdout.write(`Argument error: ${toErrorMessage(error)}\n\n`);
  printUsage();
  process.exitCode = 1;
  process.exit();
}

if (parsedArgs.help) {
  printUsage();
  process.exitCode = 0;
  process.exit();
}

try {
  await main(parsedArgs.profile);
  await shutdown();
  printMatrix();
  process.stdout.write("\nFINAL SIGN-OFF: PASS\n");
  process.exitCode = 0;
} catch (error) {
  await shutdown();
  printMatrix();
  printStderrTail();
  process.stdout.write(`\nFINAL SIGN-OFF: FAIL\nReason: ${toErrorMessage(error)}\n`);
  process.exitCode = 1;
}
