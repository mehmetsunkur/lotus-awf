import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./support/fixtures";

const couchAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };

type AccessibleApp = { appId: string; title: string; description?: string; accessLevel: string };

type Doc = {
  _id: string;
  _rev?: string;
  authors: string[];
  payload: Record<string, unknown>;
};

// ADR-0026: document visibility is the app ACL — every app reader sees every
// document; revoking app access is enforced at the API gate.
async function setExpenseAccess(page: { request: APIRequestContext }, bob?: string) {
  const res = await page.request.put("/api/apps/expense/access", {
    data: {
      entries: [
        { principal: "group:finance", level: "manager" },
        ...(bob ? [{ principal: "person:bob", level: bob }] : [])
      ]
    }
  });
  expect(res.ok(), `set expense access: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe("ACL scoped runtime", () => {
  test("GET /api/apps returns accessible apps with accessLevel for the authenticated caller", async ({ bobApi, playwright, apiBaseURL, resetState }) => {
    void resetState;
    // Alice is in group:admins → manager on every app.
    const aliceApi = await playwright.request.newContext({ baseURL: apiBaseURL });
    await aliceApi.post("/api/session/login", { data: { username: "alice", password: "password123" } });

    const aliceApps = (await aliceApi.get("/api/apps").then((r) => r.json())) as AccessibleApp[];
    const aliceExpense = aliceApps.find((a) => a.appId === "expense");
    expect(aliceExpense).toBeDefined();
    expect(aliceExpense!.title).toBeTruthy();
    expect(aliceExpense!.description).toBeTruthy();
    expect(aliceExpense!.accessLevel).toBe("manager");
    await aliceApi.dispose();

    // Bob has an explicit "author" entry on expense from the template ACL.
    const bobApps = (await bobApi.get("/api/apps").then((r) => r.json())) as AccessibleApp[];
    const bobExpense = bobApps.find((a) => a.appId === "expense");
    expect(bobExpense).toBeDefined();
    expect(bobExpense!.accessLevel).toBe("author");

    // Every entry must carry a non-"none" accessLevel.
    for (const app of bobApps) {
      expect(["reader", "author", "editor", "designer", "manager"]).toContain(app.accessLevel);
    }
  });

  test("GET /api/apps hides apps the caller cannot access", async ({ bobApi, playwright, apiBaseURL, resetState }) => {
    void resetState;
    const aliceApi = await playwright.request.newContext({ baseURL: apiBaseURL });
    await aliceApi.post("/api/session/login", { data: { username: "alice", password: "password123" } });

    // Alice (admin) creates a second app with no ACL entry for bob.
    const newAppId = `private-${Date.now().toString(36)}`;
    const created = await aliceApi.post("/api/platform/apps", {
      data: { appId: newAppId, title: "Private App", docType: "item", docTypeTitle: "Item" }
    });
    expect(created.ok()).toBeTruthy();

    // Alice can see it.
    const aliceApps = (await aliceApi.get("/api/apps").then((r) => r.json())) as AccessibleApp[];
    expect(aliceApps.map((a) => a.appId)).toContain(newAppId);
    await aliceApi.dispose();

    // Bob cannot — no ACL entry, not in group:admins.
    const bobApps = (await bobApi.get("/api/apps").then((r) => r.json())) as AccessibleApp[];
    expect(bobApps.map((a) => a.appId)).not.toContain(newAppId);
  });

  test("every app reader sees every document and option; no app access sees nothing", async ({ bobApi, page }) => {
    const aliceExpenses = (await page.request.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];
    const bobExpenses = (await bobApi.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];

    // Bob (app author) sees Alice's documents too — no per-document readers (ADR-0026).
    expect(aliceExpenses.map((doc) => doc.payload.description)).toContain("Stationery");
    expect(bobExpenses.map((doc) => doc.payload.description).sort()).toEqual(
      aliceExpenses.map((doc) => doc.payload.description).sort()
    );

    const bobOptions = await bobApi.get("/api/apps/expense/forms/expense/options").then((r) => r.json());
    const vendorLabels = (bobOptions.vendorId ?? []).map((option: { label: string }) => option.label);
    expect(vendorLabels.length).toBeGreaterThan(0);

    // Remove bob from the app ACL: every read path refuses at the app gate.
    const stationery = aliceExpenses.find((doc) => doc.payload.description === "Stationery")!;
    await setExpenseAccess(page);
    const id = encodeURIComponent(stationery._id);
    for (const path of [
      "/api/apps/expense/documents?docType=expense",
      "/api/apps/expense/forms/expense/options",
      `/api/apps/expense/documents/${id}`,
      `/api/apps/expense/documents/${id}/formulas`,
      "/api/apps/expense/audit",
      "/api/apps/expense/conflicts"
    ]) {
      const refused = await bobApi.get(path);
      expect(refused.status(), path).toBe(403);
    }
  });

  test("payload edits enforce the two-layer authorship gate", async ({ bobApi, page, localCouchUrl }) => {
    // Layer 1 — app-level Editor+ ACL bypass (ADR-0024). Alice is a Manager on the
    // expense app (via group:finance), so she may edit a document she did NOT author
    // (Client dinner is authored by person:bob). Pre-0024 this was a 403.
    const aliceExpenses = (await page.request.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];
    const clientDinner = aliceExpenses.find((doc) => doc.payload.description === "Client dinner");
    expect(clientDinner).toBeTruthy();
    expect(clientDinner!.authors).not.toContain("person:alice");

    const managerEdit = await page.request.put(`/api/apps/expense/documents/${encodeURIComponent(clientDinner!._id)}`, {
      data: { payload: { ...clientDinner!.payload, description: "Manager edit" } }
    });
    expect(managerEdit.status()).toBe(200);

    // Layer 2 — group/role-aware Authors intersection (ADR-0024). Bob is app-level
    // `author` (below Editor), so with no ACL bypass he may edit only documents whose
    // Authors field intersects his principals. Seed a doc bob can read (every app
    // reader can, ADR-0026) but does NOT author (authors=[person:alice]).
    const foreignId = "doc:expense:acl-layer2-fixture";
    const seed = await page.request.put(`${localCouchUrl}/expense_app/${encodeURIComponent(foreignId)}`, {
      headers: couchAuth,
      data: {
        _id: foreignId,
        kind: "document",
        appId: "expense",
        docType: "expense",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: "person:alice",
        updatedBy: "person:alice",
        authors: ["person:alice"],
        payload: { ...clientDinner!.payload, description: "Finance shared" }
      }
    });
    expect(seed.ok()).toBeTruthy();

    const refused = await bobApi.put(`/api/apps/expense/documents/${encodeURIComponent(foreignId)}`, {
      data: { payload: { description: "Bob edit" } }
    });
    expect(refused.status()).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("not editable");

    // ADR-0026: a Reader never edits, even a document whose Authors lists them.
    // Client dinner is authored by bob; demote him to reader and both writes refuse.
    await setExpenseAccess(page, "reader");
    const dinnerId = encodeURIComponent(clientDinner!._id);
    const readerEdit = await bobApi.put(`/api/apps/expense/documents/${dinnerId}`, {
      data: { payload: { ...clientDinner!.payload, description: "Reader edit" } }
    });
    expect(readerEdit.status()).toBe(403);
    expect(JSON.stringify(await readerEdit.json())).toContain("author access is required");
    expect((await bobApi.delete(`/api/apps/expense/documents/${dinnerId}`)).status()).toBe(403);
  });

  test("workflow transitions require app access before role checks", async ({ bobApi, page }) => {
    const aliceExpenses = (await page.request.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];
    const stationery = aliceExpenses.find((doc) => doc.payload.description === "Stationery");
    expect(stationery).toBeTruthy();

    await setExpenseAccess(page);
    const refused = await bobApi.post(`/api/apps/expense/documents/${encodeURIComponent(stationery!._id)}/transition`, {
      data: { transition: "submit" }
    });

    expect(refused.status()).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("reader access is required");
  });

  test("revoking app access is enforced at the API gate; sync never purges per document", async ({ bobApi, page, localCouchUrl }) => {
    const bobExpenses = (await bobApi.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];
    const visible = bobExpenses.find((doc) => doc.payload.description === "Client dinner");
    expect(visible).toBeTruthy();

    // A reader's sync replicates and reconciles; there is no per-document purge (ADR-0026).
    const sync = await bobApi.post("/api/apps/expense/replicate");
    expect(sync.ok()).toBeTruthy();
    const syncBody = await sync.json();
    expect(syncBody).not.toHaveProperty("purge");
    expect(syncBody.pull).toHaveProperty("business");

    // The per-document revocation route is gone.
    const revoke = await page.request.post("/api/admin/revoke-reader", {
      data: { id: visible!._id, readers: ["person:bob"] }
    });
    expect(revoke.status()).toBe(404);

    // Revocation is an app ACL change: bob is refused everywhere, documents untouched.
    await setExpenseAccess(page);
    expect((await bobApi.post("/api/apps/expense/replicate")).status()).toBe(403);
    expect((await bobApi.get("/api/apps/expense/documents?docType=expense")).status()).toBe(403);
    const localDoc = await page.request.get(`${localCouchUrl}/expense_app/${encodeURIComponent(visible!._id)}`, {
      headers: couchAuth
    });
    expect(localDoc.ok()).toBeTruthy();
  });
});
