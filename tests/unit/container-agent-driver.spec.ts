import { describe, expect, it } from "vitest";
import { checkAgentIsolationPolicy } from "../../src/operator/container-agent-driver";

describe("container agent isolation policy", () => {
  it("allows ordinary MCP transcript text", () => {
    expect(checkAgentIsolationPolicy("mcp: lotus-workspace/lotus_workspace_get_session completed").ok).toBe(true);
  });

  it("flags repo, fixture, direct CouchDB, and direct API leakage", () => {
    const result = checkAgentIsolationPolicy(
      [
        "/workspace/sunkur-ai/lotus-notes/src/operator/agent-driver.ts",
        "tests/mcp/agent/fixtures/field-services/template.json",
        "http://admin:password@server-couchdb:5984/_all_dbs",
        "GET /api/apps/agent-field-services/documents",
        "GET /api/work-queue?items=true"
      ].join("\n")
    );

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        "repo workspace path",
        "agent fixture path",
        "direct CouchDB URL",
        "direct Lotus app API route",
        "direct work-queue API route"
      ])
    );
  });
});
