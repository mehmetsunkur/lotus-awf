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
    expect(headBySlug.size).toBe(4);
    expect(headBySlug.get("flight-ops")).toBe("person:carol");
    expect(headBySlug.get("cabin-crew")).toBe("person:erin");
    expect(headBySlug.get("ground-ops")).toBe("person:hank");
    expect(headBySlug.get("finance")).toBe("person:grace");

    const employees = await viewDocs(frank, airline.scenario.orgAppId, "view:employees");
    const byPerson = new Map(employees.map((doc) => [doc.payload.person, doc.payload]));
    expect(byPerson.size).toBe(7);
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
    expect(await managerOf("ivy")).toBe("person:hank");
    expect(await managerOf("hank")).toBeUndefined(); // head of top-level ground-ops
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

    // ADR-0017: grace holds group:managers but is NOT dave's department head —
    // the dynamic gate refuses her where the old static role would have allowed.
    const grace = await airline.as("grace");
    const graceRefused = await transition(grace, airline.scenario.leaveRequestAppId, request._id, "approve");
    expect(graceRefused.status()).toBe(422);

    // Carol — head of dave's department — is the resolved approver.
    const carol = await airline.as("carol");
    const approved = await transition(carol, airline.scenario.leaveRequestAppId, request._id, "approve");
    expect(approved.status()).toBe(200);
  });

  test("ADR-0019/0018: approval routes to the stamped department head and the responsible tracks the hand-off", async ({
    airline
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    const dave = await airline.as("dave");
    const request = await createDoc(dave, app, "leave-request", {
      type: "annual",
      from: "2026-10-05",
      to: "2026-10-09",
      reason: "Autumn break"
    });
    await transition(dave, app, request._id, "submit");

    // ADR-0018: submit stamped the resolved department head as the responsible.
    const submitted = (await dave
      .get(`/api/apps/${app}/documents/${encodeURIComponent(request._id)}`)
      .then((response) => response.json())) as Doc & { responsible?: string[]; responsibleAt?: string };
    expect(submitted.responsible).toEqual(["person:carol"]);
    expect(submitted.responsibleAt).toBeTruthy();

    // ADR-0017: erin holds group:managers but heads another department — 422.
    const erin = await airline.as("erin");
    const refused = await transition(erin, app, request._id, "approve");
    expect(refused.status()).toBe(422);
    const refusal = (await refused.json()) as { errors: Array<{ message: string }> };
    expect(refusal.errors[0].message).toContain("not allowed for this document");

    const carol = await airline.as("carol");
    const approved = await transition(carol, app, request._id, "approve");
    expect(approved.status()).toBe(200);
    const final = (await approved.json()) as Doc & { responsible?: string[] };
    expect(final.state).toBe("approved");
    expect(final.responsible).toBeUndefined(); // final states clear the assignment
  });

  test("ADR-0019: a department head outside group:managers can approve their department's requests", async ({
    airline
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    const ivy = await airline.as("ivy");
    const request = await createDoc(ivy, app, "leave-request", {
      type: "sick",
      from: "2026-07-06",
      to: "2026-07-07",
      reason: "Dentist"
    });
    await transition(ivy, app, request._id, "submit");

    // The stamp routed to hank even though he holds no managers membership…
    const hank = await airline.as("hank");
    const assigned = (await hank
      .get(`/api/apps/${app}/documents/${encodeURIComponent(request._id)}`)
      .then((response) => response.json())) as Doc & { responsible?: string[] };
    expect(assigned.responsible).toEqual(["person:hank"]);

    // …a manager outside the resolved set is refused…
    const grace = await airline.as("grace");
    expect((await transition(grace, app, request._id, "approve")).status()).toBe(422);

    // …and hank approves purely via the dynamic gate (no requiredRole held).
    const approved = await transition(hank, app, request._id, "approve");
    expect(approved.status()).toBe(200);
  });

  test("ADR-0019: a headless department stamps the group:managers fallback", async ({
    airline,
    page
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    // Blank ground-ops' head (an admin org-chart edit, as after a resignation).
    const deptId = airline.scenario.departmentDocIds["ground-ops"];
    const updated = await page.request.put(
      `/api/apps/${airline.scenario.orgAppId}/documents/${encodeURIComponent(deptId)}`,
      { data: { payload: { name: "Ground Operations", slug: "ground-ops", parent: "", head: "" } } }
    );
    expect(updated.status()).toBe(200);

    const ivy = await airline.as("ivy");
    const request = await createDoc(ivy, app, "leave-request", {
      type: "unpaid",
      from: "2026-08-01",
      to: "2026-08-02",
      reason: "Moving day"
    });
    await transition(ivy, app, request._id, "submit");

    // No head resolves: the static responsible stamps and the requiredRole
    // fallback gates — hank (no managers role) is refused, erin passes.
    const submitted = (await ivy
      .get(`/api/apps/${app}/documents/${encodeURIComponent(request._id)}`)
      .then((response) => response.json())) as Doc & { responsible?: string[] };
    expect(submitted.responsible).toEqual(["group:managers"]);

    const hank = await airline.as("hank");
    expect((await transition(hank, app, request._id, "approve")).status()).toBe(422);
    const erin = await airline.as("erin");
    expect((await transition(erin, app, request._id, "approve")).status()).toBe(200);
  });

  test("ADR-0019 tamper rule: client-supplied computed values are discarded on create, save, and conflict-resolve", async ({
    airline,
    page,
    playwright,
    apiBaseURL,
    localCouchUrl,
    serverCouchUrl
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    const couchAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };
    const db = `${app}_app`;

    // Create with a self-serving approver and a fake department: both stamped over.
    const dave = await airline.as("dave");
    const request = await createDoc(dave, app, "leave-request", {
      type: "annual",
      from: "2026-11-02",
      to: "2026-11-06",
      reason: "Tamper probe",
      approver: "person:dave",
      department: "somewhere-else"
    });
    expect(request.payload.approver).toBe("person:carol");
    expect(request.payload.department).toBe("flight-ops");

    // Save with tampered values: discarded again (computed re-stamps, once preserves).
    const putResponse = await dave.put(`/api/apps/${app}/documents/${encodeURIComponent(request._id)}`, {
      data: { payload: { ...request.payload, reason: "Edited", approver: "person:dave", department: "elsewhere" } }
    });
    expect(putResponse.status()).toBe(200);
    const saved = (await putResponse.json()) as Doc;
    expect(saved.payload.approver).toBe("person:carol");
    expect(saved.payload.department).toBe("flight-ops");

    // Conflict-resolve (review B1): force a replication conflict, then resolve
    // with a tampered approver — the elected payload runs the stamp pipeline.
    // Replication's business-doc pull is reader-scoped to the caller (M5), so
    // sync as DAVE — alice is not a reader of his request and would never pull
    // the divergent revision back.
    await dave.post(`/api/apps/${app}/replicate`);
    const readRev = async (url: string) =>
      (await page.request.get(`${url}/${db}/${encodeURIComponent(request._id)}`, { headers: couchAuth }).then((r) => r.json())) as Doc & { _rev: string };
    const localDoc = await readRev(localCouchUrl);
    const serverDoc = await readRev(serverCouchUrl);
    const diverge = (base: Doc & { _rev: string }, marker: string) => ({
      ...base,
      payload: { ...base.payload, reason: marker },
      updatedAt: new Date().toISOString()
    });
    const localPut = await page.request.put(`${localCouchUrl}/${db}/${encodeURIComponent(request._id)}`, {
      headers: couchAuth,
      data: diverge(localDoc, "local edit")
    });
    expect(localPut.status(), await localPut.text()).toBe(201);
    const serverPut = await page.request.put(`${serverCouchUrl}/${db}/${encodeURIComponent(request._id)}`, {
      headers: couchAuth,
      data: diverge(serverDoc, "server edit")
    });
    expect(serverPut.status(), await serverPut.text()).toBe(201);
    const sync = await dave.post(`/api/apps/${app}/replicate`);
    expect(sync.status()).toBe(200);
    const conflicted = await page.request.get(`${localCouchUrl}/${db}/${encodeURIComponent(request._id)}?conflicts=true`, { headers: couchAuth });
    expect(((await conflicted.json()) as { _conflicts?: string[] })._conflicts?.length ?? 0, "forged conflict should exist").toBeGreaterThan(0);

    const resolveResponse = await dave.post(`/api/apps/${app}/conflicts/${encodeURIComponent(request._id)}/resolve`, {
      data: { payload: { ...request.payload, reason: "resolved", approver: "person:dave" } }
    });
    expect(resolveResponse.status()).toBe(200);
    const resolved = (await resolveResponse.json()) as Doc;
    expect(resolved.payload.reason).toBe("resolved");
    expect(resolved.payload.approver).toBe("person:carol"); // tamper discarded on the third write path
  });

  test("ADR-0019 computed-once: the filed-under department survives a transfer while the approver re-routes", async ({
    airline,
    page
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    const ivy = await airline.as("ivy");
    const request = await createDoc(ivy, app, "leave-request", {
      type: "annual",
      from: "2026-09-21",
      to: "2026-09-25",
      reason: "Filed from ground ops"
    });
    expect(request.payload.approver).toBe("person:hank");
    expect(request.payload.department).toBe("ground-ops");

    // Ivy transfers to cabin crew (admin edits her org employee record)…
    const employeeId = airline.scenario.employeeDocIds.ivy;
    const orgApp = airline.scenario.orgAppId;
    const employee = (await page.request
      .get(`/api/apps/${orgApp}/documents/${encodeURIComponent(employeeId)}`)
      .then((response) => response.json())) as Doc;
    const moved = await page.request.put(`/api/apps/${orgApp}/documents/${encodeURIComponent(employeeId)}`, {
      data: { payload: { ...employee.payload, department: "cabin-crew" } }
    });
    expect(moved.status()).toBe(200);

    // …then edits her request: computed approver re-stamps to the new head,
    // computed-once department keeps the filed-under value.
    const edited = (await ivy
      .put(`/api/apps/${app}/documents/${encodeURIComponent(request._id)}`, {
        data: { payload: { ...request.payload, reason: "Edited after transfer" } }
      })
      .then((response) => response.json())) as Doc;
    expect(edited.payload.approver).toBe("person:erin");
    expect(edited.payload.department).toBe("ground-ops");
  });

  test("ADR-0019 preserve-on-empty: an org-blind writer's edit keeps the stamped approver (never widens)", async ({
    airline,
    page
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    const dave = await airline.as("dave");
    const request = await createDoc(dave, app, "leave-request", {
      type: "sick",
      from: "2026-07-08",
      to: "2026-07-09",
      reason: "Before losing org access"
    });
    expect(request.payload.approver).toBe("person:carol");

    // Dave loses org visibility (removed from flight-ops) but keeps authoring
    // rights on the leave app via an explicit person-level access entry.
    const access = (await page.request
      .get(`/api/apps/${app}/access`)
      .then((response) => response.json())) as { entries: Array<{ principal: string; level: string }> };
    await page.request.put(`/api/apps/${app}/access`, {
      data: { entries: [...access.entries, { principal: "person:dave", level: "author" }] }
    });
    const directory = (await page.request.get("/api/names/directory").then((response) => response.json())) as {
      groups: Array<{ _id: string; members: string[] }>;
    };
    const flightOps = directory.groups.find((group) => group._id === "group:flight-ops");
    await page.request.put("/api/names/groups/flight-ops", {
      data: { members: (flightOps?.members ?? []).filter((member) => member !== "person:dave") }
    });

    // His edit resolves nothing (cannot read the org app) — the stamp is preserved,
    // NOT cleared and NOT widened to group:managers.
    const daveBlind = await airline.as("dave");
    const edited = (await daveBlind
      .put(`/api/apps/${app}/documents/${encodeURIComponent(request._id)}`, {
        data: { payload: { ...request.payload, reason: "Edited while org-blind" } }
      })
      .then((response) => response.json())) as Doc;
    expect(edited.payload.approver).toBe("person:carol");
  });

  test("ADR-0020 @me: personal inboxes route by responsible, My views mean mine, ACL still wins", async ({
    airline,
    page,
    localCouchUrl
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    const couchAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };

    // Dave files and submits: responsible = carol.
    const dave = await airline.as("dave");
    const daveRequest = await createDoc(dave, app, "leave-request", {
      type: "annual",
      from: "2026-10-12",
      to: "2026-10-16",
      reason: "Inbox check"
    });
    await transition(dave, app, daveRequest._id, "submit");

    // Ivy files and submits: responsible = hank.
    const ivy = await airline.as("ivy");
    const ivyRequest = await createDoc(ivy, app, "leave-request", {
      type: "sick",
      from: "2026-07-09",
      to: "2026-07-10",
      reason: "Inbox check"
    });
    await transition(ivy, app, ivyRequest._id, "submit");

    // Personal inboxes: carol sees dave's, hank sees ivy's, erin sees neither.
    const carol = await airline.as("carol");
    const hank = await airline.as("hank");
    const erin = await airline.as("erin");
    expect((await viewDocs(carol, app, "view:my-approvals")).map((doc) => doc._id)).toContain(daveRequest._id);
    expect((await viewDocs(hank, app, "view:my-approvals")).map((doc) => doc._id)).toContain(ivyRequest._id);
    const erinInbox = (await viewDocs(erin, app, "view:my-approvals")).map((doc) => doc._id);
    expect(erinInbox).not.toContain(daveRequest._id);
    expect(erinInbox).not.toContain(ivyRequest._id);

    // My views mean mine: dave's my-requests has his doc, frank's has neither.
    expect((await viewDocs(dave, app, "view:my-requests")).map((doc) => doc._id)).toContain(daveRequest._id);
    const frank = await airline.as("frank");
    const frankRequests = (await viewDocs(frank, app, "view:my-requests")).map((doc) => doc._id);
    expect(frankRequests).not.toContain(daveRequest._id);

    // Approval clears the responsible and the request LEAVES the inbox.
    await transition(carol, app, daveRequest._id, "approve");
    expect((await viewDocs(carol, app, "view:my-approvals")).map((doc) => doc._id)).not.toContain(daveRequest._id);

    // ACL precedence pinned (review M4): hank stays ivy's responsible but loses
    // DOCUMENT readership (removed from group:ground-ops) — the inbox must NOT
    // show it. He keeps app-level access via a person entry so the view route
    // itself still answers (we are testing doc ACL, not the app gate).
    const access = (await page.request
      .get(`/api/apps/${app}/access`)
      .then((response) => response.json())) as { entries: Array<{ principal: string; level: string }> };
    await page.request.put(`/api/apps/${app}/access`, {
      data: { entries: [...access.entries, { principal: "person:hank", level: "author" }] }
    });
    const directory = (await page.request.get("/api/names/directory").then((response) => response.json())) as {
      groups: Array<{ _id: string; members: string[] }>;
    };
    const groundOps = directory.groups.find((group) => group._id === "group:ground-ops");
    await page.request.put("/api/names/groups/ground-ops", {
      data: { members: (groundOps?.members ?? []).filter((member) => member !== "person:hank") }
    });
    const hankBlind = await airline.as("hank");
    expect((await viewDocs(hankBlind, app, "view:my-approvals")).map((doc) => doc._id)).not.toContain(
      ivyRequest._id
    );

    // Index binding verified, not assumed (ADR-0020 performance guard): the
    // inbox selector still binds the m3 index per CouchDB _explain.
    const explain = await page.request.post(`${localCouchUrl}/${app}_app/_explain`, {
      headers: couchAuth,
      data: {
        selector: {
          kind: "document",
          docType: { $eq: "leave-request" },
          state: { $eq: "submitted" },
          responsible: { $in: ["person:carol", "group:managers"] },
          readers: { $in: ["person:carol", "group:managers"] }
        },
        sort: [{ updatedAt: "desc" }],
        limit: 200,
        use_index: "m3-docType-state-updatedAt"
      }
    });
    expect(explain.status()).toBe(200);
    const plan = (await explain.json()) as { index: { name: string } };
    expect(plan.index.name).toBe("m3-docType-state-updatedAt");
  });

  test("ADR-0020 @me: a headless-department request lands in every manager's inbox (group expansion)", async ({
    airline,
    page
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    // Blank ground-ops' head, then ivy files: responsible stamps group:managers.
    const deptId = airline.scenario.departmentDocIds["ground-ops"];
    await page.request.put(`/api/apps/${airline.scenario.orgAppId}/documents/${encodeURIComponent(deptId)}`, {
      data: { payload: { name: "Ground Operations", slug: "ground-ops", parent: "", head: "" } }
    });
    const ivy = await airline.as("ivy");
    const request = await createDoc(ivy, app, "leave-request", {
      type: "unpaid",
      from: "2026-08-03",
      to: "2026-08-04",
      reason: "Group inbox check"
    });
    await transition(ivy, app, request._id, "submit");

    // Every group:managers member's inbox contains it; hank's (no role) does not.
    for (const manager of ["carol", "erin", "grace"] as const) {
      const inbox = await viewDocs(await airline.as(manager), app, "view:my-approvals");
      expect(inbox.map((doc) => doc._id), `${manager}'s inbox`).toContain(request._id);
    }
    const hank = await airline.as("hank");
    expect((await viewDocs(hank, app, "view:my-approvals")).map((doc) => doc._id)).not.toContain(request._id);
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
