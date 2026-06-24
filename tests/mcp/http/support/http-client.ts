import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

export type LotusHttpMcpClient = {
  listTools(): Promise<string[]>;
  callJsonTool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
};

export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function firstText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error(`Tool result had no content: ${JSON.stringify(result)}`);
  const text = content.find(
    (item): item is { type: "text"; text: string } =>
      Boolean(item && typeof item === "object" && (item as { type?: string }).type === "text")
  );
  if (!text) throw new Error(`Tool result had no text content: ${JSON.stringify(result)}`);
  return text.text;
}

/** Connect an MCP client to the HTTP host surface using the given Authorization header value. */
export async function connectHttpMcp(baseUrl: string, authorization?: string): Promise<LotusHttpMcpClient> {
  const client = new Client({ name: "lotus-mcp-http-e2e", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: authorization ? { headers: { authorization } } : undefined
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
