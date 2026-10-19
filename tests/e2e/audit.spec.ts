import { test, expect } from "./support/fixtures";
import type { APIRequestContext } from "@playwright/test";

const couchAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };

type Doc = { _id: string; payload: Record<string, unknown> };
type Event = { _id: string; docId: string; action: string };

const expenseId = async (request: APIRequestContext, description: string): Promise<string> => {
  const docs = (await request.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];
  const doc = docs.find((d) => d.payload.description === description);
  if (!doc) throw new Error(`seed expense "${description}" not found`);
  return doc._id;
};

test.describe("audit & retention", () => {
  test("records business-document changes on a tick and is idempotent", async ({ page }) => {
    const ran = await page.request.post("/api/apps/expense/audit/run").then((r) => r.json());
    expect(ran.ok).toBe(true);
    expect(ran.recorded).toBeGreaterThan(0); // the seeded expenses + vendors

    const stationery = await expenseId(page.request, "Stationery");
    const first = (await page.request.get("/api/apps/expense/audit").then((r) => r.json())) as Event[];
    expect(first.some((e) => e.docId === stationery && e.action === "created")).toBe(true);

    // A second tick records nothing new (checkpoint advanced + docId@rev dedupe).
    const again = await page.request.post("/api/apps/expense/audit/run").then((r) => r.json());
    expect(again.recorded).toBe(0);
    const second = (await page.request.get("/api/apps/expense/audit").then((r) => r.json())) as Event[];
    expect(second.length).toBe(first.length);
  });

  test("audit visibility is the app ACL (ADR-0026)", async ({ bobApi, page }) => {
    await page.request.post("/api/apps/expense/audit/run");

    const stationery = await expenseId(page.request, "Stationery"); // created by alice
    const dinner = await expenseId(bobApi, "Client dinner"); // created by bob

    // Every app reader sees the whole trail — events carry no readers.
    const bobAudit = (await bobApi.get("/api/apps/expense/audit").then((r) => r.json())) as Event[];
    expect(bobAudit.some((e) => e.docId === stationery)).toBe(true);
    expect(bobAudit.some((e) => e.docId === dinner)).toBe(true);
    expect(bobAudit.every((e) => !("readers" in e))).toBe(true);

    // Without app access the trail is refused outright.
    const revoke = await page.request.put("/api/apps/expense/access", {
      data: { entries: [{ principal: "group:finance", level: "manager" }] }
    });
    expect(revoke.ok()).toBeTruthy();
    expect((await bobApi.get("/api/apps/expense/audit")).status()).toBe(403);
  });

  test("retention prunes events past the policy horizon", async ({ page, localCouchUrl }) => {
    // Insert an aged event straight into the local replica, then tick. With the
    // seeded 365-day policy a year-2000 event is expired and tombstoned.
    const couch = `${localCouchUrl}/expense_app`;
    const agedId = "auditevent:aged-0001";
    await page.request.put(`${couch}/${agedId}`, {
      headers: couchAuth,
      data: {
        _id: agedId,
        kind: "auditevent",
        appId: "expense",
        docId: "doc:expense:aged",
        docType: "expense",
        rev: "1-aged",
        action: "created",
        actor: "person:alice",
        at: "2000-01-01T00:00:00.000Z"
      }
    });

    const pruned = await page.request.post("/api/apps/expense/audit/run").then((r) => r.json());
    expect(pruned.pruned).toBeGreaterThanOrEqual(1);

    const audit = (await page.request.get("/api/apps/expense/audit").then((r) => r.json())) as Event[];
    expect(audit.some((e) => e._id === agedId)).toBe(false);
    const couchDoc = await page.request.get(`${couch}/${agedId}`, { headers: couchAuth });
    expect(couchDoc.status()).toBe(404);
  });

  test("a delete is audited and the trail renders in the runtime", async ({ app, page }) => {
    // Create then delete via the API: the delete path records a `deleted` event.
    const created = await page.request
      .post("/api/apps/expense/documents", { data: { docType: "expense", payload: { description: "Audit me", amount: 12, category: "travel" } } })
      .then((r) => r.json());
    await page.request.delete(`/api/apps/expense/documents/${encodeURIComponent(created._id)}`);

    const trail = (await page.request.get(`/api/apps/expense/audit?docId=${encodeURIComponent(created._id)}`).then((r) => r.json())) as Event[];
    expect(trail.some((e) => e.action === "deleted")).toBe(true);

    // The runtime panel renders a selected document's trail.
    await page.request.post("/api/apps/expense/audit/run");
    await app.goto();
    await app.openView("view:all-expenses");
    await app.documentRows().first().click();
    await expect(page.getByTestId("audit-trail")).toBeVisible();
    await expect(page.getByTestId("audit-event").first()).toBeVisible();
  });
});
