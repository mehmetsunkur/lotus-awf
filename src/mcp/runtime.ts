import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { lotusClientFromEnv } from "./lotus-client";

export type LotusMcpSurface = "admin" | "designer" | "workspace";

export type RegisterTools = (server: McpServer, client: ReturnType<typeof lotusClientFromEnv>) => void;

export function createLotusMcpServer(surface: LotusMcpSurface, registerTools: RegisterTools): McpServer {
  const server = new McpServer({
    name: `lotus-${surface}`,
    version: "0.1.0"
  });
  registerTools(server, lotusClientFromEnv());
  return server;
}

export async function runLotusMcpServer(surface: LotusMcpSurface, registerTools: RegisterTools): Promise<void> {
  const server = createLotusMcpServer(surface, registerTools);
  await server.connect(new StdioServerTransport());
}

export function reportMcpError(error: unknown): never {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

