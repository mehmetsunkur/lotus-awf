import { test, expect } from "../support/fixtures";
import { startAgentMcpHost, ALICE_AUTH, mintSessionToken, type AgentMcpHost } from "./support/mcp-host";
import { connectHttpMcp, type LotusHttpMcpClient } from "../http/support/http-client";
import { ClaudeCodeDriver, CodexDriver, type AgentDriver } from "./support/agent-driver";
import type { WorkflowDefinition } from "../../../src/shared/types";

type AppDefinitions = {
  appConfig?: { appId: string };
  forms: Array<{ _id: string; docType: string }>;
  views: Array<{ _id: string; docType: string }>;
  workflows: WorkflowDefinition[];
};
type ValidationResult = { ok: boolean; errors: Array<{ field: string; message: string }> };

/**
 * Real-agent acceptance suite. A coding-agent CLI is given a natural-language task plus the
 * lotus MCP surfaces and must discover/compose the tools itself; we assert the resulting
 * lotus state (outcome oracle), never the tool-call transcript. The two scenarios run as a
 * driver matrix over every agent (claude, codex); each driver self-skips independently when
 * unavailable. See playwright.mcp.agent.config.ts and the plan for context.
 */

type Surface = "admin" | "designer" | "workspace";

const ALL_DRIVERS: AgentDriver[] = [new ClaudeCodeDriver(), new CodexDriver()];

/**
 * Which agents to run. `LOTUS_AGENT_DRIVERS` is an optional comma-separated allowlist of
 * driver names that selects regardless of which creds are present; unset (or "all") runs
 * every driver (each still self-skips without its own credentials). Examples:
 *   LOTUS_AGENT_DRIVERS=codex             -> only codex
 *   LOTUS_AGENT_DRIVERS=claude-code,codex -> both
 */
function selectDrivers(): AgentDriver[] {
  const want = (process.env.LOTUS_AGENT_DRIVERS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (want.length === 0 || want.includes("all")) return ALL_DRIVERS;
  const chosen = ALL_DRIVERS.filter((driver) => want.includes(driver.name));
  if (chosen.length === 0) {
    throw new Error(
      `LOTUS_AGENT_DRIVERS="${process.env.LOTUS_AGENT_DRIVERS}" matched no known drivers ` +
        `(valid: ${ALL_DRIVERS.map((driver) => driver.name).join(", ")})`
    );
  }
  return chosen;
}

const drivers = selectDrivers();

test.describe("MCP real-agent acceptance", () => {
  let host: AgentMcpHost;
  let apiUrl: string;
  const oracles: LotusHttpMcpClient[] = [];

  // The in-process host binds to this worker's locally-spawned API (worker fixture).
  test.beforeAll(async ({ apiBaseURL }) => {
    apiUrl = apiBaseURL;
    host = await startAgentMcpHost(apiBaseURL);
  });

  test.afterAll(async () => {
    await host.stop();
  });

  // State reset is handled by the auto `resetState` fixture (tests/mcp/support/fixtures.ts).

  test.afterEach(async () => {
    await Promise.all(oracles.splice(0).map((client) => client.close()));
  });

  /** Read-back client for outcome assertions (separate from the agent's own session). */
  async function oracle(surface: Surface): Promise<LotusHttpMcpClient> {
    const client = await connectHttpMcp(host.surfaceUrl(surface), ALICE_AUTH);
    oracles.push(client);
    return client;
  }

  /** Hand a task to the given agent over the named MCP surfaces. Skips when unavailable. */
  async function runAgent(driver: AgentDriver, prompt: string, surfaces: Surface[]) {
    if (!driver.isAvailable()) {
      const reason = driver.unavailableReason();
      // console.warn surfaces the reason in the runner output; the list reporter
      // otherwise shows a bare "-" with no explanation for the skip.
      console.warn(`[mcp-agent] skipping "${test.info().title}" — ${driver.name} unavailable: ${reason}`);
      test.skip(true, `${driver.name} unavailable: ${reason}`);
    }
    // Mint a fresh Bearer token (after the auto reset seeded the directory). Both drivers
    // authenticate to the host with it: Claude as a header, Codex via a bearer-token env var.
    const authorization = `Bearer ${await mintSessionToken(apiUrl)}`;
    const mcpServers = Object.fromEntries(
      surfaces.map((surface) => [
        `lotus-${surface}`,
        { url: host.surfaceUrl(surface), authorization }
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

  // Both scenarios run once per agent. Each driver self-skips independently when unavailable.
  for (const driver of drivers) {
    test.describe(driver.name, () => {
      // Scenario A — maintain an existing workflow.
      // Seeded expense workflow: draft -> submitted -> approved[final] / rejected[final].
      test("agent extends the expense workflow with a reimbursed step", async () => {
        await runAgent(
          driver,
          [
            "You manage a Lotus Notes app via the lotus designer MCP tools.",
            "Extend the workflow of the `expense` app: add a new final state named `reimbursed`",
            "(label \"Reimbursed\") and a transition from the `approved` state to `reimbursed`",
            "labelled \"Reimburse\". Inspect the current workflow first, then apply the change and",
            "confirm it validates."
          ].join(" "),
          ["designer"]
        );

        const designer = await oracle("designer");
        const defs = await designer.callJsonTool<AppDefinitions>("lotus_designer_get_app_definitions", {
          appId: "expense"
        });
        const workflow = defs.workflows.find((w) => w._id === "workflow:expense");
        expect(workflow, "expense workflow should exist").toBeTruthy();

        const reimbursed = workflow!.states.find((s) => s.name === "reimbursed");
        expect(reimbursed, "reimbursed state should be added").toBeTruthy();
        expect(reimbursed!.final).toBe(true);

        const transition = workflow!.transitions.find((t) => t.from === "approved" && t.to === "reimbursed");
        expect(transition, "approved -> reimbursed transition should be added").toBeTruthy();

        // The produced definition must be valid per the shared validator.
        const validation = await designer.callJsonTool<ValidationResult>("lotus_designer_validate_definition", {
          definition: workflow!
        });
        expect(validation.ok, `workflow invalid: ${JSON.stringify(validation.errors)}`).toBe(true);
      });

      // Scenario B — build a new app end-to-end across the admin + designer surfaces.
      test("agent builds a new leave-requests app with an approval workflow", async () => {
        await runAgent(
          driver,
          [
            "You build Lotus Notes apps via the lotus admin and lotus designer MCP tools.",
            "Create a new business app with appId `leave-requests`, title \"Leave Request\", and a",
            "document type `leave`. Then give the `leave` document type a standard approval workflow",
            "that is approved by the `group:finance` group. Verify the app and its workflow exist."
          ].join(" "),
          ["admin", "designer"]
        );

        const admin = await oracle("admin");
        const apps = await admin.callJsonTool<Array<{ appId: string }>>("lotus_admin_list_apps");
        expect(apps.map((app) => app.appId)).toContain("leave-requests");

        const designer = await oracle("designer");
        const defs = await designer.callJsonTool<AppDefinitions>("lotus_designer_get_app_definitions", {
          appId: "leave-requests"
        });
        expect(defs.forms.length, "app should have at least one form").toBeGreaterThan(0);
        expect(defs.views.length, "app should have at least one view").toBeGreaterThan(0);
        expect(defs.workflows.length, "app should have a workflow").toBeGreaterThan(0);

        const workflow = defs.workflows[0];
        expect(workflow.initialState, "workflow needs an initial state").toBeTruthy();

        // A standard approval workflow has at least one role-gated approval transition.
        const approval = workflow.transitions.find((t) => Boolean(t.requiredRole));
        expect(approval, "workflow should have a role-gated approval transition").toBeTruthy();
        expect(approval!.requiredRole).toMatch(/finance/i);

        const validation = await designer.callJsonTool<ValidationResult>("lotus_designer_validate_definition", {
          definition: workflow
        });
        expect(validation.ok, `workflow invalid: ${JSON.stringify(validation.errors)}`).toBe(true);
      });
    });
  }
});
