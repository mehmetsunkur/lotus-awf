import { test, expect } from "./support/fixtures";

test.describe("create a document type", () => {
  test("scaffolds a new type, surfaces its view, and creates a document of it", async ({ app, page }) => {
    await app.gotoDesigner();

    await page.getByTestId("new-type-doctype").fill("invoice");
    await page.getByTestId("new-type-title").fill("Invoice");
    await page.getByTestId("new-type-create").click();

    // The scaffolded list view appears in the runtime picker.
    await app.goto();
    await expect(page.getByTestId("view-tab-view:invoice")).toBeVisible();

    await app.openView("view:invoice");
    await expect(app.documentRows()).toHaveCount(0);

    // The scaffolded form has a Title field; a document of the new type lists.
    await app.newDocument("invoice");
    await app.fillField("title", "First invoice");
    await app.save();
    await expect(page).toHaveURL(/\/expense\.nsf\/documents\/doc%3Ainvoice%3A/);
    await app.openView("view:invoice");
    await expect(page.getByText("First invoice")).toBeVisible();
    await expect(page.getByTestId("document-count")).toHaveText("1");
  });

  test("rejects a duplicate type (409) and an invalid slug (422)", async ({ page }) => {
    const duplicate = await page.request.post("/api/document-types", { data: { docType: "expense", title: "Expense" } });
    expect(duplicate.status()).toBe(409);

    const badSlug = await page.request.post("/api/document-types", { data: { docType: "Bad Slug!", title: "Nope" } });
    expect(badSlug.status()).toBe(422);
    expect(JSON.stringify(await badSlug.json())).toContain("docType");
  });

  test("the scaffolded definitions promote via the template artifact", async ({ page }) => {
    await page.request.post("/api/document-types", { data: { docType: "invoice", title: "Invoice" } });
    const template = await page.request.post("/api/templates/export", { data: { version: "vtest", source: "e2e" } }).then((r) => r.json());
    const ids = template.definitions.map((definition: { _id: string }) => definition._id);
    expect(ids).toContain("form:invoice");
    expect(ids).toContain("view:invoice");
  });
});
