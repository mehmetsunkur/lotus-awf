import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  LotusApiError,
  lotusClientWithCredentials,
  lotusClientWithToken
} from "./lotus-client";
import type { LotusClient } from "./lotus-client";
import { createLotusMcpServerWithClient } from "./runtime";
import type { LotusMcpSurface, RegisterTools } from "./runtime";
import { registerAdminTools } from "./tools/admin";
import { registerDesignerTools } from "./tools/designer";
import { registerWorkspaceTools } from "./tools/workspace";
import { httpHostConfigFromEnv } from "./http-config";
import type { HttpHostConfig } from "./http-config";

const SURFACE_REGISTRARS: Record<LotusMcpSurface, RegisterTools> = {
  admin: registerAdminTools,
  designer: registerDesignerTools,
  workspace: registerWorkspaceTools
};

const SESSION_HEADER = "mcp-session-id";

type Session = {
  surface: LotusMcpSurface;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  client: LotusClient;
  lastSeen: number;
};

type Credentials =
  | { mode: "basic"; username: string; password: string }
  | { mode: "bearer"; token: string };

/** Parse an `Authorization` header into Lotus credentials, or null if absent/unsupported. */
function parseCredentials(header: string | undefined): Credentials | null {
  if (!header) return null;
  const [scheme, value] = header.split(/\s+/, 2);
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() === "basic") {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep === -1) return null;
    return { mode: "basic", username: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
  }
  if (scheme.toLowerCase() === "bearer") {
    return { mode: "bearer", token: value };
  }
  return null;
}

/**
 * Build a per-session client for the supplied credentials and prove the identity against the
 * Lotus API. The caller supplies credentials; the principal is always resolved server-side.
 * Throws on missing or invalid credentials.
 */
async function authenticate(config: HttpHostConfig, credentials: Credentials | null): Promise<LotusClient> {
  if (!credentials) throw new UnauthorizedError("missing Authorization header");
  const client =
    credentials.mode === "basic"
      ? lotusClientWithCredentials(config.apiUrl, credentials.username, credentials.password)
      : lotusClientWithToken(config.apiUrl, credentials.token);
  try {
    const session = await client.getSession();
    if (!session.authenticated) throw new UnauthorizedError("session is not authenticated");
    return client;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    if (error instanceof LotusApiError && error.status === 401) {
      throw new UnauthorizedError("invalid Lotus credentials");
    }
    throw error;
  }
}

class UnauthorizedError extends Error {}

/** Reject requests whose Host/Origin is not in the configured allowlist (DNS-rebinding guard). */
function originAllowed(config: HttpHostConfig, request: Request): boolean {
  const host = request.headers.host;
  if (config.allowedHosts.length > 0 && (!host || !config.allowedHosts.includes(host))) return false;
  const origin = request.headers.origin;
  if (config.allowedOrigins.length > 0 && origin && !config.allowedOrigins.includes(origin)) return false;
  return true;
}

function jsonRpcError(response: Response, status: number, message: string): void {
  response.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null
  });
}

export function createHttpHost(config: HttpHostConfig = httpHostConfigFromEnv()) {
  const app = express();
  app.use(express.json());

  const sessions = new Map<string, Session>();

  function dropSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
  }

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, surfaces: config.surfaces, sessions: sessions.size });
  });

  for (const surface of config.surfaces) {
    const path = `/mcp/${surface}`;

    app.post(path, async (request, response) => {
      if (!originAllowed(config, request)) {
        jsonRpcError(response, 403, "origin not allowed");
        return;
      }
      const sessionId = request.header(SESSION_HEADER);
      const existing = sessionId ? sessions.get(sessionId) : undefined;

      if (existing) {
        if (existing.surface !== surface) {
          jsonRpcError(response, 404, "session does not belong to this surface");
          return;
        }
        existing.lastSeen = Date.now();
        await existing.transport.handleRequest(request, response, request.body);
        return;
      }

      if (sessionId) {
        jsonRpcError(response, 404, "unknown session id");
        return;
      }

      if (!isInitializeRequest(request.body)) {
        jsonRpcError(response, 400, "no session id and not an initialize request");
        return;
      }

      let client: LotusClient;
      try {
        client = await authenticate(config, parseCredentials(request.header("authorization")));
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          response.setHeader("WWW-Authenticate", 'Basic realm="lotus-mcp", Bearer');
          jsonRpcError(response, 401, error.message);
          return;
        }
        throw error;
      }

      const server = createLotusMcpServerWithClient(surface, SURFACE_REGISTRARS[surface], client);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { surface, transport, server, client, lastSeen: Date.now() });
        },
        onsessionclosed: (id) => dropSession(id)
      });
      transport.onclose = () => {
        if (transport.sessionId) dropSession(transport.sessionId);
      };

      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    });

    const routeBySession = async (request: Request, response: Response) => {
      if (!originAllowed(config, request)) {
        jsonRpcError(response, 403, "origin not allowed");
        return;
      }
      const sessionId = request.header(SESSION_HEADER);
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session || session.surface !== surface) {
        jsonRpcError(response, 404, "unknown session id");
        return;
      }
      session.lastSeen = Date.now();
      await session.transport.handleRequest(request, response, request.body);
    };

    app.get(path, routeBySession);
    app.delete(path, routeBySession);
  }

  let sweeper: NodeJS.Timeout | undefined;
  function startSweeper(): void {
    sweeper = setInterval(() => {
      const cutoff = Date.now() - config.sessionTtlMs;
      for (const [id, session] of sessions) {
        if (session.lastSeen < cutoff) {
          dropSession(id);
          void session.transport.close();
        }
      }
    }, Math.min(config.sessionTtlMs, 60_000));
    sweeper.unref?.();
  }

  return {
    app,
    sessions,
    startSweeper,
    stop(): void {
      if (sweeper) clearInterval(sweeper);
    }
  };
}

function main(): void {
  const config = httpHostConfigFromEnv();
  const host = createHttpHost(config);
  host.startSweeper();
  host.app.listen(config.port, () => {
    console.log(`Lotus MCP HTTP host listening on ${config.port} (surfaces: ${config.surfaces.join(", ")})`);
  });
}

// Run as a server when invoked directly (tsx src/mcp/http-server.ts), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
