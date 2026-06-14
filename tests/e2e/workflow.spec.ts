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
});
