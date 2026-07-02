import type { APIRequestContext } from "@playwright/test";
import { expect, test as base } from "./support/fixtures";
import {
  airlinePersonaContext,
  seedAgenticAirlines,
  type AirlinePersonaName,
  type AirlineScenario
} from "./support/scenario-agentic-airlines";

/**
 * Scripted-persona scenario specs (M25): the Agentic Airlines PLC fixture is
 * seeded per test on top of `/api/reset`, then independent authenticated
 * persona contexts drive multi-user workflow, ACL-visibility, and audit
 * assertions over the org, leave-request, and expense apps.
 */

type AirlineFixture = {
  airline: {
    scenario: AirlineScenario;
    /** Authenticated request context for a persona; disposed on test end. */
    as: (username: AirlinePersonaName) => Promise<APIRequestContext>;
  };
};

const test = base.extend<AirlineFixture>({
  airline: async ({ page, playwright, apiBaseURL }, use) => {
    const scenario = await seedAgenticAirlines(page.request);
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

type Doc = { _id: string; state?: string; payload: Record<string, unknown> };

const viewDocs = async (context: APIRequestContext, appId: string, viewId: string): Promise<Doc[]> => {
  const response = await context.get(`/api/apps/${appId}/views/${encodeURIComponent(viewId)}/documents`);
  expect(response.status(), `${viewId} should list for the persona`).toBe(200);
  return (await response.json()) as Doc[];
};

const createDoc = async (
  context: APIRequestContext,
  appId: string,
  docType: string,
  payload: Record<string, unknown>
): Promise<Doc> => {
  const response = await context.post(`/api/apps/${appId}/documents`, { data: { docType, payload } });
  expect(response.status(), `create ${docType} should succeed`).toBe(201);
  return (await response.json()) as Doc;
};

const transition = async (context: APIRequestContext, appId: string, docId: string, id: string) =>
  context.post(`/api/apps/${appId}/documents/${encodeURIComponent(docId)}/transition`, {
    data: { transition: id }
  });

test.describe("Agentic Airlines PLC scenario", () => {
  test("seeds the airline: apps deployed and the org chart visible to staff with manager chains", async ({
    airline,
    page
  }) => {
    const state = await page.request.get("/api/platform/state").then((response) => response.json());
    const appIds = state.installedApps.map((app: { appId: string }) => app.appId);
    expect(appIds).toEqual(
      expect.arrayContaining(["expense", airline.scenario.orgAppId, airline.scenario.leaveRequestAppId])
    );

    // Frank (cabin crew, no admin rights) sees exactly the airline org chart —
    // the template's admin-only sample departments/employees stay invisible.
    const frank = await airline.as("frank");
    const departments = await viewDocs(frank, airline.scenario.orgAppId, "view:departments");
    const headBySlug = new Map(departments.map((doc) => [doc.payload.slug, doc.payload.head]));
    expect(headBySlug.size).toBe(3);
    expect(headBySlug.get("flight-ops")).toBe("person:carol");
    expect(headBySlug.get("cabin-crew")).toBe("person:erin");
    expect(headBySlug.get("finance")).toBe("person:grace");

    const employees = await viewDocs(frank, airline.scenario.orgAppId, "view:employees");
    const byPerson = new Map(employees.map((doc) => [doc.payload.person, doc.payload]));
    expect(byPerson.size).toBe(5);
    expect(byPerson.get("person:dave")).toMatchObject({ department: "flight-ops" });
    expect(byPerson.get("person:frank")).toMatchObject({ department: "cabin-crew" });

    // Reporting lines derive from department.head (the single source of truth)
    // via the employee form's manager formula field: your department's head, the
    // parent department's head if you ARE the head, blank for a top-level head.
    const managerOf = async (username: keyof typeof airline.scenario.employeeDocIds) => {
      const docId = airline.scenario.employeeDocIds[username];
      const response = await frank.get(
        `/api/apps/${airline.scenario.orgAppId}/documents/${encodeURIComponent(docId)}/formulas`
      );
      expect(response.status()).toBe(200);
      return ((await response.json()) as { manager?: string }).manager;
    };
    expect(await managerOf("dave")).toBe("person:carol");
    expect(await managerOf("frank")).toBe("person:erin");
    expect(await managerOf("erin")).toBe("person:carol"); // head of cabin-crew → head of parent flight-ops
    expect(await managerOf("grace")).toBeUndefined(); // head of top-level finance
    expect(await managerOf("carol")).toBeUndefined(); // head of top-level flight-ops
  });

  test("an employee's leave request travels submit → approve with a reader-scoped audit trail", async ({
    airline,
    page
  }) => {
    const dave = await airline.as("dave");
    const request = await createDoc(dave, airline.scenario.leaveRequestAppId, "leave-request", {
      type: "annual",
      from: "2026-09-07",
      to: "2026-09-18",
      reason: "Family visit to Istanbul"
    });

    const submitted = await transition(dave, airline.scenario.leaveRequestAppId, request._id, "submit");
    expect(submitted.status()).toBe(200);
    expect((await submitted.json()).state).toBe("submitted");

    // Carol (Dave's manager, group:managers) finds it in the approval worklist
    // and approves it.
    const carol = await airline.as("carol");
    const pending = await viewDocs(carol, airline.scenario.leaveRequestAppId, "view:pending-approval");
    expect(pending.map((doc) => doc._id)).toContain(request._id);

    const approved = await transition(carol, airline.scenario.leaveRequestAppId, request._id, "approve");
    expect(approved.status()).toBe(200);
    expect((await approved.json()).state).toBe("approved");

    // Audit events copy the source document's readers: the manager sees the
    // trail, an unrelated employee does not.
    await page.request.post(`/api/apps/${airline.scenario.leaveRequestAppId}/audit/run`);
    const carolEvents = (await carol
      .get(`/api/apps/${airline.scenario.leaveRequestAppId}/audit`)
      .then((response) => response.json())) as Array<{ docId: string }>;
    expect(carolEvents.map((event) => event.docId)).toContain(request._id);

    const frank = await airline.as("frank");
    const frankEvents = (await frank
      .get(`/api/apps/${airline.scenario.leaveRequestAppId}/audit`)
      .then((response) => response.json())) as Array<{ docId: string }>;
    expect(frankEvents.map((event) => event.docId)).not.toContain(request._id);
  });

  test("a manager can reject a submitted leave request", async ({ airline }) => {
    const frank = await airline.as("frank");
    const request = await createDoc(frank, airline.scenario.leaveRequestAppId, "leave-request", {
      type: "unpaid",
      from: "2026-12-21",
      to: "2027-01-08",
      reason: "Extended winter break"
    });
    await transition(frank, airline.scenario.leaveRequestAppId, request._id, "submit");

    const erin = await airline.as("erin");
    const rejected = await transition(erin, airline.scenario.leaveRequestAppId, request._id, "reject");
    expect(rejected.status()).toBe(200);
    expect((await rejected.json()).state).toBe("rejected");
  });

  test("leave requests are isolated: peers cannot read them and requesters cannot self-approve", async ({
    airline
  }) => {
    const dave = await airline.as("dave");
    const request = await createDoc(dave, airline.scenario.leaveRequestAppId, "leave-request", {
      type: "sick",
      from: "2026-07-02",
      to: "2026-07-03",
      reason: "Medical appointment"
    });
    await transition(dave, airline.scenario.leaveRequestAppId, request._id, "submit");

    // Frank is in another department: the request is neither listed nor
    // directly readable for him.
    const frank = await airline.as("frank");
    const frankSees = await viewDocs(frank, airline.scenario.leaveRequestAppId, "view:my-requests");
    expect(frankSees.map((doc) => doc._id)).not.toContain(request._id);
    const direct = await frank.get(`/api/apps/${airline.scenario.leaveRequestAppId}/documents/${encodeURIComponent(request._id)}`);
    expect([403, 404]).toContain(direct.status());

    // Dave authored the request but is not in group:managers — the workflow
    // gate refuses his own approval.
    const selfApprove = await transition(dave, airline.scenario.leaveRequestAppId, request._id, "approve");
    expect(selfApprove.status()).toBe(422);

    // Grace holds group:managers, so the same transition succeeds for her.
    const grace = await airline.as("grace");
    const approved = await transition(grace, airline.scenario.leaveRequestAppId, request._id, "approve");
    expect(approved.status()).toBe(200);
  });

  test("the same personas work the expense app: crew files, finance approves, others see nothing", async ({
    airline
  }) => {
    const frank = await airline.as("frank");
    const expense = await createDoc(frank, "expense", "expense", {
      amount: 84,
      description: "Crew overnight taxi",
      category: "travel",
      spentAt: "2026-06-28"
    });
    expect(expense.payload.gross).toBe(100.8);

    await transition(frank, "expense", expense._id, "submit");
    const refused = await transition(frank, "expense", expense._id, "approve");
    expect(refused.status(), "a non-finance persona cannot approve").toBe(422);

    const grace = await airline.as("grace");
    const approved = await transition(grace, "expense", expense._id, "approve");
    expect(approved.status()).toBe(200);
    expect((await approved.json()).state).toBe("approved");

    // Dave is in neither cabin-crew nor finance, so Frank's expense stays
    // invisible to him.
    const dave = await airline.as("dave");
    const daveSees = await dave
      .get("/api/apps/expense/documents?docType=expense")
      .then((response) => response.json() as Promise<Doc[]>);
    expect(daveSees.map((doc) => doc._id)).not.toContain(expense._id);
  });
});
