import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

type ToolTextContent = {
  type: "text";
  text: string;
};

export type LotusMcpTestClient = {
  listTools(): Promise<string[]>;
  callJsonTool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
};

export type LotusMcpServerKind = "admin" | "designer" | "workspace";

function firstText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error(`Tool result had no content: ${JSON.stringify(result)}`);
  const text = content.find((item): item is ToolTextContent =>
    Boolean(item && typeof item === "object" && (item as ToolTextContent).type === "text")
  );
  if (!text) throw new Error(`Tool result had no text content: ${JSON.stringify(result)}`);
  return text.text;
}

export type LotusMcpCredentials = { username: string; password: string };

export async function connectLotusMcp(
  kind: LotusMcpServerKind,
  apiUrl: string,
  credentials: LotusMcpCredentials = { username: "alice", password: "password123" }
): Promise<LotusMcpTestClient> {
  const client = new Client({ name: "lotus-mcp-e2e", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", `src/mcp/${kind}-server.ts`],
    cwd: process.cwd(),
    env: {
      ...process.env,
      // Point the spawned stdio server at this worker's locally-spawned API.
      LOTUS_API_URL: apiUrl,
      LOTUS_USERNAME: credentials.username,
      LOTUS_PASSWORD: credentials.password
    },
    stderr: "pipe"
  });
  await client.connect(transport);

  return {
    async listTools(): Promise<string[]> {
      const result = await client.listTools();
      return result.tools.map((tool) => tool.name);
    },
    async callJsonTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const result = await client.callTool({ name, arguments: args }, CallToolResultSchema);
      if (result.isError) throw new Error(firstText(result));
      return JSON.parse(firstText(result)) as T;
    },
    async close(): Promise<void> {
      await transport.close();
    }
  };
}
