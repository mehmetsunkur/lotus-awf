import type { APIRequestContext } from "@playwright/test";
import { expect, test as base } from "./support/fixtures";
import {
  airlinePersonaContext,
  seedAgenticAirlines,
  type AirlinePersonaName,
  type AirlineScenario
} from "./support/scenario-agentic-airlines";

/**
 * ADR-0022: cross-app work-queue API. `GET /api/work-queue` aggregates the
 * ADR-0018 responsible envelope across every installed app for the AUTHENTICATED
 * caller, so a controller can spawn agents on demand instead of polling per-app
 * inbox views (the ADR-0021 operator's motivating consumer). These specs reuse
 * the Agentic Airlines fixture — two workflow apps (leave-request, expense) with
 * real responsible routing and group fan-out.
 */

type AirlineFixture = {
  airline: {
    scenario: AirlineScenario;
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
type QueueEntry = {
  appId: string;
  database: string;
  count: number;
  items?: Array<{
    _id: string;
    docType: string;
    state: string | null;
    responsibleAt: string | null;
    assignedAt: string | null;
  }>;
};
type Queue = { total: number; byApp: QueueEntry[] };

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

const transition = (context: APIRequestContext, appId: string, docId: string, id: string) =>
  context.post(`/api/apps/${appId}/documents/${encodeURIComponent(docId)}/transition`, {
    data: { transition: id }
  });

const workQueue = async (context: APIRequestContext, query = ""): Promise<Queue> => {
  const response = await context.get(`/api/work-queue${query}`);
  expect(response.status(), "work-queue should answer for an authenticated caller").toBe(200);
  return (await response.json()) as Queue;
};

const entryFor = (queue: Queue, appId: string): QueueEntry | undefined =>
  queue.byApp.find((entry) => entry.appId === appId);

test.describe("ADR-0022 cross-app work queue", () => {
  test("routes assigned work to the responsible across apps, and clears it on final states", async ({ airline }) => {
    const app = airline.scenario.leaveRequestAppId;

    // Dave files and submits: the engine stamps carol (flight-ops head) as responsible.
    const dave = await airline.as("dave");
    const request = await createDoc(dave, app, "leave-request", {
      type: "annual",
      from: "2026-11-02",
      to: "2026-11-06",
      reason: "Work-queue check"
    });
    await transition(dave, app, request._id, "submit");

    // Carol's queue reports the leave-request app with her one pending approval.
    const carol = await airline.as("carol");
    const carolQueue = await workQueue(carol, "?items=true");
    expect(carolQueue.total).toBeGreaterThanOrEqual(1);
    const carolLeave = entryFor(carolQueue, app);
    expect(carolLeave?.count).toBeGreaterThanOrEqual(1);
    expect(carolLeave?.items?.map((item) => item._id)).toContain(request._id);
    // The item carries the routing envelope the spawn payload needs.
    const item = carolLeave?.items?.find((candidate) => candidate._id === request._id);
    expect(item?.state).toBe("submitted");
    expect(item?.responsibleAt).toBeTruthy();
    // The submitted state routes by pool only — no individual was stamped, so the
    // two routing facts are independent (ADR-0025 §2).
    expect(item?.assignedAt).toBeNull();

    // Erin (a different department head) has no claim on this document.
    const erin = await airline.as("erin");
    const erinLeave = entryFor(await workQueue(erin), app);
    expect(erinLeave?.items ?? []).not.toContainEqual(expect.objectContaining({ _id: request._id }));
    expect(erinLeave?.count ?? 0).toBe(0);

    // Dave is the requester, not the responsible — the open request is not HIS work.
    const daveLeave = entryFor(await workQueue(dave), app);
    expect(daveLeave?.count ?? 0).toBe(0);

    // Approval is a final state: applyTransition CLEARS the responsible, so the
    // document leaves carol's queue with no state filter on the query side.
    await transition(carol, app, request._id, "approve");
    const afterApproval = entryFor(await workQueue(carol), app);
    expect(afterApproval?.items ?? []).not.toContainEqual(expect.objectContaining({ _id: request._id }));
  });

  test("routes work matched ONLY by the individual assignee (ADR-0025 §5 union)", async ({ airline, page }) => {
    const app = airline.scenario.leaveRequestAppId;

    // Re-point the `submitted` state to route by an INDIVIDUAL instead of the pool:
    // drop the responsible declarations, add an assigneeFormula. A designer-level
    // definition edit, the same mechanism the scenario itself uses (ADR-0025 §2).
    const defs = (await page.request
      .get(`/api/apps/${app}/definitions`)
      .then((response) => response.json())) as { workflows: Array<{ _id: string; states: Array<Record<string, unknown>> }> };
    const wf = defs.workflows.find((definition) => definition._id === "workflow:leave-request");
    if (!wf) throw new Error("leave-request app is missing workflow:leave-request");
    wf.states = wf.states.map((state) =>
      state.name === "submitted"
        ? { name: "submitted", label: "Submitted", assigneeFormula: "payload.approver" }
        : state
    );
    const put = await page.request.put(
      `/api/apps/${app}/definitions/${encodeURIComponent("workflow:leave-request")}`,
      { data: wf }
    );
    expect(put.status(), "workflow definition edit should succeed").toBe(200);

    // Dave files and submits: the engine stamps carol as the individual assignee,
    // and — crucially — leaves `responsible` field-absent.
    const dave = await airline.as("dave");
    const request = await createDoc(dave, app, "leave-request", {
      type: "annual",
      from: "2026-11-09",
      to: "2026-11-13",
      reason: "Assignee-only routing"
    });
    await transition(dave, app, request._id, "submit");

    // Carol's queue contains it, matched purely by the assignee union arm.
    const carol = await airline.as("carol");
    const carolLeave = entryFor(await workQueue(carol, "?items=true"), app);
    const item = carolLeave?.items?.find((candidate) => candidate._id === request._id);
    expect(item, "carol is the individual assignee").toBeTruthy();
    expect(item?.assignedAt).toBeTruthy();
    expect(item?.responsibleAt).toBeNull();

    // Erin — a manager (in group:managers) who is NOT the assignee — has no claim:
    // the old pool arm would have matched her, the assignee arm does not.
    const erin = await airline.as("erin");
    const erinLeave = entryFor(await workQueue(erin), app);
    expect(erinLeave?.items ?? []).not.toContainEqual(expect.objectContaining({ _id: request._id }));
    expect(erinLeave?.count ?? 0).toBe(0);
  });

  test("group-valued assignments fan out to every member's queue", async ({ airline, page }) => {
    const app = airline.scenario.leaveRequestAppId;

    // Blank ground-ops' head so submit stamps the group:managers fallback.
    const deptId = airline.scenario.departmentDocIds["ground-ops"];
    await page.request.put(`/api/apps/${airline.scenario.orgAppId}/documents/${encodeURIComponent(deptId)}`, {
      data: { payload: { name: "Ground Operations", slug: "ground-ops", parent: "", head: "" } }
    });

    const ivy = await airline.as("ivy");
    const request = await createDoc(ivy, app, "leave-request", {
      type: "unpaid",
      from: "2026-08-17",
      to: "2026-08-20",
      reason: "Headless department"
    });
    await transition(ivy, app, request._id, "submit");

    // group:managers = {carol, erin, grace} — the group-assigned request is in
    // every member's queue (fan-out via principal expansion).
    for (const manager of ["carol", "erin", "grace"] as const) {
      const queue = await workQueue(await airline.as(manager), "?items=true");
      const entry = entryFor(queue, app);
      expect(entry?.items?.map((item) => item._id), `${manager} is a manager`).toContain(request._id);
    }
    // Ivy filed it; it is not the requester's own work.
    const ivyLeave = entryFor(await workQueue(ivy), app);
    expect(ivyLeave?.items ?? []).not.toContainEqual(expect.objectContaining({ _id: request._id }));
  });

  test("actionable=true keeps only work the caller may act on now", async ({ airline }) => {
    const app = airline.scenario.leaveRequestAppId;
    const dave = await airline.as("dave");
    const request = await createDoc(dave, app, "leave-request", {
      type: "annual",
      from: "2026-12-01",
      to: "2026-12-03",
      reason: "Actionable check"
    });
    await transition(dave, app, request._id, "submit");

    // Carol may approve — the request survives the availableTransitions filter.
    const carol = await airline.as("carol");
    const actionable = entryFor(await workQueue(carol, "?actionable=true&items=true"), app);
    expect(actionable?.items?.map((item) => item._id)).toContain(request._id);
  });

  test("ACL still wins: a responsible without app access sees no work (ADR-0026)", async ({ airline, page }) => {
    const app = airline.scenario.leaveRequestAppId;
    const ivy = await airline.as("ivy");
    const request = await createDoc(ivy, app, "leave-request", {
      type: "sick",
      from: "2026-07-14",
      to: "2026-07-15",
      reason: "ACL precedence"
    });
    await transition(ivy, app, request._id, "submit"); // responsible = hank (ground-ops head)

    // Hank loses app access (removed from group:ground-ops, his only ACL path).
    // Responsible still matches, but the app is skipped below `reader`.
    const directory = (await page.request.get("/api/names/directory").then((response) => response.json())) as {
      groups: Array<{ _id: string; members: string[] }>;
    };
    const groundOps = directory.groups.find((group) => group._id === "group:ground-ops");
    await page.request.put("/api/names/groups/ground-ops", {
      data: { members: (groundOps?.members ?? []).filter((member) => member !== "person:hank") }
    });

    const hankQueue = entryFor(await workQueue(await airline.as("hank")), app);
    expect(hankQueue).toBeUndefined();
  });

  test("surfaces routed work behind more than a page of readable-but-unrouted docs", async ({ airline }) => {
    // ADR-0025 §5 routing is an in-memory OR applied AFTER the document scan, so the
    // scan must reach EVERY readable candidate — a fixed page cap would truncate routed
    // work sitting behind unrouted docs. Dave's drafts are readable by carol (an app
    // editor; ADR-0026 visibility is the app ACL) but route to no one; pile up more
    // than one page of them, then submit ONE routed to carol LAST. A page-capped scan
    // would drop it; the paged-to-exhaustion scan must still surface it.
    test.setTimeout(120_000);
    const app = airline.scenario.leaveRequestAppId;
    const dave = await airline.as("dave");

    // 210 unrouted drafts — comfortably past the 200-row page — created before the
    // routed one so they occupy the head of the scan. Batched to stay within budget.
    const FILLERS = 210;
    for (let start = 0; start < FILLERS; start += 30) {
      await Promise.all(
        Array.from({ length: Math.min(30, FILLERS - start) }, (_, i) =>
          createDoc(dave, app, "leave-request", {
            type: "annual",
            from: "2026-09-01",
            to: "2026-09-02",
            reason: `filler ${start + i}`
          })
        )
      );
    }

    // The routed document, created and submitted LAST → highest ULID → tail of the scan.
    const routed = await createDoc(dave, app, "leave-request", {
      type: "annual",
      from: "2026-10-05",
      to: "2026-10-09",
      reason: "routed behind a full page of drafts"
    });
    await transition(dave, app, routed._id, "submit");

    // Carol reads all 211 (manager) but is responsible for exactly the submitted one —
    // it must appear despite sitting past the first page of the scan.
    const carol = await airline.as("carol");
    const carolLeave = entryFor(await workQueue(carol, "?items=true"), app);
    expect(carolLeave?.items?.map((item) => item._id), "routed work not truncated by paging").toContain(routed._id);
  });

  test("the cross-app selector binds the existing m2-kind-docType-updatedAt index (no new index)", async ({
    airline,
    page,
    localCouchUrl
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    const couchAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };

    // The exact selector the endpoint issues per app db (ADR-0025 §5, ADR-0026):
    // `kind` plus presence predicates on the remaining index fields (Mango only
    // binds a JSON index when the selector names every indexed field). The routing
    // union (`responsible ∪ assignee`) is an in-memory OR on the scanned rows, so it
    // is deliberately absent from the Mango selector.
    const explain = await page.request.post(`${localCouchUrl}/${app}_app/_explain`, {
      headers: couchAuth,
      data: {
        selector: { kind: "document", docType: { $gt: null }, updatedAt: { $gt: null } },
        limit: 200,
        use_index: "m2-kind-docType-updatedAt"
      }
    });
    expect(explain.status()).toBe(200);
    const plan = (await explain.json()) as { index: { name: string } };
    expect(plan.index.name).toBe("m2-kind-docType-updatedAt");

    // The m2-readers index is gone from every app db (three-site rule, ADR-0026).
    const indexes = (await page.request
      .get(`${localCouchUrl}/${app}_app/_index`, { headers: couchAuth })
      .then((response) => response.json())) as { indexes: Array<{ name: string }> };
    expect(indexes.indexes.map((index) => index.name)).not.toContain("m2-readers");
  });
});
