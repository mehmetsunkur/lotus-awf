import { test, expect } from "./support/fixtures";

const couchAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };

type Doc = {
  _id: string;
  _rev?: string;
  readers: string[];
  authors: string[];
  payload: Record<string, unknown>;
};

test.describe("ACL scoped runtime", () => {
  test("lists and select options are scoped by current user principals", async ({ bobApi, page }) => {
    const aliceExpenses = (await page.request.get("/api/documents?docType=expense").then((r) => r.json())) as Doc[];
    const bobExpenses = (await bobApi.get("/api/documents?docType=expense").then((r) => r.json())) as Doc[];

    expect(aliceExpenses.map((doc) => doc.payload.description)).toContain("Stationery");
    expect(bobExpenses.map((doc) => doc.payload.description)).not.toContain("Stationery");
    expect(bobExpenses.map((doc) => doc.payload.description)).toContain("Client dinner");

    const bobOptions = await bobApi.get("/api/forms/expense/options").then((r) => r.json());
    const vendorLabels = (bobOptions.vendorId ?? []).map((option: { label: string }) => option.label);
    expect(vendorLabels).toEqual([]);
  });

  test("payload edits require authorship", async ({ bobApi, page }) => {
    const bobExpenses = (await bobApi.get("/api/documents?docType=expense").then((r) => r.json())) as Doc[];
    const financeVisibleBobDoc = bobExpenses.find((doc) => doc.payload.description === "Client dinner");
    expect(financeVisibleBobDoc).toBeTruthy();

    const refused = await page.request.put(`/api/documents/${encodeURIComponent(financeVisibleBobDoc!._id)}`, {
      data: { payload: { ...financeVisibleBobDoc!.payload, description: "Finance edit" } }
    });

    expect(refused.status()).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("not editable");
  });

  test("workflow transitions require read access before role checks", async ({ bobApi, page }) => {
    const aliceExpenses = (await page.request.get("/api/documents?docType=expense").then((r) => r.json())) as Doc[];
    const aliceOnly = aliceExpenses.find((doc) => doc.payload.description === "Stationery");
    expect(aliceOnly).toBeTruthy();

    const refused = await bobApi.post(`/api/documents/${encodeURIComponent(aliceOnly!._id)}/transition`, {
      data: { transition: "submit" }
    });

    expect(refused.status()).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("not readable");
  });

  test("revocation purge removes unauthorized local revisions without deleting the server document", async ({ bobApi, page }) => {
    const bobExpenses = (await bobApi.get("/api/documents?docType=expense").then((r) => r.json())) as Doc[];
    const visible = bobExpenses.find((doc) => doc.payload.description === "Client dinner");
    expect(visible).toBeTruthy();

    // Reset seeds local and server independently; sync first so the exact local
    // revision Bob can see also exists on the server for revocation.
    await page.request.post("/api/replicate");

    const revoke = await page.request.post("/api/admin/revoke-reader", {
      data: { id: visible!._id, readers: ["person:bob"] }
    });
    expect(revoke.ok()).toBeTruthy();

    const sync = await bobApi.post("/api/replicate");
    expect(sync.ok()).toBeTruthy();
    const syncBody = await sync.json();
    expect(syncBody.purge.purged).toContain(visible!._id);

    const afterBob = (await bobApi.get("/api/documents?docType=expense").then((r) => r.json())) as Doc[];
    expect(afterBob.map((doc) => doc._id)).not.toContain(visible!._id);

    const localDoc = await page.request.get(`http://localhost:5985/expense_app/${encodeURIComponent(visible!._id)}`, {
      headers: couchAuth
    });
    expect(localDoc.status()).toBe(404);

    const serverDoc = await page.request.get(`http://localhost:5984/expense_app/${encodeURIComponent(visible!._id)}`, {
      headers: couchAuth
    });
    expect(serverDoc.ok()).toBeTruthy();
    const serverBody = (await serverDoc.json()) as Doc;
    expect(serverBody.payload.description).toBe("Client dinner");
    expect(serverBody.readers).not.toContain("person:bob");
  });
});
