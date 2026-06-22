import { test, expect } from "./support/fixtures";
import type { APIRequestContext } from "@playwright/test";

const COUCH = "http://localhost:5985/expense_app";
const couchAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };

type Doc = { _id: string; payload: Record<string, unknown> };
type Event = { _id: string; docId: string; action: string; readers: string[] };

const expenseId = async (request: APIRequestContext, description: string): Promise<string> => {
  const docs = (await request.get("/api/documents?docType=expense").then((r) => r.json())) as Doc[];
  const doc = docs.find((d) => d.payload.description === description);
  if (!doc) throw new Error(`seed expense "${description}" not found`);
  return doc._id;
};

test.describe("audit & retention", () => {
  test("records business-document changes on a tick and is idempotent", async ({ page }) => {
    const ran = await page.request.post("/api/audit/run").then((r) => r.json());
    expect(ran.ok).toBe(true);
    expect(ran.recorded).toBeGreaterThan(0); // the seeded expenses + vendors

    const stationery = await expenseId(page.request, "Stationery");
    const first = (await page.request.get("/api/audit").then((r) => r.json())) as Event[];
    expect(first.some((e) => e.docId === stationery && e.action === "created")).toBe(true);

    // A second tick records nothing new (checkpoint advanced + docId@rev dedupe).
    const again = await page.request.post("/api/audit/run").then((r) => r.json());
    expect(again.recorded).toBe(0);
    const second = (await page.request.get("/api/audit").then((r) => r.json())) as Event[];
    expect(second.length).toBe(first.length);
  });

  test("audit visibility mirrors the document's readers", async ({ bobApi, page }) => {
    await page.request.post("/api/audit/run");

    const stationery = await expenseId(page.request, "Stationery"); // alice / finance only
    const dinner = await expenseId(bobApi, "Client dinner"); // bob can read

    const bobAudit = (await bobApi.get("/api/audit").then((r) => r.json())) as Event[];
    expect(bobAudit.some((e) => e.docId === stationery)).toBe(false);
    expect(bobAudit.some((e) => e.docId === dinner)).toBe(true);

    const aliceAudit = (await page.request.get("/api/audit").then((r) => r.json())) as Event[];
    expect(aliceAudit.some((e) => e.docId === stationery)).toBe(true);
  });

  test("retention prunes events past the policy horizon", async ({ page }) => {
    // Insert an aged event straight into the local replica, then tick. With the
    // seeded 365-day policy a year-2000 event is expired and tombstoned.
    const agedId = "auditevent:aged-0001";
    await page.request.put(`${COUCH}/${agedId}`, {
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
        at: "2000-01-01T00:00:00.000Z",
        readers: ["person:alice", "group:finance"]
      }
    });

    const pruned = await page.request.post("/api/audit/run").then((r) => r.json());
    expect(pruned.pruned).toBeGreaterThanOrEqual(1);

    const audit = (await page.request.get("/api/audit").then((r) => r.json())) as Event[];
    expect(audit.some((e) => e._id === agedId)).toBe(false);
    const couchDoc = await page.request.get(`${COUCH}/${agedId}`, { headers: couchAuth });
    expect(couchDoc.status()).toBe(404);
  });

  test("a delete is audited and the trail renders in the runtime", async ({ app, page }) => {
    // Create then delete via the API: the delete path records a `deleted` event.
    const created = await page.request
      .post("/api/documents", { data: { docType: "expense", payload: { description: "Audit me", amount: 12, category: "travel" } } })
      .then((r) => r.json());
    await page.request.delete(`/api/documents/${encodeURIComponent(created._id)}`);

    const trail = (await page.request.get(`/api/audit?docId=${encodeURIComponent(created._id)}`).then((r) => r.json())) as Event[];
    expect(trail.some((e) => e.action === "deleted")).toBe(true);

    // The runtime panel renders a selected document's trail.
    await page.request.post("/api/audit/run");
    await app.goto();
    await app.openView("view:all-expenses");
    await app.documentRows().first().click();
    await expect(page.getByTestId("audit-trail")).toBeVisible();
    await expect(page.getByTestId("audit-event").first()).toBeVisible();
  });
});
