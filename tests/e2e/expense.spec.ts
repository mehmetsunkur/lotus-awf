import { test, expect } from "./support/fixtures";

test.describe("expense documents", () => {
  test("creates a valid expense and shows it in the list", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:all-expenses");

    const before = await app.documentCount();
    await app.newDocument();
    await app.fillField("description", "E2E lunch");
    await app.fillField("amount", "48.75");
    // category defaults to "travel"; that is enough to satisfy required fields.

    await expect(page.getByTestId("form-save")).toBeEnabled();
    await app.save();

    await expect(page).toHaveURL(/\/expense\.nsf\/documents\/doc%3Aexpense%3A/);
    await app.openView("view:all-expenses");
    await expect(page.getByText("E2E lunch")).toBeVisible();
    await expect(page.getByTestId("document-count")).toHaveText(String(before + 1));
  });

  test("blocks save and surfaces the amount rule when amount is not positive", async ({ app, page }) => {
    await app.goto();
    await app.newDocument();

    // A brand-new expense has an empty description and a zero amount, so it is invalid.
    await expect(page.getByTestId("form-errors")).toBeVisible();
    await expect(page.getByTestId("form-save")).toBeDisabled();

    await app.fillField("description", "Bad expense");
    await app.fillField("amount", "0");
    await expect(page.getByTestId("form-error-amount")).toHaveText("Amount must be greater than zero");
    await expect(page.getByTestId("form-save")).toBeDisabled();

    // Fixing the amount clears the error and re-enables save.
    await app.fillField("amount", "12");
    await expect(page.getByTestId("form-errors")).toBeHidden();
    await expect(page.getByTestId("form-save")).toBeEnabled();
  });

  test("the vendor select is sourced from local vendor documents", async ({ app, page }) => {
    await app.goto();
    await app.newDocument();

    const vendorSelect = page.getByTestId("field-vendorId");
    await expect(vendorSelect.getByRole("option", { name: "National Rail" })).toBeAttached();
    await expect(vendorSelect.getByRole("option", { name: "Paper Market" })).toBeAttached();
  });
});
