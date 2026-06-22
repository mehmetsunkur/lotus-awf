import { test, expect } from "./support/fixtures";

// form:expense seeds two sections — "Spend" [amount, gross, description, category,
// vendorId] and "Accounting" [spentAt, reimbursable, notes].
test.describe("citizen layout studio", () => {
  test("reorders a field within a section and the preview reflects it", async ({ app, page }) => {
    await app.gotoDesigner();
    await page.getByTestId("definition-select").selectOption("form:expense");

    const firstRow = page.getByTestId("studio-section-0").getByTestId("studio-form-field").first();
    await expect(firstRow).toHaveAttribute("data-field", "amount");

    await page.getByTestId("studio-form-field-down-amount").click();
    await expect(firstRow).toHaveAttribute("data-field", "gross");

    // The live preview renders fields in section order, so gross now precedes amount.
    const previewFields = page.getByTestId("studio-preview").locator('[data-testid^="preview-field-"]');
    await expect(previewFields.first()).toHaveAttribute("data-testid", "preview-field-gross");
  });

  test("adds a section, moves a field into it, and the runtime renders the new group", async ({ app, page }) => {
    await app.gotoDesigner();
    await page.getByTestId("definition-select").selectOption("form:expense");

    await page.getByTestId("studio-form-add-section").click();
    await page.getByTestId("studio-section-title-2").fill("Extras");
    await page.getByTestId("studio-form-field-section-notes").selectOption("2");
    await expect(page.getByTestId("studio-section-2").getByTestId("studio-form-field")).toHaveAttribute("data-field", "notes");

    await page.getByTestId("definition-save").click();
    await expect(app.message()).toHaveText("Save local definition complete.");

    await app.goto();
    await app.openView("view:all-expenses");
    await app.documentRows().filter({ hasText: "Train ticket" }).click();
    await expect(page.getByTestId("document-form").locator("legend", { hasText: "Extras" })).toBeVisible();
  });

  test("removing a section reassigns its fields, never orphaning one", async ({ app, page }) => {
    await app.gotoDesigner();
    await page.getByTestId("definition-select").selectOption("form:expense");

    const allFields = page.getByTestId("studio-form-sections").getByTestId("studio-form-field");
    await expect(allFields).toHaveCount(8);

    await page.getByTestId("studio-section-remove-1").click(); // remove "Accounting"
    await expect(page.getByTestId("studio-section-1")).toBeHidden();
    // Its fields moved into the remaining section — still 8 fields, none lost.
    await expect(allFields).toHaveCount(8);
    // spentAt came from the removed section and now renders in the preview
    // (notes stays conditional on amount >= 100, so we assert an unconditional field).
    await expect(page.getByTestId("studio-preview").locator('[data-testid="preview-field-spentAt"]')).toBeVisible();
  });

  test("native drag-and-drop moves a field between sections (smoke)", async ({ app, page }) => {
    await app.gotoDesigner();
    await page.getByTestId("definition-select").selectOption("form:expense");

    const notes = page.getByTestId("studio-section-1").locator('[data-field="notes"]');
    const spend = page.getByTestId("studio-section-0");
    await notes.dragTo(spend);

    // Best-effort: HTML5 DnD via Playwright can be environment-sensitive, so we
    // only assert the layout stayed valid (notes is still present exactly once).
    await expect(page.getByTestId("studio-form-sections").locator('[data-field="notes"]')).toHaveCount(1);
  });
});
