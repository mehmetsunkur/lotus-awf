import type { Server } from "node:http";
import { test, expect } from "../support/fixtures";
import { createHttpHost } from "../../../src/mcp/http-server";
import { httpHostConfigFromEnv } from "../../../src/mcp/http-config";
import { connectHttpMcp, basicAuth, type LotusHttpMcpClient } from "./support/http-client";
import type { SessionState } from "../../../src/shared/types";

test.describe("Lotus MCP over HTTP", () => {
  let host: ReturnType<typeof createHttpHost>;
  let server: Server;
  let port: number;
  const clients: LotusHttpMcpClient[] = [];

  const surfaceUrl = (surface: string) => `http://localhost:${port}/mcp/${surface}`;

  // The in-process host binds to this worker's locally-spawned API (worker fixture).
  test.beforeAll(async ({ apiBaseURL }) => {
    host = createHttpHost({ ...httpHostConfigFromEnv(), apiUrl: apiBaseURL });
    server = await new Promise<Server>((resolve) => {
      const s = host.app.listen(0, () => resolve(s));
    });
    port = (server.address() as { port: number }).port;
  });

  test.afterAll(async () => {
    host.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // State reset is handled by the auto `resetState` fixture (tests/mcp/support/fixtures.ts).

  test.afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  async function connect(surface: string, authorization?: string): Promise<LotusHttpMcpClient> {
    const client = await connectHttpMcp(surfaceUrl(surface), authorization);
    clients.push(client);
    return client;
  }

  test("rejects an unauthenticated initialize with 401", async ({ request }) => {
    const response = await request.post(surfaceUrl("admin"), {
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "no-auth", version: "0" } }
      }
    });
    expect(response.status()).toBe(401);
  });

  test("binds each session to its own authenticated identity", async () => {
    const aliceMcp = await connect("workspace", basicAuth("alice", "password123"));
    const bobMcp = await connect("workspace", basicAuth("bob", "password123"));

    const alice = await aliceMcp.callJsonTool<SessionState>("lotus_workspace_get_session");
    const bob = await bobMcp.callJsonTool<SessionState>("lotus_workspace_get_session");

    expect(alice.authenticated).toBe(true);
    expect(bob.authenticated).toBe(true);
    expect(alice.person?.username).toBe("alice");
    expect(bob.person?.username).toBe("bob");
    expect(alice.person?._id).not.toBe(bob.person?._id);
  });

  test("routes each surface to its own toolset", async () => {
    const admin = await connect("admin", basicAuth("alice", "password123"));
    const designer = await connect("designer", basicAuth("alice", "password123"));
    const workspace = await connect("workspace", basicAuth("alice", "password123"));

    expect(await admin.listTools()).toContain("lotus_admin_list_apps");
    expect(await designer.listTools()).toContain("lotus_designer_get_app_definitions");
    expect(await workspace.listTools()).toContain("lotus_workspace_list_documents");

    expect(await admin.listTools()).not.toContain("lotus_workspace_list_documents");
  });

  test("runs a representative read tool on each surface", async () => {
    const admin = await connect("admin", basicAuth("alice", "password123"));
    const designer = await connect("designer", basicAuth("alice", "password123"));
    const workspace = await connect("workspace", basicAuth("alice", "password123"));

    const apps = await admin.callJsonTool<Array<{ appId: string }>>("lotus_admin_list_apps");
    expect(apps.map((app) => app.appId)).toContain("expense");

    const definitions = await designer.callJsonTool<{ forms: unknown[] }>(
      "lotus_designer_get_app_definitions",
      { appId: "expense" }
    );
    expect(Array.isArray(definitions.forms)).toBe(true);

    const docs = await workspace.callJsonTool<unknown[]>("lotus_workspace_list_documents", {
      appId: "expense",
      docType: "expense"
    });
    expect(Array.isArray(docs)).toBe(true);
  });
});
