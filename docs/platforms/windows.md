# Native Windows Guide

This guide explains why native Windows can fail in MCP shell-less runtimes and how to remediate quickly.

## Scope

Use this when:
- You run gemini-researcher on native Windows (PowerShell/CMD host).
- `gemini` works interactively, but MCP server launch or tool execution fails.
- Errors include `spawn ... ENOENT` or `GEMINI_CLI_LAUNCH_FAILED`.

## Non-Shell Spawn Caveat

Many MCP hosts launch stdio servers with shell disabled. On Windows, npm-installed commands (`npx`, `gemini`) are often shimmed (`.cmd`/`.ps1`) and can behave differently between:

- interactive shell command resolution, and
- direct non-shell process spawn.

Result: a command can appear available in PowerShell but still fail from a shell-less runtime.

Gemini Researcher mitigates this with a Windows launch fallback chain:
1. direct command launch,
2. `.cmd` shim launch,
3. `cmd /d /v:off /s /c` launch.

If only `cmd /c` works, health diagnostics warn so you can pin a more stable host command.

## Fast Decision Tree

1) **See launch failure first**
- Signal: `GEMINI_CLI_LAUNCH_FAILED` or `spawn ... ENOENT`
- Action: run `gemini --help` and `npx --version` in the same environment profile as your MCP host.

2) **If host still fails but interactive checks pass**
- Prefer Docker or WSL configuration for immediate reliability.

3) **If staying native Windows**
- Run `health_check` with `includeDiagnostics: true`.
- Inspect `diagnostics.resolution`.
- If `attemptSucceeded` is `cmd_shell`, update host config to use the `.cmd` shim directly.

4) **Only after launch succeeds**
- Triage capability issues (`--admin-policy`, output formats).
- Then triage auth (`AUTH_MISSING`, `AUTH_UNKNOWN`).

## Error Precedence

Interpret failures in this order:
1. launch failure,
2. capability failure,
3. auth failure.

Do not treat capability/auth messages as root cause if launch never succeeded.

## Environment Overrides for Advanced Users

Gemini Researcher supports runtime overrides:

- `GEMINI_RESEARCHER_GEMINI_COMMAND`
  - Exact command/binary path used for Gemini invocation.
  - If absolute path is provided, Windows shim fallback chain is not applied.

- `GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX`
  - Prefix arguments injected before every Gemini invocation.
  - Useful for wrapper configs (for example `--config <path>`).

Example (PowerShell):

```powershell
$env:GEMINI_RESEARCHER_GEMINI_COMMAND = "C:\\tools\\gemini.exe"
$env:GEMINI_RESEARCHER_GEMINI_ARGS_PREFIX = "--config C:\\tools\\gemini.toml"
```

## Quick Diagnostics Checklist

- `gemini --version`
- `gemini --help`
- `npx --version`
- `health_check` with `includeDiagnostics: true`
- MCP host logs with full launch command

When opening an issue, include OS version, shell, Node version, MCP host, exact errors, and `diagnostics.resolution` output.
