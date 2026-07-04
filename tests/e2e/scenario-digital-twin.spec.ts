import type { APIRequestContext } from "@playwright/test";
import { expect, test as base } from "./support/fixtures";
import { airlinePersonaContext, type AirlinePersonaName } from "./support/scenario-agentic-airlines";
import {
  seedDigitalTwin,
  TWIN_FLIGHTS,
  TWIN_JOB_DESCRIPTIONS,
  type TwinScenario
} from "./support/scenario-digital-twin";

/**
 * Scripted assertions over the M27 digital-twin seeded world — no agents involved.
 * Proves the morning state the working-day agent spec (tests/mcp/agent/twin.spec.ts)
 * relies on: staged flight states and organically stamped assignees/heads, the
 * authorship-scoped KB readability matrix, the expense queue, job descriptions, and
 * the scripted adversarial boundaries. See docs/M27/02-twin-contract.md.
 */

type TwinFixture = {
  twin: {
    scenario: TwinScenario;
    as: (username: AirlinePersonaName) => Promise<APIRequestContext>;
  };
};

const test = base.extend<TwinFixture>({
  twin: async ({ page, playwright, apiBaseURL }, use) => {
    const scenario = await seedDigitalTwin(page.request, playwright, apiBaseURL);
    const contexts: APIRequestContext[] = [];
    const as = async (username: AirlinePersonaName) => {
      const context = await airlinePersonaContext(playwright, apiBaseURL, username);
      contexts.push(context);
      return context;
    };
    await use({ scenario, as });
    for (const context of contexts) await context.dispose();
  }
});

type Doc = {
  _id: string;
  state?: string;
  assignee?: string;
  readers: string[];
  history?: unknown[];
  payload: Record<string, unknown>;
};

const getDoc = async (context: APIRequestContext, appId: string, id: string): Promise<Doc> => {
  const response = await context.get(`/api/apps/${appId}/documents/${encodeURIComponent(id)}`);
  expect(response.status(), `${id} should be readable`).toBe(200);
  return (await response.json()) as Doc;
};

const viewDocs = async (context: APIRequestContext, appId: string, viewId: string): Promise<Doc[]> => {
  const response = await context.get(`/api/apps/${appId}/views/${encodeURIComponent(viewId)}/documents`);
  expect(response.status(), `${viewId} should list`).toBe(200);
  return (await response.json()) as Doc[];
};

const transition = async (context: APIRequestContext, appId: string, docId: string, id: string) =>
  context.post(`/api/apps/${appId}/documents/${encodeURIComponent(docId)}/transition`, {
    data: { transition: id }
  });

test.describe("Digital twin seeded world", () => {
  test("stages the morning state: flight states, organic assignees, and computed heads", async ({ twin }) => {
    const carol = await twin.as("carol");
    const app = twin.scenario.turnaroundAppId;

    const expectations: Array<{ key: keyof typeof TWIN_FLIGHTS; state: string; assignee: string }> = [
      { key: "alpha", state: "scheduled", assignee: "person:carol" },
      { key: "bravo", state: "crew-assigned", assignee: "group:ground-ops" },
      { key: "charlie", state: "ramp-checked", assignee: "person:hank" },
      { key: "delta", state: "fueled", assignee: "person:carol" }
    ];
    for (const expected of expectations) {
      const flight = await getDoc(carol, app, twin.scenario.flightDocIds[expected.key]);
      expect(flight.state, `${expected.key} state`).toBe(expected.state);
      expect(flight.assignee, `${expected.key} assignee`).toBe(expected.assignee);
      // ADR-0019 stamps, resolved from the per-seed org app at create time.
      expect(flight.payload.opsHead, `${expected.key} opsHead`).toBe("person:carol");
      expect(flight.payload.groundHead, `${expected.key} groundHead`).toBe("person:hank");
      // Readers: dave's creator set plus the form defaultReaders — no group:managers.
      expect(flight.readers).toEqual(
        expect.arrayContaining(["person:dave", "group:flight-ops", "group:ground-ops"])
      );
      expect(flight.readers).not.toContain("group:managers");
      // Staging went through real transitions, so each hop is in the history.
      expect(flight.history?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("@me queues route the morning work: carol two flights, ivy the group queue, hank one", async ({ twin }) => {
    const app = twin.scenario.turnaroundAppId;
    const ids = twin.scenario.flightDocIds;

    const carolQueue = await viewDocs(await twin.as("carol"), app, "view:my-queue");
    expect(carolQueue.map((doc) => doc._id).sort()).toEqual([ids.alpha, ids.delta].sort());

    // bravo's assignee is the group principal — ADR-0020 group expansion puts it in
    // every ground-ops member's queue (ivy AND hank).
    const ivyQueue = await viewDocs(await twin.as("ivy"), app, "view:my-queue");
    expect(ivyQueue.map((doc) => doc._id)).toEqual([ids.bravo]);

    const hankQueue = await viewDocs(await twin.as("hank"), app, "view:my-queue");
    expect(hankQueue.map((doc) => doc._id).sort()).toEqual([ids.bravo, ids.charlie].sort());
  });

  test("job descriptions live on the org chart and match the fixture texts", async ({ twin }) => {
    const carol = await twin.as("carol");
    for (const username of ["carol", "ivy", "hank", "grace"] as const) {
      const employee = await getDoc(carol, twin.scenario.orgAppId, twin.scenario.employeeDocIds[username]);
      expect(employee.payload.jobDescription, `${username} job description`).toBe(TWIN_JOB_DESCRIPTIONS[username]);
    }
  });

  test("KB readability matrix: articles company-wide, procedures scoped by authorship", async ({ twin }) => {
    const kb = twin.scenario.kbAppId;
    const { welcome } = twin.scenario.articleDocIds;
    const procedures = twin.scenario.procedureDocIds;

    // Company-wide: even frank (cabin crew, reader level, no procedures of his own)
    // reads the handbook articles — and the welcome article names the per-seed apps.
    const frank = await twin.as("frank");
    const handbook = await viewDocs(frank, kb, "view:handbook");
    expect(handbook.map((doc) => doc._id)).toEqual(
      expect.arrayContaining([welcome, twin.scenario.articleDocIds.howWorkReachesYou])
    );
    const welcomeDoc = await getDoc(frank, kb, welcome);
    expect(welcomeDoc.payload.body).toContain(twin.scenario.turnaroundAppId);
    expect(welcomeDoc.payload.body).toContain(twin.scenario.orgAppId);

    // Authorship scoping: each department member sees exactly their department's
    // procedure in the view (readers narrow the listing, not a filter).
    const dave = await twin.as("dave");
    expect((await viewDocs(dave, kb, "view:procedures")).map((doc) => doc._id)).toEqual([procedures["flight-ops"]]);
    const ivy = await twin.as("ivy");
    expect((await viewDocs(ivy, kb, "view:procedures")).map((doc) => doc._id)).toEqual([procedures["ground-ops"]]);

    // Direct reads across the boundary are refused.
    for (const blocked of [procedures["ground-ops"], procedures.finance]) {
      const direct = await dave.get(`/api/apps/${kb}/documents/${encodeURIComponent(blocked)}`);
      expect([403, 404], `dave must not read ${blocked}`).toContain(direct.status());
    }

    // The documented wrinkle, pinned so it changes loudly: grace's creator set includes
    // group:managers, so carol (a manager) CAN read the finance procedure.
    const carol = await twin.as("carol");
    const financeProcedure = await getDoc(carol, kb, procedures.finance);
    expect(financeProcedure.readers).toEqual(
      expect.arrayContaining(["person:grace", "group:finance", "group:managers"])
    );
  });

  test("finance boundary: grace processes expenses but cannot see flights", async ({ twin }) => {
    const grace = await twin.as("grace");

    // Her real queue: the two staged expenses, one each side of the limit.
    const submitted = (
      (await (await grace.get("/api/apps/expense/documents?docType=expense")).json()) as Doc[]
    ).filter((doc) => doc.state === "submitted");
    expect(submitted.map((doc) => doc._id).sort()).toEqual(
      [twin.scenario.expenseDocIds.compliant, twin.scenario.expenseDocIds.noncompliant].sort()
    );

    // Flights: the boundary is app-level — grace holds no entry in the turnaround
    // ACL (template acl:rules name only admins and the two working departments), so
    // even the listing is refused, before document readers ever apply.
    const flights = await grace.get(`/api/apps/${twin.scenario.turnaroundAppId}/documents?docType=flight`);
    expect(flights.status()).toBe(403);
    const direct = await grace.get(
      `/api/apps/${twin.scenario.turnaroundAppId}/documents/${encodeURIComponent(twin.scenario.flightDocIds.alpha)}`
    );
    expect([403, 404]).toContain(direct.status());
  });

  test("out-of-authority transitions are refused with no state change", async ({ twin }) => {
    const app = twin.scenario.turnaroundAppId;
    const ids = twin.scenario.flightDocIds;

    // ivy (ground-ops) cannot dispatch a fueled flight — that is the ops head's step.
    const ivy = await twin.as("ivy");
    expect((await transition(ivy, app, ids.delta, "dispatch")).status()).toBe(422);

    // dave (flight-ops member, but not the stamped ops head) cannot assign crew.
    const dave = await twin.as("dave");
    expect((await transition(dave, app, ids.alpha, "assign-crew")).status()).toBe(422);

    // carol (ops head) cannot take ground-ops' ramp-check step.
    const carol = await twin.as("carol");
    expect((await transition(carol, app, ids.bravo, "ramp-check")).status()).toBe(422);

    for (const [key, expected] of [
      ["alpha", "scheduled"],
      ["bravo", "crew-assigned"],
      ["delta", "fueled"]
    ] as const) {
      const flight = await getDoc(carol, app, ids[key]);
      expect(flight.state, `${key} unchanged after refusals`).toBe(expected);
    }
  });

  test("the staged day is completable: each hop's owner can finish the cascade", async ({ twin }) => {
    const app = twin.scenario.turnaroundAppId;
    const ids = twin.scenario.flightDocIds;
    const carol = await twin.as("carol");
    const ivy = await twin.as("ivy");
    const hank = await twin.as("hank");
    const grace = await twin.as("grace");

    // Scripted replay of the whole working day (what the agent shifts do in M27's
    // agent tier), proving the substrate path end to end: alpha walks all four hops.
    expect((await transition(carol, app, ids.alpha, "assign-crew")).status()).toBe(200);
    expect((await transition(ivy, app, ids.alpha, "ramp-check")).status()).toBe(200);
    expect((await transition(hank, app, ids.alpha, "fuel-signoff")).status()).toBe(200);
    expect((await transition(carol, app, ids.alpha, "dispatch")).status()).toBe(200);
    const alpha = await getDoc(carol, app, ids.alpha);
    expect(alpha.state).toBe("dispatched");
    // Final state: hand-off cleared (ADR-0018), history recorded every hop.
    expect(alpha.assignee).toBeFalsy();

    // Grace works her queue per the finance procedure.
    expect((await transition(grace, "expense", twin.scenario.expenseDocIds.compliant, "approve")).status()).toBe(200);
    expect((await transition(grace, "expense", twin.scenario.expenseDocIds.noncompliant, "reject")).status()).toBe(200);
  });
});
