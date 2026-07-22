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
 * ADR-0018 assignee envelope across every installed app for the AUTHENTICATED
 * caller, so a controller can spawn agents on demand instead of polling per-app
 * inbox views (the ADR-0021 operator's motivating consumer). These specs reuse
 * the Agentic Airlines fixture — two workflow apps (leave-request, expense) with
 * real assignee routing and group fan-out.
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
  items?: Array<{ _id: string; docType: string; state: string | null; assignedAt: string | null }>;
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
  test("routes assigned work to the assignee across apps, and clears it on final states", async ({ airline }) => {
    const app = airline.scenario.leaveRequestAppId;

    // Dave files and submits: the engine stamps carol (flight-ops head) as assignee.
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
    expect(item?.assignedAt).toBeTruthy();

    // Erin (a different department head) has no claim on this document.
    const erin = await airline.as("erin");
    const erinLeave = entryFor(await workQueue(erin), app);
    expect(erinLeave?.items ?? []).not.toContainEqual(expect.objectContaining({ _id: request._id }));
    expect(erinLeave?.count ?? 0).toBe(0);

    // Dave is the requester, not the assignee — the open request is not HIS work.
    const daveLeave = entryFor(await workQueue(dave), app);
    expect(daveLeave?.count ?? 0).toBe(0);

    // Approval is a final state: applyTransition CLEARS the assignee, so the
    // document leaves carol's queue with no state filter on the query side.
    await transition(carol, app, request._id, "approve");
    const afterApproval = entryFor(await workQueue(carol), app);
    expect(afterApproval?.items ?? []).not.toContainEqual(expect.objectContaining({ _id: request._id }));
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

  test("ACL still wins: an assignee who cannot read the document sees no work", async ({ airline, page }) => {
    const app = airline.scenario.leaveRequestAppId;
    const ivy = await airline.as("ivy");
    const request = await createDoc(ivy, app, "leave-request", {
      type: "sick",
      from: "2026-07-14",
      to: "2026-07-15",
      reason: "ACL precedence"
    });
    await transition(ivy, app, request._id, "submit"); // assignee = hank (ground-ops head)

    // Hank keeps app access via a person ACL entry but loses DOCUMENT readership
    // (removed from group:ground-ops). Assignee still matches; canReadDocument does not.
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

    const hankQueue = entryFor(await workQueue(await airline.as("hank")), app);
    expect(hankQueue?.items ?? []).not.toContainEqual(expect.objectContaining({ _id: request._id }));
  });

  test("the cross-app selector binds the existing ACL index m2-readers (no new index)", async ({
    airline,
    page,
    localCouchUrl
  }) => {
    const app = airline.scenario.leaveRequestAppId;
    const couchAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };

    // The exact selector the endpoint issues per app db — assignee/readers are
    // in-memory predicates on the kind-prefix scan (ADR-0020 cost class).
    const explain = await page.request.post(`${localCouchUrl}/${app}_app/_explain`, {
      headers: couchAuth,
      data: {
        selector: {
          kind: "document",
          assignee: { $in: ["person:carol", "group:managers"] },
          readers: { $in: ["person:carol", "group:managers"] }
        },
        limit: 200,
        use_index: "m2-readers"
      }
    });
    expect(explain.status()).toBe(200);
    const plan = (await explain.json()) as { index: { name: string } };
    expect(plan.index.name).toBe("m2-readers");
  });
});
