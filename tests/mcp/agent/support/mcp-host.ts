import type { Server } from "node:http";
import { createHttpHost } from "../../../../src/mcp/http-server";
import { httpHostConfigFromEnv } from "../../../../src/mcp/http-config";
import { basicAuth } from "../../http/support/http-client";

/** Seeded developer identity the agent authenticates as (src/server/index.ts DEV_PASSWORD). */
export const ALICE_AUTH = basicAuth("alice", "password123");

export type AgentMcpHost = {
  /** Ephemeral port the host listens on. */
  port: number;
  /** Full URL for one MCP surface, e.g. http://localhost:<port>/mcp/designer. */
  surfaceUrl(surface: "admin" | "designer" | "workspace"): string;
  /** Stop the host and release the port. */
  stop(): Promise<void>;
};

/**
 * Start an in-process MCP HTTP host on an ephemeral port, bound to the given API.
 * `apiUrl` is this worker's locally-spawned Express server (from the per-worker
 * harness fixture). Mirrors the bring-up in tests/mcp/http/http.spec.ts: empty
 * `allowedHosts` keeps the DNS-rebinding guard off so localhost works, and the host
 * authenticates each inbound Authorization header against the Lotus API per session.
 */
export async function startAgentMcpHost(apiUrl: string): Promise<AgentMcpHost> {
  const host = createHttpHost({ ...httpHostConfigFromEnv(), apiUrl });
  const server = await new Promise<Server>((resolve) => {
    const s = host.app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;

  return {
    port,
    surfaceUrl(surface) {
      return `http://localhost:${port}/mcp/${surface}`;
    },
    async stop() {
      host.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}
