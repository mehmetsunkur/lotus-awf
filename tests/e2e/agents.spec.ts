import { test, expect } from "./support/fixtures";

/**
 * M8 agent runtime. The seed defines a scheduled agent (agent:daily-digest) and
 * an on-change agent (agent:on-expense-change), both running the record-activity
 * handler. Agents are server-authoritative and tick-driven via POST
 * /api/agents/run, so the suite drives them explicitly (deterministic).
 */
test.describe("agent runtime", () => {
  test.setTimeout(60_000);

  test("a scheduled agent runs on the first tick and records a durable run", async ({ page }) => {
    const res = await page.request.post("/api/agents/run");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.runs.some((r: { agentId: string; trigger: string }) => r.agentId === "agent:daily-digest" && r.trigger === "schedule")).toBe(true);

    const runs = await page.request.get("/api/agents/runs").then((r) => r.json());
    expect(runs.some((r: { agentId: string }) => r.agentId === "agent:daily-digest")).toBe(true);
  });

  test("an on-change agent fires for a newly created document", async ({ page }) => {
    const created = await page.request.post("/api/documents", {
      data: { docType: "expense", payload: { amount: 30, description: "Agent trigger", category: "supplies" } }
    });
    const id: string = (await created.json())._id;

    const body = await page.request.post("/api/agents/run").then((r) => r.json());
    expect(
      body.runs.some(
        (r: { agentId: string; trigger: string; sourceId?: string }) =>
          r.agentId === "agent:on-expense-change" && r.trigger === "on-change" && r.sourceId === id
      )
    ).toBe(true);
  });

  test("a second tick does not re-run already-processed work (durable checkpoint + dedupe)", async ({ page }) => {
    const first = await page.request.post("/api/agents/run").then((r) => r.json());
    expect(first.ran).toBeGreaterThan(0);

    const runsAfterFirst = await page.request.get("/api/agents/runs").then((r) => r.json());
    expect(runsAfterFirst.length).toBeGreaterThan(0);

    // Nothing new happened and the scheduled agent is not yet due again.
    const second = await page.request.post("/api/agents/run").then((r) => r.json());
    expect(second.ran).toBe(0);
  });

  test("agent definitions export in the template artifact", async ({ page }) => {
    const template = await page.request.post("/api/templates/export", { data: {} }).then((r) => r.json());
    const ids = template.definitions.map((d: { _id: string }) => d._id);
    expect(ids).toContain("agent:daily-digest");
    // Runtime agent state/run docs are never templated.
    expect(ids.some((id: string) => id.startsWith("agentrun:") || id === "agent:state")).toBe(false);
  });
});
