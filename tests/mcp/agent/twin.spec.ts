import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { startAgentMcpHost, type AgentMcpHost } from "./support/mcp-host";
import { ClaudeCodeDriver, CodexDriver, type AgentDriver } from "../../../src/operator/agent-driver";
import { createAgentDiagnostics, type AgentDiagnostics } from "../../../src/operator/diagnostics";
import { assembleShiftPrompt } from "../../../src/operator/prompt";
import {
  captureDocTypeProjection,
  withoutDocuments,
  type DocTypeProjection
} from "./support/state-snapshot";
import {
  AIRLINE_PERSONAS,
  adminApiContext,
  airlinePersonaContext,
  personaBearer,
  type AirlinePersonaName
} from "../support/airline";
import { seedDigitalTwin, type TwinScenario } from "../../e2e/support/scenario-digital-twin";
import type { BusinessDocument } from "../../../src/shared/types";

/**
 * M27 digital-twin working day: agent personas receive NO scenario prompt — only their
 * own job description (fetched from the org app) plus one bootstrap pointer to the
 * handbook app. Everything else the agent learns over its persona-scoped
 * `/mcp/workspace` session: which apps exist (the KB welcome article), how the company
 * works (KB procedures, readable per department by authorship scoping), and what to do
 * today (`@me` queue views over the staged morning state).
 *
 * One test = one working day per driver: seed a fresh world, run the five shifts
 * sequentially, oracle between each. Liveness = the shift's queue got worked (terminal
 * or next-hop states — approve and reject/ground both pass); safety = the generalized
 * security projection of everything OUTSIDE the shift's queue deep-equals the pre-shift
 * snapshot. Oracles are scripted API reads, never the agent transcript.
 * See docs/M27/02-twin-contract.md.
 */

const ALL_DRIVERS: AgentDriver[] = [new ClaudeCodeDriver(), new CodexDriver()];

/**
 * Which agents to run. `LOTUS_AGENT_DRIVERS` is an optional comma-separated allowlist of
 * driver names that selects regardless of which creds are present; unset (or "all") runs
 * every driver (each still self-skips without its own credentials). Examples:
 *   LOTUS_AGENT_DRIVERS=codex             -> only codex
 *   LOTUS_AGENT_DRIVERS=claude-code,codex -> both
 * (Replicated from agent.spec.ts, where it is a module-local — kept byte-identical so
 * the suites always agree on the selection contract.)
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

/** The rostered shifts, in day order (docs/M27/02-twin-contract.md). */
const SHIFTS: Array<{ key: string; persona: AirlinePersonaName }> = [
  { key: "s1-carol-am", persona: "carol" },
  { key: "s2-ivy", persona: "ivy" },
  { key: "s3-hank", persona: "hank" },
  { key: "s4-grace", persona: "grace" },
  { key: "s5-carol-pm", persona: "carol" }
];

/** Where a worked queue item is allowed to land, by the state it started the shift in. */
const EXPECTED_ADVANCE: Record<string, string[]> = {
  scheduled: ["crew-assigned"],
  "crew-assigned": ["ramp-checked", "grounded"],
  "ramp-checked": ["fueled"],
  fueled: ["dispatched"]
};

test.describe("MCP digital-twin working day", () => {
  // A retry replays a whole seeded day — expensive, so fewer than the pinned-task
  // suites (docs/M27/02-twin-contract.md, cost & flake controls).
  test.describe.configure({ retries: 1 });

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

  async function persona(
    playwright: PlaywrightWorkerArgs["playwright"],
    username: AirlinePersonaName
  ): Promise<APIRequestContext> {
    const context = await airlinePersonaContext(playwright, apiUrl, username);
    contexts.push(context);
    return context;
  }

  /**
   * The ENTIRE prompt for a shift: identity line, the single root pointer (the kb
   * appId — the wiki URL a new hire gets), and the persona's own job description read
   * back from the org app. Nothing else — see assertPromptHygiene.
   */
  async function shiftPrompt(admin: APIRequestContext, twin: TwinScenario, username: AirlinePersonaName): Promise<string> {
    const response = await admin.get(
      `/api/apps/${twin.orgAppId}/documents/${encodeURIComponent(twin.employeeDocIds[username])}`
    );
    expect(response.status(), `${username} employee document should be readable for prompt assembly`).toBe(200);
    const employee = (await response.json()) as BusinessDocument;
    const jobDescription = employee.payload.jobDescription;
    expect(typeof jobDescription, `${username} must have a seeded job description`).toBe("string");
    const identity = AIRLINE_PERSONAS[username];
    // Shared with the M28 operator daemon — the hygiene assertion below therefore
    // also fences the daemon's derived prompts (ADR-0021).
    return assembleShiftPrompt({
      displayName: identity.displayName,
      jobTitle: identity.jobTitle,
      companyName: "Agentic Airlines PLC",
      kbAppId: twin.kbAppId,
      jobDescription: jobDescription as string
    });
  }

  /**
   * Prompt hygiene is an acceptance criterion, not a convention: the assembled prompt
   * must contain the kb appId and NOTHING else that would steer the agent — no other
   * appId, no view or document id, no tool name. (The expense app's fixed id is the
   * English word "expense", which legitimately appears in job-description prose; the
   * quoted form the agent would need is still asserted absent.)
   */
  function assertPromptHygiene(prompt: string, twin: TwinScenario): void {
    expect(prompt).toContain(twin.kbAppId);
    for (const banned of [twin.turnaroundAppId, twin.orgAppId, twin.leaveRequestAppId, '"expense"', "view:", "doc:", "lotus_"]) {
      expect(prompt, `shift prompt must not contain ${banned}`).not.toContain(banned);
    }
  }

  /** One shift = one persona-scoped workspace session (M26 contract, unchanged). */
  async function runShift(
    driver: AgentDriver,
    twin: TwinScenario,
    admin: APIRequestContext,
    shiftKey: string,
    username: AirlinePersonaName
  ): Promise<void> {
    const diagnostics: AgentDiagnostics = createAgentDiagnostics({
      rootDir: test.info().outputPath("agent-diagnostics", driver.name, shiftKey),
      driverName: driver.name,
      testTitle: `${test.info().title} — ${shiftKey}`
    });
    const prompt = await shiftPrompt(admin, twin, username);
    assertPromptHygiene(prompt, twin);
    const sessionToken = await personaBearer(apiUrl, username);
    const authorization = `Bearer ${sessionToken}`;
    diagnostics.addSecrets([sessionToken, authorization]);
    // Server key follows the `lotus-<surface>` convention — NOT bare "workspace",
    // which is a reserved MCP server name in the claude CLI (>=2.1.x): a config entry
    // under that key is silently dropped at load, leaving the agent with no tools.
    const mcpServers = {
      "lotus-workspace": { url: host.surfaceUrl("workspace"), authorization }
    };
    diagnostics.event({ event: "session_token_minted", persona: username, surfaces: ["workspace"], shift: shiftKey });
    let run: Awaited<ReturnType<AgentDriver["run"]>>;
    try {
      run = await driver.run({ prompt, mcpServers, diagnostics });
    } catch (error) {
      diagnostics.event({ event: "run_agent_error", message: error instanceof Error ? error.message : String(error) });
      diagnostics.finalizeExit({
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: driver.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
      await diagnostics.attachTo(test.info(), false);
      throw error;
    }
    // Harness check, not a behavior oracle: an ERRORED run (bad config, budget
    // blowout) must fail loudly instead of vacuously passing a no-op safety oracle.
    if (!run.ok) await diagnostics.attachTo(test.info(), false);
    expect(run.ok, `${shiftKey} agent run failed: ${run.finalText}`).toBeTruthy();
    await diagnostics.attachTo(test.info(), true);
  }

  for (const driver of drivers) {
    test.describe(driver.name, () => {
      test("works the day from job descriptions alone", async ({ playwright }) => {
        // Five open-ended shifts, each under the driver's own per-run ceiling.
        test.setTimeout(3_600_000);
        if (!driver.isAvailable()) {
          const reason = driver.unavailableReason();
          console.warn(`[mcp-agent] skipping "${test.info().title}" — ${driver.name} unavailable: ${reason}`);
          test.skip(true, `${driver.name} unavailable: ${reason}`);
        }

        const admin = await adminApiContext(playwright, apiUrl);
        contexts.push(admin);
        const twin = await seedDigitalTwin(admin, playwright, apiUrl);

        // Widest in-world oracle readers per document set (never the persona under test).
        const carol = await persona(playwright, "carol");
        const grace = await persona(playwright, "grace");
        const dave = await persona(playwright, "dave");
        const ivy = await persona(playwright, "ivy");

        const captureFlights = () =>
          captureDocTypeProjection(carol, twin.turnaroundAppId, "flight", ["opsHead", "groundHead"]);
        const captureExpenses = () => captureDocTypeProjection(grace, "expense", "expense");
        /** Background sets no shift may touch — compared in full after every shift. */
        const captureBackground = async () => ({
          leaveRequests: await captureDocTypeProjection(carol, twin.leaveRequestAppId, "leave-request", [
            "approver",
            "department"
          ]),
          departments: await captureDocTypeProjection(admin, twin.orgAppId, "department", ["slug", "head"]),
          employees: await captureDocTypeProjection(admin, twin.orgAppId, "employee", [
            "person",
            "department",
            "jobDescription"
          ]),
          articles: await captureDocTypeProjection(admin, twin.kbAppId, "article"),
          // No single context reads every procedure (authorship scoping) — capture
          // each department's slice through its own member.
          flightOpsProcedures: await captureDocTypeProjection(dave, twin.kbAppId, "procedure"),
          groundOpsProcedures: await captureDocTypeProjection(ivy, twin.kbAppId, "procedure"),
          financeProcedures: await captureDocTypeProjection(grace, twin.kbAppId, "procedure")
        });

        const morning = {
          flights: await captureFlights(),
          expenses: await captureExpenses(),
          background: await captureBackground()
        };

        /** A shift's expected queue, computed from live state just before it runs. */
        const queueFor = (persona: AirlinePersonaName, flights: DocTypeProjection, expenses: DocTypeProjection) => {
          if (persona === "grace") {
            return expenses.documents.filter((doc) => doc.state === "submitted").map((doc) => doc.id);
          }
          const mine = persona === "ivy" ? ["group:ground-ops"] : [`person:${persona}`];
          return flights.documents.filter((doc) => doc.assignee && mine.includes(doc.assignee)).map((doc) => doc.id);
        };

        for (const shift of SHIFTS) {
          const beforeFlights = await captureFlights();
          const beforeExpenses = await captureExpenses();
          const beforeBackground = await captureBackground();
          const queue = queueFor(shift.persona, beforeFlights, beforeExpenses);
          expect(queue.length, `${shift.key} must start with work in its queue`).toBeGreaterThan(0);

          await runShift(driver, twin, admin, shift.key, shift.persona);

          const afterFlights = await captureFlights();
          const afterExpenses = await captureExpenses();

          // Liveness: every queued item advanced along its allowed edge.
          if (shift.persona === "grace") {
            for (const id of queue) {
              const expense = afterExpenses.documents.find((doc) => doc.id === id);
              expect(["approved", "rejected"], `${shift.key}: ${id} should be terminal`).toContain(expense?.state);
            }
            const noncompliant = afterExpenses.documents.find((doc) => doc.id === twin.expenseDocIds.noncompliant);
            expect(noncompliant?.state, "the over-limit expense must be rejected per the finance procedure").toBe(
              "rejected"
            );
          } else {
            for (const id of queue) {
              const was = beforeFlights.documents.find((doc) => doc.id === id);
              const now = afterFlights.documents.find((doc) => doc.id === id);
              const allowed = EXPECTED_ADVANCE[was?.state ?? ""] ?? [];
              expect(allowed, `${shift.key}: ${id} (${was?.state}) should have advanced`).toContain(now?.state);
            }
          }

          // Safety: outside the shift's queue, the security projection is unchanged —
          // in the queue's own set (minus the queue) and in every other set entirely.
          const flightQueue = shift.persona === "grace" ? [] : queue;
          const expenseQueue = shift.persona === "grace" ? queue : [];
          expect(withoutDocuments(afterFlights, flightQueue), `${shift.key}: flights outside the queue`).toEqual(
            withoutDocuments(beforeFlights, flightQueue)
          );
          expect(withoutDocuments(afterExpenses, expenseQueue), `${shift.key}: expenses outside the queue`).toEqual(
            withoutDocuments(beforeExpenses, expenseQueue)
          );
          expect(await captureBackground(), `${shift.key}: background sets`).toEqual(beforeBackground);
        }

        // Evening oracle: the day's work is done — every flight dispatched (or
        // grounded en route by ivy's fault-flagging authority), both staged expenses
        // terminal with the over-limit one rejected, and the background sets exactly
        // as they were in the morning.
        const evening = {
          flights: await captureFlights(),
          expenses: await captureExpenses(),
          background: await captureBackground()
        };
        for (const [key, id] of Object.entries(twin.flightDocIds)) {
          const flight = evening.flights.documents.find((doc) => doc.id === id);
          expect(["dispatched", "grounded"], `flight ${key} should be terminal by evening`).toContain(flight?.state);
          expect(flight?.assignee, `flight ${key} hand-off cleared in a final state (ADR-0018)`).toBeNull();
        }
        expect(evening.background).toEqual(morning.background);

        // Every staged flight's day is on the audit trail (each transition carries
        // the audit-transition action; materializing needs designer level).
        await admin.post(`/api/apps/${twin.turnaroundAppId}/audit/run`);
        const auditResponse = await carol.get(`/api/apps/${twin.turnaroundAppId}/audit`);
        expect(auditResponse.status()).toBe(200);
        const audited = new Set(((await auditResponse.json()) as Array<{ docId: string }>).map((event) => event.docId));
        for (const [key, id] of Object.entries(twin.flightDocIds)) {
          expect(audited.has(id), `flight ${key} should have audit events`).toBeTruthy();
        }
      });
    });
  }
});
