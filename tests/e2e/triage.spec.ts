import type { APIRequestContext } from "@playwright/test";
import { expect, test as base } from "./support/fixtures";
import {
  fileTicket,
  seedTriage,
  triagePersonaContext,
  type TriagePersonaName,
  type TriageScenario
} from "./support/scenario-triage";

/**
 * ADR-0025 pickup scenario (§4 claim-as-transition, §5 worklists): a pooled triage
 * backlog. A ticket is filed into the pool (responsible = group:triage, no individual);
 * a triage member CLAIMS it — an ordinary transition — and the engine stamps that member
 * as the individual `assignee` while the pool survives (responsibleFormula re-declares it).
 * Returning it to the backlog clears the individual (clear-then-stamp); resolving clears
 * both (final). These specs prove the pool/individual split through the three §5 views and
 * the cross-app work-queue union.
 */

type TriageFixture = {
  triage: {
    scenario: TriageScenario;
    as: (persona: TriagePersonaName) => Promise<APIRequestContext>;
  };
};

const test = base.extend<TriageFixture>({
  triage: async ({ page, playwright, apiBaseURL }, use) => {
    const scenario = await seedTriage(page.request);
    const contexts: APIRequestContext[] = [];
    const as = async (persona: TriagePersonaName) => {
      const context = await triagePersonaContext(playwright, apiBaseURL, persona);
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
  responsible?: string[];
  responsibleAt?: string;
  assignee?: string;
  assignedAt?: string;
};

const getDoc = async (context: APIRequestContext, appId: string, id: string): Promise<Doc> => {
  const response = await context.get(`/api/apps/${appId}/documents/${encodeURIComponent(id)}`);
  expect(response.status(), `read ${id}`).toBe(200);
  return (await response.json()) as Doc;
};

const viewIds = async (context: APIRequestContext, appId: string, viewId: string): Promise<string[]> => {
  const response = await context.get(`/api/apps/${appId}/views/${encodeURIComponent(viewId)}/documents`);
  expect(response.status(), `view ${viewId}`).toBe(200);
  return ((await response.json()) as Doc[]).map((doc) => doc._id);
};

const transition = async (context: APIRequestContext, appId: string, id: string, transitionId: string) => {
  const response = await context.post(
    `/api/apps/${appId}/documents/${encodeURIComponent(id)}/transition`,
    { data: { transition: transitionId } }
  );
  expect(response.status(), `${transitionId} on ${id}`).toBe(200);
  return response;
};

test.describe("ADR-0025 pooled triage pickup", () => {
  test("claim stamps the individual while the pool survives; return and resolve clear it", async ({ triage }) => {
    const app = triage.scenario.triageAppId;
    const tara = await triage.as("tara");
    const theo = await triage.as("theo");

    // Tara files a ticket into the shared backlog. The engine stamps the pool as
    // responsible; no individual owns it yet.
    const ticket = await fileTicket(tara, app, {
      summary: "Payments webhook retries stall",
      detail: "Retries back off to hours; queue never drains.",
      priority: "urgent"
    });
    const filed = await getDoc(tara, app, ticket._id);
    expect(filed.state).toBe("backlog");
    expect(filed.responsible).toEqual(["group:triage"]);
    expect(filed.responsibleAt).toBeTruthy();
    expect(filed.assignee, "unclaimed: no individual").toBeUndefined();
    expect(filed.assignedAt).toBeUndefined();

    // Unclaimed on the backlog for BOTH triage members (state==backlog AND responsible in @me),
    // present in both team queues (responsible in @me), absent from either My Work.
    for (const [name, ctx] of [["tara", tara], ["theo", theo]] as const) {
      expect(await viewIds(ctx, app, "view:backlog"), `${name} sees it unclaimed`).toContain(ticket._id);
      expect(await viewIds(ctx, app, "view:team-queue"), `${name} team queue`).toContain(ticket._id);
      expect(await viewIds(ctx, app, "view:my-work"), `${name} My Work empty`).not.toContain(ticket._id);
    }

    // Theo claims it — an ordinary transition gated by pool membership (requiredRole).
    // The engine stamps theo as the individual and RE-STAMPS the pool (it survives).
    await transition(theo, app, ticket._id, "claim");
    const claimed = await getDoc(theo, app, ticket._id);
    expect(claimed.state).toBe("in-progress");
    expect(claimed.responsible, "pool survives the claim").toEqual(["group:triage"]);
    expect(claimed.assignee).toBe("person:theo");
    expect(claimed.assignedAt).toBeTruthy();

    // My Work is theo's alone; the pool queue still shows it to BOTH (shared responsibility);
    // it is no longer on the unclaimed backlog (state moved off backlog).
    expect(await viewIds(theo, app, "view:my-work"), "theo owns it").toContain(ticket._id);
    expect(await viewIds(tara, app, "view:my-work"), "not tara's individual work").not.toContain(ticket._id);
    expect(await viewIds(tara, app, "view:team-queue"), "tara still sees the team's item").toContain(ticket._id);
    expect(await viewIds(theo, app, "view:team-queue")).toContain(ticket._id);
    expect(await viewIds(tara, app, "view:backlog"), "claimed: off the unclaimed board").not.toContain(ticket._id);
    expect(await viewIds(theo, app, "view:backlog")).not.toContain(ticket._id);

    // Cross-app work-queue union (§5): theo matches BOTH arms (responsible ∪ assignee) but
    // the single ACL-index scan returns the row ONCE, carrying both timestamps.
    const queue = (await theo
      .get("/api/work-queue?items=true")
      .then((response) => response.json())) as {
      byApp: Array<{ appId: string; items?: Array<{ _id: string; responsibleAt: string | null; assignedAt: string | null }> }>;
    };
    const theoItems = queue.byApp.find((entry) => entry.appId === app)?.items ?? [];
    const rows = theoItems.filter((item) => item._id === ticket._id);
    expect(rows, "returned exactly once despite matching both arms").toHaveLength(1);
    expect(rows[0]?.responsibleAt).toBeTruthy();
    expect(rows[0]?.assignedAt).toBeTruthy();

    // Theo returns it to the backlog: clear-then-stamp clears the individual (backlog
    // declares no assigneeFormula) while re-stamping the pool.
    await transition(theo, app, ticket._id, "return-to-backlog");
    const returned = await getDoc(theo, app, ticket._id);
    expect(returned.state).toBe("backlog");
    expect(returned.responsible).toEqual(["group:triage"]);
    expect(returned.assignee, "individual cleared on return").toBeUndefined();
    expect(returned.assignedAt).toBeUndefined();
    expect(await viewIds(theo, app, "view:my-work"), "off theo's My Work after return").not.toContain(ticket._id);
    expect(await viewIds(tara, app, "view:backlog"), "up for grabs again").toContain(ticket._id);

    // Tara claims the returned ticket, then resolves it. The final state clears BOTH.
    await transition(tara, app, ticket._id, "claim");
    const taraClaimed = await getDoc(tara, app, ticket._id);
    expect(taraClaimed.assignee).toBe("person:tara");
    await transition(tara, app, ticket._id, "resolve");
    const resolved = await getDoc(tara, app, ticket._id);
    expect(resolved.state).toBe("resolved");
    expect(resolved.responsible, "final clears the pool").toBeUndefined();
    expect(resolved.assignee, "final clears the individual").toBeUndefined();

    // Gone from every @me worklist for both members once resolved.
    for (const [name, ctx] of [["tara", tara], ["theo", theo]] as const) {
      expect(await viewIds(ctx, app, "view:team-queue"), `${name} team queue clear`).not.toContain(ticket._id);
      expect(await viewIds(ctx, app, "view:my-work"), `${name} My Work clear`).not.toContain(ticket._id);
      expect(await viewIds(ctx, app, "view:backlog"), `${name} backlog clear`).not.toContain(ticket._id);
    }
  });
});
