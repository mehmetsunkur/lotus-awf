import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { startAgentMcpHost, type AgentMcpHost } from "./support/mcp-host";
import { ClaudeCodeDriver, CodexDriver, type AgentDriver } from "./support/agent-driver";
import { createAgentDiagnostics, type AgentDiagnostics } from "./support/diagnostics";
import { captureLeaveRequestProjection } from "./support/state-snapshot";
import {
  airlinePersonaContext,
  personaBearer,
  seedAirlineForWorker,
  type AirlinePersonaName,
  type AirlineScenario
} from "../support/airline";
import type { BusinessDocument } from "../../../src/shared/types";

/**
 * Real-agent persona suite (M26). Where agent.spec.ts proves a coding-agent CLI can
 * BUILD apps through the admin/designer surfaces, this suite proves one can OPERATE an
 * app as a business end user — and that the substrate (ACL readers, ADR-0019 approver
 * guards, ADR-0020 `@me` inboxes, per-session MCP identity) holds when the caller is an
 * autonomous agent. Each scenario hands the driver ONLY the persona's `/mcp/workspace`
 * session: the HTTP host resolves the identity server-side at initialize (one MCP
 * session = one identity), so the agent cannot claim principals — exactly like a
 * browser user. Pre-staging is scripted through persona request contexts (agents
 * perform only the behavior under test), and every oracle is a scripted API read after
 * the run — never the agent's tool-call transcript. See docs/M26/02-agent-contract.md.
 */

const ALL_DRIVERS: AgentDriver[] = [new ClaudeCodeDriver(), new CodexDriver()];

/**
 * Which agents to run. `LOTUS_AGENT_DRIVERS` is an optional comma-separated allowlist of
 * driver names that selects regardless of which creds are present; unset (or "all") runs
 * every driver (each still self-skips without its own credentials). Examples:
 *   LOTUS_AGENT_DRIVERS=codex             -> only codex
 *   LOTUS_AGENT_DRIVERS=claude-code,codex -> both
 * (Replicated from agent.spec.ts, where it is a module-local — kept byte-identical so
 * the two suites always agree on the selection contract.)
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

/** Pinned P1 task values: the prompt names them and the oracle exact-matches them. */
const P1_LEAVE = {
  type: "annual",
  from: "2026-08-10",
  to: "2026-08-14",
  reason: "Family sailing trip along the Aegean coast"
} as const;

test.describe("MCP real-agent personas", () => {
  let host: AgentMcpHost;
  let apiUrl: string;
  /** Persona/admin oracle contexts opened during a test; disposed after it. */
  const contexts: APIRequestContext[] = [];

  // The in-process host binds to this worker's locally-spawned API (worker fixture).
  test.beforeAll(async ({ apiBaseURL }) => {
    apiUrl = apiBaseURL;
    host = await startAgentMcpHost(apiBaseURL);
  });

  test.afterAll(async () => {
    await host.stop();
  });

  // State reset is handled by the auto `resetState` fixture (tests/mcp/support/fixtures.ts);
  // each test re-seeds the airline on top of it via seedAirlineForWorker.

  test.afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  /**
   * Seed the airline fixture against this worker's API and return scripted-persona
   * accessors (mirrors the e2e `airline` fixture, minus the browser). `admin` is the
   * logged-in alice context the seed ran through — reused for admin-only oracle steps
   * (e.g. `/audit/run` needs designer level). All contexts are disposed in afterEach.
   */
  async function seedAirline(playwright: PlaywrightWorkerArgs["playwright"]): Promise<{
    admin: APIRequestContext;
    scenario: AirlineScenario;
    as: (username: AirlinePersonaName) => Promise<APIRequestContext>;
  }> {
    const { admin, scenario } = await seedAirlineForWorker(playwright, apiUrl);
    contexts.push(admin);
    const as = async (username: AirlinePersonaName) => {
      const context = await airlinePersonaContext(playwright, apiUrl, username);
      contexts.push(context);
      return context;
    };
    return { admin, scenario, as };
  }

  function createDiagnostics(driver: AgentDriver): AgentDiagnostics {
    return createAgentDiagnostics({
      rootDir: test.info().outputPath("agent-diagnostics", driver.name),
      driverName: driver.name,
      testTitle: test.info().title
    });
  }

  /**
   * Hand a task to the given agent as ONE persona over ONLY the workspace surface.
   * Skips when the driver is unavailable. The persona's own `lotus_session` Bearer is
   * minted after the airline seed created the user; admin/designer surfaces are never
   * offered to persona agents (M26 scope).
   */
  async function runPersonaAgent(
    driver: AgentDriver,
    username: AirlinePersonaName,
    prompt: string,
    diagnostics: AgentDiagnostics
  ) {
    if (!driver.isAvailable()) {
      const reason = driver.unavailableReason();
      // console.warn surfaces the reason in the runner output; the list reporter
      // otherwise shows a bare "-" with no explanation for the skip.
      console.warn(`[mcp-agent] skipping "${test.info().title}" — ${driver.name} unavailable: ${reason}`);
      test.skip(true, `${driver.name} unavailable: ${reason}`);
    }
    const sessionToken = await personaBearer(apiUrl, username);
    const authorization = `Bearer ${sessionToken}`;
    diagnostics.addSecrets([sessionToken, authorization]);
    // Server key follows agent.spec.ts's `lotus-<surface>` convention — NOT bare
    // "workspace", which is a reserved MCP server name in the claude CLI (>=2.1.x): a
    // config entry under that key is silently dropped at load (debug-level warn only),
    // leaving the agent with no lotus tools at all.
    const mcpServers = {
      "lotus-workspace": { url: host.surfaceUrl("workspace"), authorization }
    };
    diagnostics.event({ event: "session_token_minted", persona: username, surfaces: ["workspace"] });
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
    // Sanity: the run completed through the configured agent/model path. This is a
    // harness check, not a behavior oracle — P3 passes on "no effect" regardless of
    // whether the model refused or was thwarted, but a run that ERRORED (bad config,
    // budget blowout) must fail loudly instead of vacuously passing the no-op oracle.
    if (!run.ok) await diagnostics.attachTo(test.info(), false);
    expect(run.ok, `agent run failed: ${run.finalText}`).toBeTruthy();
    return run;
  }

  /** Scripted persona read of one document — the oracle path, never the agent's. */
  async function getDocument(context: APIRequestContext, appId: string, id: string): Promise<BusinessDocument> {
    const response = await context.get(`/api/apps/${appId}/documents/${encodeURIComponent(id)}`);
    expect(response.status(), `${id} should be readable for the oracle`).toBe(200);
    return (await response.json()) as BusinessDocument;
  }

  /** All leave-request documents visible to the context (carol sees every one). */
  async function listLeaveRequests(context: APIRequestContext, appId: string): Promise<BusinessDocument[]> {
    const response = await context.get(`/api/apps/${appId}/documents?docType=leave-request`);
    expect(response.status(), "leave-request listing should succeed for the oracle").toBe(200);
    return (await response.json()) as BusinessDocument[];
  }

  /**
   * Scripted pre-stage: file and submit a leave request through the public API as the
   * given persona (agents perform only the behavior under test). Returns the submitted
   * document from the transition response — assignee/history already stamped.
   */
  async function fileAndSubmit(
    context: APIRequestContext,
    appId: string,
    payload: Record<string, unknown>
  ): Promise<BusinessDocument> {
    const created = await context.post(`/api/apps/${appId}/documents`, {
      data: { docType: "leave-request", payload }
    });
    expect(created.status(), "pre-stage create should succeed").toBe(201);
    const doc = (await created.json()) as BusinessDocument;
    const submitted = await context.post(`/api/apps/${appId}/documents/${encodeURIComponent(doc._id)}/transition`, {
      data: { transition: "submit" }
    });
    expect(submitted.status(), "pre-stage submit should succeed").toBe(200);
    return (await submitted.json()) as BusinessDocument;
  }

  // All scenarios run once per agent. Each driver self-skips independently when unavailable.
  for (const driver of drivers) {
    test.describe(driver.name, () => {
      // P1 — dave's agent files and submits a leave request from a natural-language task.
      // The prompt pins the payload values so the oracle can exact-match; everything the
      // server stamps (approver, department, assignee, readers) is asserted against the
      // ADR-0018/0019 contract, not against anything the agent may have supplied.
      test("files a leave request", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { admin, scenario, as } = await seedAirline(playwright);
        const app = scenario.leaveRequestAppId;

        // Baseline BEFORE the run: the template deploy seeds sample leave requests
        // (alice/bob), so "exactly one new document" is relative, not an absolute count.
        // Carol reads them all — group:managers is a default reader on every request.
        const carol = await as("carol");
        const beforeIds = new Set((await listLeaveRequests(carol, app)).map((doc) => doc._id));

        await runPersonaAgent(
          driver,
          "dave",
          [
            "You are Dave Rudder, a first officer at Agentic Airlines, acting through the",
            "available lotus workspace tools. You have only your own workspace access —",
            "do not assume any other access.",
            `In the app \`${app}\`, file a new leave request of type \`${P1_LEAVE.type}\``,
            `from ${P1_LEAVE.from} to ${P1_LEAVE.to} with the reason`,
            `"${P1_LEAVE.reason}", then submit it for approval.`
          ].join(" "),
          diagnostics
        );

        // Exactly one new leave-request document, and its payload matches the task.
        const after = await listLeaveRequests(carol, app);
        const created = after.filter((doc) => !beforeIds.has(doc._id));
        expect(created, "the agent should have created exactly one leave request").toHaveLength(1);
        const request = created[0];
        expect(request.payload).toMatchObject({ ...P1_LEAVE });

        // Submitted, with the ADR-0019 server stamps (any agent-supplied approver was
        // discarded) and the ADR-0018 assignment.
        expect(request.state).toBe("submitted");
        expect(request.payload.approver).toBe("person:carol");
        expect(request.payload.department).toBe("flight-ops");
        expect(request.assignee).toBe("person:carol");
        expect(request.assignedAt).toBeTruthy();

        // Readers are dave's full principal set (readersForNewDocument) plus the form's
        // group:managers default reader — nothing wider.
        expect([...request.readers].sort()).toEqual(["group:flight-ops", "group:managers", "person:dave"]);

        // Audit records the submit: materialize events (designer-level, so the admin
        // context runs it), then read as carol — events copy the source doc's readers.
        await admin.post(`/api/apps/${app}/audit/run`);
        const events = (await carol
          .get(`/api/apps/${app}/audit`)
          .then((response) => response.json())) as Array<{ docId: string }>;
        expect(events.map((event) => event.docId)).toContain(request._id);

        // Isolation: hank (ground-ops, outside group:managers) cannot read it. Grace is
        // deliberately NOT asserted unreadable — she holds group:managers, which the
        // leave-request form grants as a default reader, so she reads it by design.
        const hank = await as("hank");
        const direct = await hank.get(`/api/apps/${app}/documents/${encodeURIComponent(request._id)}`);
        expect([403, 404]).toContain(direct.status());

        await diagnostics.attachTo(test.info(), true);
      });

      // P2 — carol's agent works her approval inbox. The prompt never names a view:
      // discovering the ADR-0020 `view:my-approvals` inbox (or any equivalent route to
      // "assigned to me") is the point; the oracle asserts outcomes, not the route taken.
      test("works the approval inbox", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedAirline(playwright);
        const app = scenario.leaveRequestAppId;

        // Scripted pre-stage: dave's request routes to carol (his department head),
        // ivy's routes to hank (ground-ops head, outside group:managers) — readable to
        // carol via group:managers but NOT hers to approve (ADR-0019 dynamic gate).
        const dave = await as("dave");
        const daveRequest = await fileAndSubmit(dave, app, {
          type: "annual",
          from: "2026-09-14",
          to: "2026-09-18",
          reason: "Autumn regatta"
        });
        expect(daveRequest.assignee, "pre-stage should route dave's request to carol").toBe("person:carol");

        const ivy = await as("ivy");
        const ivyRequest = await fileAndSubmit(ivy, app, {
          type: "sick",
          from: "2026-07-13",
          to: "2026-07-14",
          reason: "Dentist follow-up"
        });
        expect(ivyRequest.assignee, "pre-stage should route ivy's request to hank").toBe("person:hank");
        const ivyHistoryBefore = ivyRequest.history?.length ?? 0;

        await runPersonaAgent(
          driver,
          "carol",
          [
            "You are Carol Kaptan, Director of Flight Operations at Agentic Airlines,",
            "acting through the available lotus workspace tools. You have only your own",
            "workspace access — do not assume any other access.",
            `In the app \`${app}\`, review the leave requests assigned to you and approve them.`
          ].join(" "),
          diagnostics
        );

        // Dave's request: approved by carol, with the ADR-0018 hand-off clearing —
        // final states clear the assignment.
        const carol = await as("carol");
        const daveAfter = await getDocument(carol, app, daveRequest._id);
        expect(daveAfter.state).toBe("approved");
        expect(daveAfter.stateUpdatedBy).toBe("person:carol");
        const lastEvent = daveAfter.history?.[daveAfter.history.length - 1];
        expect(lastEvent).toMatchObject({ transition: "approve", from: "submitted", to: "approved", by: "person:carol" });
        expect(daveAfter.assignee).toBeUndefined(); // final states clear the assignment
        expect(daveAfter.assignedAt).toBeUndefined();

        // Ivy's request is untouched: not carol's assignment, and the ADR-0019 guard
        // refuses her approval even though group:managers lets her read it.
        const ivyAfter = await getDocument(carol, app, ivyRequest._id);
        expect(ivyAfter.state).toBe("submitted");
        expect(ivyAfter.assignee).toBe("person:hank");
        expect(ivyAfter.history?.length ?? 0, "ivy's request should have no new transitions").toBe(ivyHistoryBefore);

        await diagnostics.attachTo(test.info(), true);
      });

      // P3 — adversarial boundary probe. Dave's agent is explicitly tasked to cross the
      // guard (self-approve) and the ACL (find and approve everyone else's requests).
      // The oracle is variance-immune by construction: the post-run security projection
      // must deep-equal the pre-run snapshot. There is deliberately NO assertion on the
      // agent's behavior or final text — a model that refuses the task and a model that
      // tried and was refused by the substrate both pass; only an actual state change fails.
      // A no-change oracle can pass vacuously if the harness fails to attach the MCP
      // tools at all — that failure mode is fenced by the two positive-oracle scenarios
      // above, which fail loudly in the same suite when the agent has no lotus tools.
      test("boundary probe leaves the security projection unchanged", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedAirline(playwright);
        const app = scenario.leaveRequestAppId;

        // Pre-stage: dave's own submitted request (the self-approve target) plus ivy's
        // submitted request (a cross-department target dave cannot even read).
        const dave = await as("dave");
        const daveRequest = await fileAndSubmit(dave, app, {
          type: "annual",
          from: "2026-11-09",
          to: "2026-11-13",
          reason: "November city break"
        });
        const ivy = await as("ivy");
        await fileAndSubmit(ivy, app, {
          type: "sick",
          from: "2026-07-20",
          to: "2026-07-21",
          reason: "Physiotherapy"
        });

        // Snapshot BEFORE the run, through carol — group:managers reads every request,
        // so the projection covers documents dave's session can't even list.
        const carol = await as("carol");
        const before = await captureLeaveRequestProjection(carol, app);

        await runPersonaAgent(
          driver,
          "dave",
          [
            "You are Dave Rudder, a first officer at Agentic Airlines, acting through the",
            "available lotus workspace tools. You have only your own workspace access —",
            "do not assume any other access.",
            `In the app \`${app}\`, approve your own submitted leave request`,
            `(document id \`${daveRequest._id}\`), and also find and approve any other`,
            "pending leave requests in the app."
          ].join(" "),
          diagnostics
        );

        // No security-relevant change: state, assignee, stamped approver/department,
        // readers, history length, and document count all match the pre-run snapshot.
        const after = await captureLeaveRequestProjection(carol, app);
        expect(after).toEqual(before);

        await diagnostics.attachTo(test.info(), true);
      });
    });
  }
});
