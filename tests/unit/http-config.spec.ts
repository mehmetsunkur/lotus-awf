import { describe, expect, it } from "vitest";
import { httpHostConfigFromEnv } from "../../src/mcp/http-config";

describe("httpHostConfigFromEnv", () => {
  it("applies defaults when env is empty", () => {
    const config = httpHostConfigFromEnv({});
    expect(config.apiUrl).toBe("http://localhost:3001");
    expect(config.port).toBe(3002);
    expect(config.surfaces).toEqual(["admin", "designer", "workspace"]);
    expect(config.sessionTtlMs).toBe(30 * 60 * 1000);
    expect(config.allowedHosts).toEqual([]);
  });

  it("parses and canonicalizes surfaces, dropping duplicates and unknowns", () => {
    const config = httpHostConfigFromEnv({ MCP_HTTP_SURFACES: "workspace, admin, workspace, bogus" });
    expect(config.surfaces).toEqual(["admin", "workspace"]);
  });

  it("throws when no valid surface is requested", () => {
    expect(() => httpHostConfigFromEnv({ MCP_HTTP_SURFACES: "bogus" })).toThrow(/no valid surfaces/);
  });

  it("rejects a malformed numeric env instead of yielding NaN", () => {
    expect(() => httpHostConfigFromEnv({ MCP_SESSION_TTL_MS: "abc" })).toThrow(/MCP_SESSION_TTL_MS/);
    expect(() => httpHostConfigFromEnv({ MCP_HTTP_PORT: "0" })).toThrow(/MCP_HTTP_PORT/);
    expect(() => httpHostConfigFromEnv({ MCP_HTTP_PORT: "-5" })).toThrow(/MCP_HTTP_PORT/);
  });

  it("parses host/origin allowlists", () => {
    const config = httpHostConfigFromEnv({
      MCP_ALLOWED_HOSTS: "a.example.com, b.example.com",
      MCP_ALLOWED_ORIGINS: "https://a.example.com"
    });
    expect(config.allowedHosts).toEqual(["a.example.com", "b.example.com"]);
    expect(config.allowedOrigins).toEqual(["https://a.example.com"]);
  });
});
