import { test, expect } from "./support/fixtures";

/**
 * M3 workflow runtime. The seeded "Stationery" expense has no `state`, so it
 * exercises the initialState back-compat default; the e2e server runs as
 * person:alice (group:finance), so finance-gated transitions are offered.
 */
test.describe("workflow lifecycle", () => {
  test.setTimeout(60_000);

  test("a state-less document adopts the workflow initial state", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:all-expenses");

    await app.documentRows().filter({ hasText: "Stationery" }).click();
    await expect(page.getByTestId("workflow-state")).toHaveText("Draft");
  });

  test("advances a draft through submit and approve with history", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:all-expenses");
    await app.documentRows().filter({ hasText: "Stationery" }).click();

    await expect(page.getByTestId("workflow-state")).toHaveText("Draft");

    await page.getByTestId("workflow-action-submit").click();
    await expect(page.getByTestId("workflow-state")).toHaveText("Submitted");

    // person:alice holds group:finance, so the approve action is offered.
    await page.getByTestId("workflow-action-approve").click();
    await expect(page.getByTestId("workflow-state")).toHaveText("Approved");

    // A final state offers no further actions.
    await expect(page.getByTestId("workflow-no-actions")).toBeVisible();

    // History records both transitions.
    const history = page.getByTestId("workflow-history");
    await expect(history).toContainText("draft → submitted");
    await expect(history).toContainText("submitted → approved");
  });

  test("a submitted document appears in the pending approvals worklist", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:all-expenses");
    await app.documentRows().filter({ hasText: "Stationery" }).click();

    await page.getByTestId("workflow-action-submit").click();
    await expect(page.getByTestId("workflow-state")).toHaveText("Submitted");

    await app.openView("view:pending-approvals");
    await expect(app.documentRows().filter({ hasText: "Stationery" })).toBeVisible();
  });

  test("resolving a concurrent transition keeps the human-selected terminal state", async ({ app, page }) => {
    test.setTimeout(90_000);
    await app.goto();

    // Seed an approve-vs-reject conflict on one document.
    const seeded = await page.request.post("/api/demo/state-conflict");
    expect(seeded.ok()).toBeTruthy();

    // Load it into the conflict queue and inspect it.
    await app.refresh();
    const item = page.getByTestId("conflict-item").first();
    await expect(item).toBeVisible({ timeout: 60_000 });
    await item.click();
    await expect(page.getByTestId("conflict-detail")).toBeVisible();

    // Both terminal states are shown; elect the approved revision regardless of
    // which one CouchDB picked as the arbitrary winner.
    const approveButton = page.locator('[data-testid="conflict-detail"] button[data-state="approved"]');
    await expect(approveButton).toBeVisible();
    await approveButton.click();

    // The queue empties and the surviving document is approved, not the rejected loser.
    await expect(page.getByTestId("conflict-empty")).toBeVisible({ timeout: 30_000 });
    await app.openView("view:all-expenses");
    const row = app.documentRows().filter({ hasText: "State conflict" });
    await expect(row.getByTestId("doc-row-state")).toContainText("approved");
  });

  test("role gating refuses a transition the actor's role does not allow", async ({ app, bobApi, page }) => {
    await app.goto();

    // Bob authors and submits an expense he can read; approval is still gated to finance.
    const created = await bobApi.post("/api/documents", {
      data: {
        docType: "expense",
        payload: {
          amount: 55,
          description: "Bob approval check",
          category: "travel",
          spentAt: "2026-06-14"
        }
      }
    });
    expect(created.ok()).toBeTruthy();
    const id: string = (await created.json())._id;
    const path = `/api/documents/${encodeURIComponent(id)}/transition`;
    await bobApi.post(path, { data: { transition: "submit" } });

    // person:bob (group:sales) can read it but cannot approve — the server refuses with 422.
    const refused = await bobApi.post(path, { data: { transition: "approve" } });
    expect(refused.status()).toBe(422);
    expect(JSON.stringify(await refused.json())).toContain("group:finance");

    // person:alice (group:finance) can approve via the default API.
    const allowed = await page.request.post(path, { data: { transition: "approve" } });
    expect(allowed.ok()).toBeTruthy();
    expect((await allowed.json()).state).toBe("approved");
  });

  test("a transition writes only the local replica until an explicit sync", async ({ app, page }) => {
    await app.goto();

    const docs = await page.request.get("/api/documents?docType=expense").then((r) => r.json());
    const id: string = docs.find((d: { payload: { description: string } }) => d.payload.description === "Stationery")._id;

    // Transitioning hits the local stack only — no server CouchDB round-trip.
    await page.request.post(`/api/documents/${encodeURIComponent(id)}/transition`, { data: { transition: "submit" } });

    // Local reflects the new state immediately.
    const local = await page.request.get("/api/documents?docType=expense").then((r) => r.json());
    expect(local.find((d: { _id: string }) => d._id === id).state).toBe("submitted");

    // The server replica is still untouched (proves the transition was offline-capable).
    const serverAuth = { authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` };
    const serverDocUrl = `http://localhost:5984/expense_app/${encodeURIComponent(id)}`;
    const before = await page.request.get(serverDocUrl, { headers: serverAuth }).then((r) => r.json());
    expect(before.state ?? null).toBeNull();

    // Only after an explicit replicate does the server receive the transitioned state.
    await page.request.post("/api/replicate");
    const after = await page.request.get(serverDocUrl, { headers: serverAuth }).then((r) => r.json());
    expect(after.state).toBe("submitted");
  });
});
