import type { Server } from "node:http";
import { createHttpHost } from "../../../../src/mcp/http-server";
import { httpHostConfigFromEnv } from "../../../../src/mcp/http-config";
import { basicAuth } from "../../http/support/http-client";

/** Seeded developer identity the agent authenticates as (src/server/index.ts DEV_PASSWORD). */
export const ALICE_AUTH = basicAuth("alice", "password123");

/**
 * Mint a Lotus `lotus_session` token by logging in against the worker's API, so the
 * agent can authenticate to the MCP host with `Authorization: Bearer <token>`. Both
 * transports the suite drives accept Bearer (the host resolves the principal from it),
 * and Codex's HTTP MCP client only supports Bearer — so the agent path is unified on it.
 * Must be called AFTER `/api/reset` has seeded the directory (the auto resetState fixture).
 */
export async function mintSessionToken(
  apiUrl: string,
  username = "alice",
  password = "password123"
): Promise<string> {
  const response = await fetch(`${apiUrl}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) throw new Error(`Lotus login failed (${response.status}) minting a session token`);
  const token = /lotus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (!token) throw new Error("Lotus login succeeded but returned no lotus_session cookie");
  return token;
}

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
