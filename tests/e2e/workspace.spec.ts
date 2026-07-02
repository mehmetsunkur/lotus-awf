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
    await expect(page).toHaveURL(/\/expense\.nsf\/new\/vendor$/);
    await expect(page.getByTestId("create-workspace")).toBeVisible();
    await expect(page.getByTestId("document-form").getByRole("heading", { name: "Vendor" })).toBeVisible();
    await expect(page.getByTestId("document-table")).toBeHidden();
    await expect(page.getByTestId("view-search")).toBeHidden();

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

  test("direct document routes open a focused document workspace independent of the current view", async ({ page }) => {
    const vendors = (await page.request.get("/api/apps/expense/documents?docType=vendor").then((response) => response.json())) as Array<{ _id: string }>;
    const vendorId = vendors[0]._id;

    await page.goto(`/expense.nsf/documents/${encodeURIComponent(vendorId)}`);

    await expect(page.getByTestId("runtime-sidebar")).toBeVisible();
    await expect(page.getByTestId("document-workspace")).toBeVisible();
    await expect(page.getByTestId("document-form").getByRole("heading", { name: "Vendor" })).toBeVisible();
    await expect(page.getByTestId("document-table")).toBeHidden();
    await expect(page.getByTestId("view-search")).toBeHidden();
    await expect(page.getByTestId("view-tab-view:my-expenses")).toHaveAttribute("data-active", "false");
  });

  test("saving from a create route opens the created document route", async ({ page }) => {
    await page.goto("/expense.nsf/new/vendor");

    await expect(page.getByTestId("create-workspace")).toBeVisible();
    await page.getByTestId("field-name").fill("Create Route Vendor");
    await page.getByTestId("form-save").click();

    await expect(page).toHaveURL(/\/expense\.nsf\/documents\/doc%3Avendor%3A/);
    await expect(page.getByTestId("document-workspace")).toBeVisible();
    await expect(page.getByTestId("document-form").getByRole("heading", { name: "Vendor" })).toBeVisible();
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

  test("old design routes fall back to the default runtime view", async ({ page }) => {
    await page.goto("/expense.nsf/design/forms/expense");

    // ADR-0015: no expense-specific default — a business app falls back to its
    // first view, which is all-expenses for the expense template.
    await expect(page).toHaveURL(/\/expense\.nsf\/views\/all-expenses$/);
    await expect(page.getByTestId("runtime-workspace")).toBeVisible();
    await expect(page.getByTestId("designer-workspace")).toBeHidden();
  });
});
