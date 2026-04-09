# Tools - MCP Tool Definitions

**Technology**: TypeScript, Zod, @modelcontextprotocol/sdk
**Entry Point**: `src/tools/registry.ts`
**Parent Context**: This extends [../../AGENTS.md](../../AGENTS.md)

## Architecture

### Tool Definition Pattern
- ✅ **DO**: Define tools with a clear Zod schema and handler function
  - Example: `src/tools/quick-query.tool.ts`
  - Pattern: Export an object with `name`, `description`, `schema`, and `handler`.
- ✅ **DO**: Register every new tool in `src/tools/registry.ts`.
- ✅ **DO**: Handle large responses by chunking and utilizing `fetch_chunk`.

### State & Safety
- ❌ **DON'T**: Expose any tool that modifies the filesystem. All tools MUST be read-only proxy actions to the Gemini CLI.
- ❌ **DON'T**: Let tools bypass the strict read-only policy (`--admin-policy`) unless `GEMINI_RESEARCHER_ENFORCE_ADMIN_POLICY=0` is set.

## Key Files

- `src/tools/registry.ts` - Add new tools here.
- `src/tools/deep-research.tool.ts` - Example of a complex tool with chunked responses.
- `src/tools/health-check.tool.ts` - Diagnostics tool determining status (`ok`, `degraded`).

## Common Gotchas

- **Schema Validation**: Make sure the Zod schema exactly matches the arguments expected by the tool handler.
- **Descriptions**: Tool descriptions are passed directly to the AI client. Make them extremely descriptive so Claude/Copilot know when to use them.
- **Response Shape**: Return structured JSON (as MCP text content) representing the output, ensuring stable error codes if applicable.