import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { lotusClientFromEnv } from "./lotus-client";
import { registerLotusTools } from "./tools";

export function createLotusMcpServer(): McpServer {
  const server = new McpServer({
    name: "lotus-notes-mcp",
    version: "0.1.0"
  });
  registerLotusTools(server, lotusClientFromEnv());
  return server;
}

async function main(): Promise<void> {
  const server = createLotusMcpServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
