import { test, expect } from "./support/fixtures";

/**
 * M3 workflow runtime. The seeded "Stationery" expense has no `state`, so it
 * exercises the initialState back-compat default; the e2e server runs as
 * user:alice (role:finance), so finance-gated transitions are offered.
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

    // user:alice holds role:finance, so the approve action is offered.
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
});
