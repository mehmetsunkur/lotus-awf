import { test, expect } from "@playwright/test";
import { startAgentMcpHost, ALICE_AUTH, type AgentMcpHost } from "./support/mcp-host";
import { connectHttpMcp, type LotusHttpMcpClient } from "../http/support/http-client";
import { ClaudeCodeDriver, type AgentDriver } from "./support/agent-driver";

/**
 * Real-agent acceptance suite. The `claude` CLI is given a natural-language task plus the
 * lotus MCP surfaces and must discover/compose the tools itself; we assert the resulting
 * lotus state (outcome oracle), never the tool-call transcript. Opt-in: self-skips when the
 * driver is unavailable. See playwright.mcp.agent.config.ts and the plan for context.
 */

const API_URL = "http://localhost:3001";
type Surface = "admin" | "designer" | "workspace";

const driver: AgentDriver = new ClaudeCodeDriver();

test.describe("MCP real-agent acceptance", () => {
  let host: AgentMcpHost;
  const oracles: LotusHttpMcpClient[] = [];

  test.beforeAll(async () => {
    host = await startAgentMcpHost();
  });

  test.afterAll(async () => {
    await host.stop();
  });

  test.beforeEach(async ({ request }) => {
    const reset = await request.post(`${API_URL}/api/reset`);
    expect(reset.ok()).toBeTruthy();
  });

  test.afterEach(async () => {
    await Promise.all(oracles.splice(0).map((client) => client.close()));
  });

  /** Read-back client for outcome assertions (separate from the agent's own session). */
  async function oracle(surface: Surface): Promise<LotusHttpMcpClient> {
    const client = await connectHttpMcp(host.surfaceUrl(surface), ALICE_AUTH);
    oracles.push(client);
    return client;
  }

  /** Hand a task to the agent over the given MCP surfaces. Skips the test when unavailable. */
  async function runAgent(prompt: string, surfaces: Surface[]) {
    test.skip(!driver.isAvailable(), `agent driver unavailable: ${driver.unavailableReason()}`);
    const mcpServers = Object.fromEntries(
      surfaces.map((surface) => [
        `lotus-${surface}`,
        { url: host.surfaceUrl(surface), authorization: ALICE_AUTH }
      ])
    );
    const run = await driver.run({ prompt, mcpServers });
    // Sanity: the run actually went through the LiteLLM proxy to the configured model.
    expect(run.ok, `agent run failed: ${run.finalText}`).toBeTruthy();
    return run;
  }

  // Infrastructure check (no agent spend): API + host + reset + Basic auth + MCP read path.
  test("host exposes the designer read tools to an authenticated session", async () => {
    const designer = await oracle("designer");
    const tools = await designer.listTools();
    expect(tools).toContain("lotus_designer_get_app_definitions");
    expect(tools).toContain("lotus_designer_apply_workflow_patch");
  });
});
