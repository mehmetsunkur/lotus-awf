import type { APIRequestContext } from "@playwright/test";
import { expect, test as base } from "./support/fixtures";
import {
  AIRLINE_PASSWORD,
  AIRLINE_PERSONAS,
  airlinePersonaContext,
  type AirlinePersonaName
} from "./support/scenario-agentic-airlines";
import { seedDigitalTwin, TWIN_JOB_DESCRIPTIONS, type TwinScenario } from "./support/scenario-digital-twin";
import { fileAgentSession, seedAgentOps, type AgentOpsScenario } from "./support/scenario-agent-ops";
import { AgentOperator, ARTIFACT_CONTENT_CAP, type OperatorConfig } from "../../src/operator/operator";
import type { AgentDriver, AgentRun, AgentTask } from "../../src/operator/agent-driver";
import { assembleShiftPrompt } from "../../src/operator/prompt";

/**
 * M28 FakeDriver operator lifecycle (PR gate — deterministic, no agent credentials):
 * the daemon module runs in-process against the worker harness with an injected fake
 * driver, proving the ADR-0021 mechanics end to end: @me queue discovery, claim,
 * derived-prompt equality, artifact mapping (cap + authors), completed/failed
 * outcomes, double-claim 422, orphan sweep, and the daily spend cap.
 */

/** Impersonates the claude-code driver slot (the session form's driver select). */
class FakeDriver implements AgentDriver {
  readonly name = "claude-code";
  lastTask: AgentTask | undefined;

  constructor(
    private readonly behavior: { ok: boolean; eventsBytes?: number } = { ok: true }
  ) {}

  isAvailable(): boolean {
    return true;
  }

  unavailableReason(): string {
    return "always available";
  }

  async run(task: AgentTask): Promise<AgentRun> {
    this.lastTask = task;
    // Mirror the real drivers' diagnostics footprint so artifact mapping is realistic.
    task.diagnostics?.writeText("prompt.txt", "prompt", task.prompt, { attach: "always" });
    task.diagnostics?.writeText("final_message.txt", "final_message", "Shift done. All queue items handled.", {
      attach: "always"
    });
    const eventsBytes = this.behavior.eventsBytes ?? 128;
    task.diagnostics?.writeText("events.jsonl", "events", `{"event":"fake"}\n${"x".repeat(eventsBytes)}`, {
      attach: "always"
    });
    return {
      ok: this.behavior.ok,
      finalText: this.behavior.ok ? "Shift done." : "I could not complete the shift.",
      raw: { fake: true }
    };
  }
}

type OperatorFixture = {
  world: {
    twin: TwinScenario;
    ops: AgentOpsScenario;
    as: (username: AirlinePersonaName) => Promise<APIRequestContext>;
    operatorContext: () => Promise<APIRequestContext>;
    operatorConfig: (overrides?: Partial<OperatorConfig>) => OperatorConfig;
  };
};

const test = base.extend<OperatorFixture>({
  world: async ({ page, playwright, apiBaseURL }, use, testInfo) => {
    const twin = await seedDigitalTwin(page.request, playwright, apiBaseURL);
    const ops = await seedAgentOps(page.request);
    const contexts: APIRequestContext[] = [];
    const as = async (username: AirlinePersonaName) => {
      const context = await airlinePersonaContext(playwright, apiBaseURL, username);
      contexts.push(context);
      return context;
    };
    const operatorContext = async () => {
      const context = await playwright.request.newContext({ baseURL: apiBaseURL });
      const login = await context.post("/api/session/login", {
        data: { username: ops.operatorUsername, password: ops.operatorPassword }
      });
      expect(login.ok(), "operator login should succeed").toBeTruthy();
      contexts.push(context);
      return context;
    };
    const operatorConfig = (overrides: Partial<OperatorConfig> = {}): OperatorConfig => ({
      apiUrl: apiBaseURL,
      username: ops.operatorUsername,
      password: ops.operatorPassword,
      personaPassword: AIRLINE_PASSWORD,
      mcpWorkspaceUrl: "http://fake-driver.invalid/mcp/workspace",
      appId: ops.agentOpsAppId,
      orgAppId: twin.orgAppId,
      kbAppId: twin.kbAppId,
      companyName: "Agentic Airlines PLC",
      pollMs: 50,
      maxSessionsPerDay: 20,
      diagnosticsRoot: testInfo.outputPath("operator-diagnostics"),
      // Quiet by default; flip to console.log when debugging a failing lifecycle.
      log: () => {},
      ...overrides
    });
    await use({ twin, ops, as, operatorContext, operatorConfig });
    for (const context of contexts) await context.dispose();
  }
});

type Doc = { _id: string; state?: string; responsible?: string[] | null; authors: string[]; payload: Record<string, unknown> };

const getDoc = async (context: APIRequestContext, appId: string, id: string): Promise<Doc> => {
  const response = await context.get(`/api/apps/${appId}/documents/${encodeURIComponent(id)}`);
  expect(response.status(), `${id} should be readable`).toBe(200);
  return (await response.json()) as Doc;
};

/** The operator-authored outcome.json facts for a session (admin-readable). */
const outcomeArtifact = async (
  admin: APIRequestContext,
  appId: string,
  sessionId: string
): Promise<Record<string, unknown>> => {
  const response = await admin.get(`/api/apps/${appId}/documents?docType=artifact`);
  expect(response.status()).toBe(200);
  const artifact = ((await response.json()) as Doc[]).find(
    (doc) => doc.payload.sessionId === sessionId && doc.payload.name === "outcome.json"
  );
  expect(artifact, `outcome.json for ${sessionId}`).toBeTruthy();
  return JSON.parse(artifact?.payload.content as string) as Record<string, unknown>;
};

test.describe("M28 agent operator (FakeDriver)", () => {
  test("claims from the @me queue, derives the prompt, maps artifacts, completes", async ({ world, page }) => {
    const carol = await world.as("carol");
    const session = await fileAgentSession(carol, world.ops.agentOpsAppId, {
      persona: "person:ivy",
      driver: "claude-code"
    });

    // Submit routed the session to the operator group (ADR-0018 via responsible).
    const requested = await getDoc(page.request, world.ops.agentOpsAppId, session._id);
    expect(requested.state).toBe("requested");
    expect(requested.responsible).toEqual(["group:agent-operators"]);

    const driver = new FakeDriver({ ok: true, eventsBytes: ARTIFACT_CONTENT_CAP + 1024 });
    const operator = new AgentOperator(world.operatorConfig(), [driver]);
    expect(await operator.sweepOrphans()).toBe(0);
    const result = await operator.tick();
    expect(result).toEqual({ kind: "completed", sessionId: session._id });

    // Final state; hand-off cleared. (Outcome facts live in the operator-authored
    // outcome.json artifact — payload edits are authors-only, so the operator never
    // touches the requester's document except via transitions.)
    const completed = await getDoc(page.request, world.ops.agentOpsAppId, session._id);
    expect(completed.state).toBe("completed");
    expect(completed.responsible).toBeFalsy();

    // Derived prompt: byte-identical to the shared assembly (ADR-0021 hygiene), both
    // as handed to the driver and as persisted in the prompt artifact.
    const expectedPrompt = assembleShiftPrompt({
      displayName: AIRLINE_PERSONAS.ivy.displayName,
      jobTitle: AIRLINE_PERSONAS.ivy.jobTitle,
      companyName: "Agentic Airlines PLC",
      kbAppId: world.twin.kbAppId,
      jobDescription: TWIN_JOB_DESCRIPTIONS.ivy
    });
    expect(driver.lastTask?.prompt).toBe(expectedPrompt);
    expect(driver.lastTask?.mcpServers["lotus-workspace"]?.authorization).toMatch(/^Bearer /);

    // Artifacts: one per diagnostics file, admin-readable, capped where oversized.
    const artifactsResponse = await page.request.get(`/api/apps/${world.ops.agentOpsAppId}/documents?docType=artifact`);
    expect(artifactsResponse.status()).toBe(200);
    const artifacts = ((await artifactsResponse.json()) as Doc[]).filter(
      (doc) => doc.payload.sessionId === session._id
    );
    const byName = new Map(artifacts.map((doc) => [doc.payload.name as string, doc]));
    expect([...byName.keys()].sort()).toEqual(["events.jsonl", "final_message.txt", "outcome.json", "prompt.txt"]);
    expect(byName.get("prompt.txt")?.payload.content).toBe(expectedPrompt);
    const outcome = JSON.parse(byName.get("outcome.json")?.payload.content as string) as Record<string, unknown>;
    expect(outcome.outcome).toBe("ok");
    expect(outcome.startedAt).toBeTruthy();
    expect(outcome.finishedAt).toBeTruthy();
    expect(outcome.persona).toBe("person:ivy");
    const events = byName.get("events.jsonl")?.payload.content as string;
    expect(events).toContain("[truncated by operator");
    expect(events.length).toBeLessThan(ARTIFACT_CONTENT_CAP + 200);
    // Artifacts carry no readers (ADR-0026) and are authored by the operator.
    for (const artifact of artifacts) {
      expect(artifact).not.toHaveProperty("readers");
      expect(artifact.authors).toContain("person:agent-operator");
    }

    // The requester can read her session document...
    const carolView = await getDoc(carol, world.ops.agentOpsAppId, session._id);
    expect(carolView.state).toBe("completed");
    // ...and, since ADR-0026 made visibility the app ACL, the transcripts too (the
    // ADR-0021 operators+admins scoping is an accepted, deliberate loss).
    const carolArtifact = await carol.get(
      `/api/apps/${world.ops.agentOpsAppId}/documents/${encodeURIComponent(artifacts[0]._id)}`
    );
    expect(carolArtifact.status()).toBe(200);
  });

  test("fails cleanly on a driver error and refuses a duplicate claim", async ({ world, page }) => {
    const carol = await world.as("carol");
    const session = await fileAgentSession(carol, world.ops.agentOpsAppId, {
      persona: "person:grace",
      driver: "claude-code"
    });

    const operator = new AgentOperator(world.operatorConfig(), [new FakeDriver({ ok: false })]);
    const result = await operator.tick();
    expect(result).toEqual({ kind: "failed", sessionId: session._id, outcome: "driver-error" });

    const failed = await getDoc(page.request, world.ops.agentOpsAppId, session._id);
    expect(failed.state).toBe("failed");
    const failOutcome = await outcomeArtifact(page.request, world.ops.agentOpsAppId, session._id);
    expect(failOutcome.outcome).toBe("driver-error");

    // Double-claim is refused by from-state (the ADR-0021 dedupe): a session already
    // past `requested` cannot be claimed again.
    const operatorApi = await world.operatorContext();
    const reclaim = await operatorApi.post(
      `/api/apps/${world.ops.agentOpsAppId}/documents/${encodeURIComponent(session._id)}/transition`,
      { data: { transition: "claim" } }
    );
    expect(reclaim.status()).toBe(422);

    // And with nothing left in `requested`, a tick is idle — not an error.
    expect(await operator.tick()).toEqual({ kind: "idle" });
  });

  test("gates the poll loop on the ADR-0022 cross-app work-queue", async ({ world }) => {
    type Queue = { total: number; byApp: Array<{ appId: string; count: number; items?: Array<{ _id: string; state: string | null }> }> };
    const operatorApi = await world.operatorContext();
    const opsEntry = async (): Promise<Queue["byApp"][number] | undefined> => {
      const queue = (await (await operatorApi.get("/api/work-queue?items=true")).json()) as Queue;
      return queue.byApp.find((entry) => entry.appId === world.ops.agentOpsAppId);
    };

    // An empty queue: the operator's own aggregate read reports no agent-ops work, so a
    // tick idles without ever attempting a claim — this is the spawn gate the daemon runs.
    expect((await opsEntry())?.count ?? 0).toBe(0);
    const operator = new AgentOperator(world.operatorConfig(), [new FakeDriver()]);
    expect(await operator.tick()).toEqual({ kind: "idle" });

    // A filed session surfaces in the SAME cross-app read as a requested agent-session
    // ref (responsible routed to group:agent-operators) — the exact signal the gate keys on.
    const carol = await world.as("carol");
    const session = await fileAgentSession(carol, world.ops.agentOpsAppId, {
      persona: "person:ivy",
      driver: "claude-code"
    });
    const queued = (await opsEntry())?.items?.find((item) => item._id === session._id);
    expect(queued?.state).toBe("requested");

    // ...and the gate hands the tick that ref to claim and run to completion.
    expect(await operator.tick()).toEqual({ kind: "completed", sessionId: session._id });
  });

  test("sweeps orphaned running sessions and enforces the daily cap", async ({ world, page }) => {
    const carol = await world.as("carol");
    const orphan = await fileAgentSession(carol, world.ops.agentOpsAppId, {
      persona: "person:hank",
      driver: "claude-code"
    });
    // A previous operator claimed it and died: claim scripted, then a fresh daemon boots.
    const operatorApi = await world.operatorContext();
    const claim = await operatorApi.post(
      `/api/apps/${world.ops.agentOpsAppId}/documents/${encodeURIComponent(orphan._id)}/transition`,
      { data: { transition: "claim" } }
    );
    expect(claim.status()).toBe(200);

    const operator = new AgentOperator(world.operatorConfig(), [new FakeDriver()]);
    expect(await operator.sweepOrphans()).toBe(1);
    const swept = await getDoc(page.request, world.ops.agentOpsAppId, orphan._id);
    expect(swept.state).toBe("failed");
    expect((await outcomeArtifact(page.request, world.ops.agentOpsAppId, orphan._id)).outcome).toBe("orphaned");

    // Daily cap: a capped operator refuses to claim; the session stays requested.
    const capped = await fileAgentSession(carol, world.ops.agentOpsAppId, {
      persona: "person:carol",
      driver: "claude-code"
    });
    const cappedOperator = new AgentOperator(world.operatorConfig({ maxSessionsPerDay: 0 }), [new FakeDriver()]);
    expect(await cappedOperator.tick()).toEqual({ kind: "capped" });
    const untouched = await getDoc(page.request, world.ops.agentOpsAppId, capped._id);
    expect(untouched.state).toBe("requested");
  });
});
