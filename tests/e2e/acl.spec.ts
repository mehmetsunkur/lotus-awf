import { test, expect } from "./support/fixtures";

const couchAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };

type AccessibleApp = { appId: string; title: string; description?: string; accessLevel: string };

type Doc = {
  _id: string;
  _rev?: string;
  readers: string[];
  authors: string[];
  payload: Record<string, unknown>;
};

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

  test("lists and select options are scoped by current user principals", async ({ bobApi, page }) => {
    const aliceExpenses = (await page.request.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];
    const bobExpenses = (await bobApi.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];

    expect(aliceExpenses.map((doc) => doc.payload.description)).toContain("Stationery");
    expect(bobExpenses.map((doc) => doc.payload.description)).not.toContain("Stationery");
    expect(bobExpenses.map((doc) => doc.payload.description)).toContain("Client dinner");

    const bobOptions = await bobApi.get("/api/apps/expense/forms/expense/options").then((r) => r.json());
    const vendorLabels = (bobOptions.vendorId ?? []).map((option: { label: string }) => option.label);
    expect(vendorLabels).toEqual([]);
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
    // Authors field intersects his principals. Seed a doc bob can READ (readers include
    // person:bob) but does NOT author (authors=[person:alice]); his edit must be refused.
    // No standing sample doc fits — every bob-readable seed doc is also bob-authored.
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
        readers: ["person:alice", "person:bob", "group:finance"],
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
  });

  test("workflow transitions require read access before role checks", async ({ bobApi, page }) => {
    const aliceExpenses = (await page.request.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];
    const aliceOnly = aliceExpenses.find((doc) => doc.payload.description === "Stationery");
    expect(aliceOnly).toBeTruthy();

    const refused = await bobApi.post(`/api/apps/expense/documents/${encodeURIComponent(aliceOnly!._id)}/transition`, {
      data: { transition: "submit" }
    });

    expect(refused.status()).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("not readable");
  });

  test("revocation purge removes unauthorized local revisions without deleting the server document", async ({ bobApi, page, localCouchUrl, serverCouchUrl }) => {
    const bobExpenses = (await bobApi.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];
    const visible = bobExpenses.find((doc) => doc.payload.description === "Client dinner");
    expect(visible).toBeTruthy();

    // Reset seeds local and server independently; sync first so the exact local
    // revision Bob can see also exists on the server for revocation.
    await page.request.post("/api/apps/expense/replicate");

    const revoke = await page.request.post("/api/admin/revoke-reader", {
      data: { id: visible!._id, readers: ["person:bob"] }
    });
    expect(revoke.ok()).toBeTruthy();

    const sync = await bobApi.post("/api/apps/expense/replicate");
    expect(sync.ok()).toBeTruthy();
    const syncBody = await sync.json();
    expect(syncBody.purge.purged).toContain(visible!._id);

    const afterBob = (await bobApi.get("/api/apps/expense/documents?docType=expense").then((r) => r.json())) as Doc[];
    expect(afterBob.map((doc) => doc._id)).not.toContain(visible!._id);

    const localDoc = await page.request.get(`${localCouchUrl}/expense_app/${encodeURIComponent(visible!._id)}`, {
      headers: couchAuth
    });
    expect(localDoc.status()).toBe(404);

    const serverDoc = await page.request.get(`${serverCouchUrl}/expense_app/${encodeURIComponent(visible!._id)}`, {
      headers: couchAuth
    });
    expect(serverDoc.ok()).toBeTruthy();
    const serverBody = (await serverDoc.json()) as Doc;
    expect(serverBody.payload.description).toBe("Client dinner");
    expect(serverBody.readers).not.toContain("person:bob");
  });
});
