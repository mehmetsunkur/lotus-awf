import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { LotusClient } from "./lotus-client";
import { lotusClientFromEnv } from "./lotus-client";

export type LotusMcpSurface = "admin" | "designer" | "workspace";

export type RegisterTools = (server: McpServer, client: LotusClient) => void;

/** Build a server bound to an explicit, caller-provided client (per-session HTTP host). */
export function createLotusMcpServerWithClient(
  surface: LotusMcpSurface,
  registerTools: RegisterTools,
  client: LotusClient
): McpServer {
  const server = new McpServer({
    name: `lotus-${surface}`,
    version: "0.1.0"
  });
  registerTools(server, client);
  return server;
}

/** Build a server bound to the env-configured client (stdio entrypoints). */
export function createLotusMcpServer(surface: LotusMcpSurface, registerTools: RegisterTools): McpServer {
  return createLotusMcpServerWithClient(surface, registerTools, lotusClientFromEnv());
}

export async function runLotusMcpServer(surface: LotusMcpSurface, registerTools: RegisterTools): Promise<void> {
  const server = createLotusMcpServer(surface, registerTools);
  await server.connect(new StdioServerTransport());
}

export function reportMcpError(error: unknown): never {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

