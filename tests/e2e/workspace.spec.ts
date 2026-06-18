import { test, expect } from "./support/fixtures";

test.describe("app workspace shell", () => {
  test("runtime left pane lists views, create actions, and opens designer in a new tab", async ({ app, page }) => {
    await app.goto();

    await expect(page.getByTestId("runtime-workspace")).toBeVisible();
    await expect(page.getByTestId("runtime-sidebar")).toBeVisible();
    await expect(page.getByTestId("view-tab-view:my-expenses")).toBeVisible();
    await expect(page.getByTestId("view-tab-view:all-expenses")).toBeVisible();
    await expect(page.getByTestId("new-doc-expense")).toBeVisible();
    await expect(page.getByTestId("new-doc-vendor")).toBeVisible();

    await page.getByTestId("new-doc-vendor").click();
    await expect(page.getByTestId("document-form").getByRole("heading", { name: "Vendor" })).toBeVisible();

    const popupPromise = page.waitForEvent("popup");
    await page.getByTestId("open-designer").click();
    const designer = await popupPromise;
    await designer.waitForLoadState("domcontentloaded");
    await expect(designer).toHaveURL(/\/expense\.nsf\/designer/);
    await designer.close();
  });

  test("document rows expose a new-tab document link", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:all-expenses");

    const firstRow = app.documentRows().first();
    const docId = await firstRow.getAttribute("data-doc-id");
    const openLink = firstRow.getByTestId("doc-open-new-tab");

    await expect(openLink).toHaveAttribute("target", "_blank");
    await expect(openLink).toHaveAttribute("href", new RegExp(`/expense\\.nsf/documents/${encodeURIComponent(docId ?? "")}$`));
  });

  test("designer left pane edits forms and views on designer routes", async ({ app, page }) => {
    await app.gotoDesigner("/expense.nsf/designer/views/all-expenses");

    await expect(page.getByTestId("designer-workspace")).toBeVisible();
    await expect(page.getByTestId("designer-sidebar")).toBeVisible();
    await expect(page.getByTestId("designer-nav-form:expense")).toBeVisible();
    await expect(page.getByTestId("designer-nav-view:all-expenses")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("definition-json")).toHaveValue(/view:all-expenses/);

    await page.getByTestId("designer-nav-form:expense").click();
    await expect(page).toHaveURL(/\/expense\.nsf\/designer\/forms\/expense$/);
    await expect(page.getByTestId("definition-json")).toHaveValue(/form:expense/);
  });

  test("legacy design routes normalize into designer routes", async ({ app, page }) => {
    await app.gotoDesigner("/expense.nsf/design/forms/expense");

    await expect(page).toHaveURL(/\/expense\.nsf\/designer\/forms\/expense$/);
    await expect(page.getByTestId("designer-workspace")).toBeVisible();
    await expect(page.getByTestId("designer-nav-form:expense")).toHaveAttribute("data-active", "true");
  });
});
