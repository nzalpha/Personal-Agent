# Connect Exa MCP before building

Clone and install dependencies at the start of the presentation. When hands-on work begins, connect Exa to your coding assistant so it can find current API documentation while you build.

1. Open [Exa’s setup page](https://exa.ai/mcp) and choose your coding assistant.
2. Add a remote MCP server named `exa` with URL `https://mcp.exa.ai/mcp`, following that client’s instructions. Reconnect or restart the client if required.
3. Confirm Exa tools appear, then paste the prompt below. Watch the actual Exa tool invocation and open the returned official documentation link.

```text
Use Exa to find the official Search API docs.
Show how to request highlights.
Cite the official documentation URL.
Do not write code yet.
```

For Cursor, the [official setup](https://exa.ai/mcp) shows this configuration for `~/.cursor/mcp.json`. Merge it with existing servers rather than replacing them:

```json
{
  "mcpServers": {
    "exa": { "url": "https://mcp.exa.ai/mcp" }
  }
}
```

This MCP connection gives the coding assistant a documentation research tool. The personal agent built in TODO 2 still calls the Search API directly with its own `EXA_API_KEY`.

The [official server README](https://github.com/exa-labs/exa-mcp-server) documents `web_search_exa` as a default tool and anonymous hosted access with rate limits. Arrange authenticated access before a large workshop rather than relying on shared anonymous capacity. Keep API keys out of prompts and public configuration examples.
