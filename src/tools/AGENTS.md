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

### State & Safety
- ❌ **DON'T**: Expose any tool that modifies the filesystem. All tools MUST be read-only proxy actions to the Gemini CLI.

## Key Files

- `src/tools/registry.ts` - Add new tools here.
- `src/tools/deep-research.tool.ts` - Example of a complex tool with chunked responses.

## Common Gotchas

- **Schema Validation**: Make sure the Zod schema exactly matches the arguments expected by the tool handler.
- **Descriptions**: Tool descriptions are passed directly to the AI client. Make them extremely descriptive so Claude/Copilot know when to use them.