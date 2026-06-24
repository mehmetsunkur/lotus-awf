import type { LotusMcpSurface } from "./runtime";

const ALL_SURFACES: LotusMcpSurface[] = ["admin", "designer", "workspace"];

function parseNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got: ${value}`);
  }
  return parsed;
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSurfaces(value: string | undefined): LotusMcpSurface[] {
  const requested = parseList(value);
  if (requested.length === 0) return [...ALL_SURFACES];
  const enabled = requested.filter((item): item is LotusMcpSurface =>
    (ALL_SURFACES as string[]).includes(item)
  );
  if (enabled.length === 0) throw new Error(`MCP_HTTP_SURFACES had no valid surfaces: ${value}`);
  // Preserve canonical order and drop duplicates.
  return ALL_SURFACES.filter((surface) => enabled.includes(surface));
}

export type HttpHostConfig = {
  apiUrl: string;
  port: number;
  surfaces: LotusMcpSurface[];
  allowedHosts: string[];
  allowedOrigins: string[];
  sessionTtlMs: number;
};

/**
 * HTTP host configuration. Reads only from the environment so the host stays inside the
 * `src/mcp/**` layer (no import of `src/server/config`).
 */
export function httpHostConfigFromEnv(env = process.env): HttpHostConfig {
  return {
    apiUrl: env.LOTUS_API_URL ?? "http://localhost:3001",
    port: parseNumber(env.MCP_HTTP_PORT, 3002, "MCP_HTTP_PORT"),
    surfaces: parseSurfaces(env.MCP_HTTP_SURFACES),
    allowedHosts: parseList(env.MCP_ALLOWED_HOSTS),
    allowedOrigins: parseList(env.MCP_ALLOWED_ORIGINS),
    sessionTtlMs: parseNumber(env.MCP_SESSION_TTL_MS, 30 * 60 * 1000, "MCP_SESSION_TTL_MS")
  };
}
