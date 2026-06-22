import { test, expect } from "./support/fixtures";

test.describe("vendor documents", () => {
  test("creates a vendor that appears in the vendors view", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:vendors");

    const before = await app.documentCount();
    await app.newDocument("vendor");
    await app.fillField("name", "Acme Tooling");
    // category defaults to "travel"; name is the only required field.
    await app.save();

    await expect(page).toHaveURL(/\/expense\.nsf\/documents\/doc%3Avendor%3A/);
    await app.openView("view:vendors");
    await expect(page.getByText("Acme Tooling")).toBeVisible();
    await expect(page.getByTestId("document-count")).toHaveText(String(before + 1));
  });

  test("enforces the contact email rule from the vendor form definition", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:vendors");
    await app.newDocument("vendor");

    await app.fillField("name", "No At Sign");
    await app.fillField("contactEmail", "not-an-email");
    await expect(page.getByTestId("form-error-contactEmail")).toHaveText("Contact email must include @");
    await expect(page.getByTestId("form-save")).toBeDisabled();

    await app.fillField("contactEmail", "hello@acme.example");
    await expect(page.getByTestId("form-errors")).toBeHidden();
    await expect(page.getByTestId("form-save")).toBeEnabled();
  });
});
