import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { startAgentMcpHost, type AgentMcpHost } from "./support/mcp-host";
import { ClaudeCodeDriver, CodexDriver, type AgentDriver } from "../../../src/operator/agent-driver";
import { AgentOperator, type OperatorConfig } from "../../../src/operator/operator";
import { adminApiContext, AIRLINE_PASSWORD, airlinePersonaContext } from "../support/airline";
import { seedDigitalTwin, type TwinScenario } from "../../e2e/support/scenario-digital-twin";
import {
  fileAgentSession,
  seedAgentOps,
  type AgentOpsScenario
} from "../../e2e/support/scenario-agent-ops";
import type { BusinessDocument } from "../../../src/shared/types";

/**
 * M28 real-driver operator session (opt-in / nightly): the daemon module runs
 * in-process against the worker harness with a REAL coding-agent CLI, proving the
 * whole chain end to end — a manager files a session document, the operator claims it
 * from its `@me` queue, derives carol's M27 prompt under her own session, hands the
 * driver only her workspace surface, and the session completes with artifacts while
 * carol's morning queue outcomes match the twin contract (S1: alpha assigned crew,
 * delta dispatched). One agent run per driver per pass — same cost regime as M26/M27.
 */

const ALL_DRIVERS: AgentDriver[] = [new ClaudeCodeDriver(), new CodexDriver()];

/** Replicated from agent.spec.ts (kept byte-identical — see that module). */
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

test.describe("MCP agent operator (real driver)", () => {
  let host: AgentMcpHost;
  let apiUrl: string;
  const contexts: APIRequestContext[] = [];

  test.beforeAll(async ({ apiBaseURL }) => {
    apiUrl = apiBaseURL;
    host = await startAgentMcpHost(apiBaseURL);
  });

  test.afterAll(async () => {
    await host.stop();
  });

  test.afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  for (const driver of drivers) {
    test.describe(driver.name, () => {
      test("runs a manager-filed carol session end to end", async ({ playwright }) => {
        test.setTimeout(900_000);
        if (!driver.isAvailable()) {
          const reason = driver.unavailableReason();
          console.warn(`[mcp-agent] skipping "${test.info().title}" — ${driver.name} unavailable: ${reason}`);
          test.skip(true, `${driver.name} unavailable: ${reason}`);
        }

        const admin = await adminApiContext(playwright, apiUrl);
        contexts.push(admin);
        const twin: TwinScenario = await seedDigitalTwin(admin, playwright, apiUrl);
        const ops: AgentOpsScenario = await seedAgentOps(admin);

        // A manager (carol herself holds group:managers) files the session document.
        const carol = await airlinePersonaContext(playwright, apiUrl, "carol");
        contexts.push(carol);
        const session = await fileAgentSession(carol, ops.agentOpsAppId, {
          persona: "person:carol",
          driver: driver.name
        });

        const config: OperatorConfig = {
          apiUrl,
          username: ops.operatorUsername,
          password: ops.operatorPassword,
          personaPassword: AIRLINE_PASSWORD,
          mcpWorkspaceUrl: host.surfaceUrl("workspace"),
          appId: ops.agentOpsAppId,
          orgAppId: twin.orgAppId,
          kbAppId: twin.kbAppId,
          companyName: "Agentic Airlines PLC",
          pollMs: 1000,
          maxSessionsPerDay: 5,
          diagnosticsRoot: test.info().outputPath("operator-diagnostics"),
          log: (message) => console.log(message)
        };
        const operator = new AgentOperator(config, [driver]);
        expect(await operator.sweepOrphans()).toBe(0);
        const result = await operator.tick();
        expect(result).toEqual({ kind: "completed", sessionId: session._id });

        // Session lifecycle facts (admin oracle reads).
        const sessionDoc = (await (
          await admin.get(`/api/apps/${ops.agentOpsAppId}/documents/${encodeURIComponent(session._id)}`)
        ).json()) as BusinessDocument;
        expect(sessionDoc.state).toBe("completed");
        const artifacts = ((await (
          await admin.get(`/api/apps/${ops.agentOpsAppId}/documents?docType=artifact`)
        ).json()) as BusinessDocument[]).filter((doc) => doc.payload.sessionId === session._id);
        const names = artifacts.map((doc) => doc.payload.name);
        expect(names).toEqual(expect.arrayContaining(["prompt.txt", "outcome.json", "final_message.txt"]));

        // The shift did carol's M27 S1 work: alpha got crew, delta got dispatched.
        const flights = (await (
          await carol.get(`/api/apps/${twin.turnaroundAppId}/documents?docType=flight`)
        ).json()) as BusinessDocument[];
        const byId = new Map(flights.map((doc) => [doc._id, doc]));
        expect(byId.get(twin.flightDocIds.alpha)?.state).toBe("crew-assigned");
        expect(byId.get(twin.flightDocIds.delta)?.state).toBe("dispatched");
      });
    });
  }
});
