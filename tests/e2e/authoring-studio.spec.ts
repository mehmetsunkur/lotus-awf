import { test, expect } from "./support/fixtures";

test.describe("authoring studio", () => {
  test("adds a form field through structured controls and the runtime renders it", async ({ app, page }) => {
    await app.gotoDesigner();

    await page.getByTestId("definition-select").selectOption("form:expense");
    // The selection navigates the designer route; let its refresh cascade settle
    // before editing, else a trailing refresh reloads definitions and discards
    // the in-progress structured edits.
    await app.settle();
    await page.getByTestId("studio-form-add-field").click();

    const lastField = page.getByTestId("studio-form-field").last();
    await lastField.getByLabel("Field name").fill("projectCode");
    await lastField.getByLabel("Field label").fill("Project Code");
    await page.getByTestId("definition-save").click();
    await expect(app.message()).toHaveText("Save local definition complete.");

    await app.goto();
    await expect(page.getByTestId("field-projectCode")).toBeVisible();
  });

  test("adds a view column through structured controls and the table updates", async ({ app, page }) => {
    await app.gotoDesigner();

    await page.getByTestId("definition-select").selectOption("view:all-expenses");
    await app.settle();
    await page.getByTestId("studio-view-add-column").click();

    const lastColumn = page.getByTestId("studio-view-column").last();
    await lastColumn.getByLabel("Column field").fill("payload.projectCode");
    await lastColumn.getByLabel("Column label").fill("Project");
    await page.getByTestId("definition-save").click();
    await expect(app.message()).toHaveText("Save local definition complete.");

    await app.goto();
    await app.openView("view:all-expenses");
    await expect(page.getByTestId("document-table").locator("th", { hasText: "Project" })).toBeVisible();
  });

  test("edits a workflow transition label through structured controls", async ({ app, page }) => {
    await app.gotoDesigner();

    await page.getByTestId("definition-select").selectOption("workflow:expense");
    await app.settle();
    await page.getByTestId("studio-workflow-transition-label-0").fill("Send for approval");
    await page.getByTestId("definition-save").click();
    await expect(app.message()).toHaveText("Save local definition complete.");

    await app.goto();
    await app.openView("view:all-expenses");
    await app.documentRows().filter({ hasText: "Stationery" }).click();
    await expect(page.getByTestId("workflow-action-submit")).toContainText("Send for approval");
  });

  test("rejects invalid definitions before local writes and at the API", async ({ app, page }) => {
    await app.gotoDesigner();

    await page.getByTestId("definition-select").selectOption("form:expense");
    await app.settle();
    await page.getByTestId("studio-form-field-name-0").fill("");
    await page.getByTestId("definition-save").click();
    await expect(page.getByTestId("definition-error")).toContainText("Field name is required");

    const definitions = await page.request.get("/api/definitions").then((response) => response.json());
    const invalidView = {
      ...definitions.views.find((view: { _id: string }) => view._id === "view:all-expenses"),
      columns: []
    };
    const refused = await page.request.put("/api/definitions/view%3Aall-expenses", { data: invalidView });
    expect(refused.status()).toBe(422);
    expect(JSON.stringify(await refused.json())).toContain("A view needs at least one column");
  });
});
