import { test, expect } from "./support/fixtures";

test.describe("runtime shell", () => {
  test("loads the seeded runtime with both replicas online", async ({ app, page }) => {
    await app.goto();

    await expect(page.getByRole("heading", { name: "Lotus Notes" })).toBeVisible();
    await expect(page.getByTestId("status-local")).toHaveAttribute("data-online", "true");
    await expect(page.getByTestId("status-server")).toHaveAttribute("data-online", "true");

    // Seeded views are rendered as tabs.
    await expect(page.getByTestId("view-tab-view:my-expenses")).toBeVisible();
    await expect(page.getByTestId("view-tab-view:all-expenses")).toBeVisible();
    await expect(page.getByTestId("view-tab-view:vendors")).toBeVisible();
  });

  test("switching to the vendors view shows the vendor form and rows", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:vendors");

    // Form switches to the vendor definition immediately.
    await expect(page.getByTestId("document-form").getByRole("heading", { name: "Vendor" })).toBeVisible();

    // Seeded vendors are listed.
    await expect(app.documentRows()).toHaveCount(2);
    await expect(page.getByText("National Rail")).toBeVisible();
    await expect(page.getByText("Paper Market")).toBeVisible();
  });
});
