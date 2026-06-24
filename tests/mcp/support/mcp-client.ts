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

function firstText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error(`Tool result had no content: ${JSON.stringify(result)}`);
  const text = content.find((item): item is ToolTextContent =>
    Boolean(item && typeof item === "object" && (item as ToolTextContent).type === "text")
  );
  if (!text) throw new Error(`Tool result had no text content: ${JSON.stringify(result)}`);
  return text.text;
}

export async function connectLotusMcp(): Promise<LotusMcpTestClient> {
  const client = new Client({ name: "lotus-mcp-e2e", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp/server.ts"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOTUS_API_URL: "http://localhost:3001",
      LOTUS_USERNAME: "alice",
      LOTUS_PASSWORD: "password123"
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
