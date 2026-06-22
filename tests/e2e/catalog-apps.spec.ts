import { test, expect } from "./support/fixtures";

test.describe("catalog-created apps", () => {
  test("creates, opens, uses, and exports a business app", async ({ page }) => {
    await page.goto("/catalog.nsf/views/installed-apps");

    await page.getByTestId("create-app-id").fill("field-reports");
    await page.getByTestId("create-app-title").fill("Field Reports");
    await page.getByTestId("create-app-doc-type").fill("report");
    await page.getByTestId("create-app-doc-title").fill("Report");
    await page.getByTestId("create-app-submit").click();

    await expect(page).toHaveURL(/\/field-reports\.nsf$/);
    await expect(page.getByTestId("runtime-workspace")).toBeVisible();
    await expect(page.getByTestId("view-tab-view:report")).toBeVisible();
    await expect(page.getByTestId("new-doc-report")).toBeVisible();

    await page.getByTestId("new-doc-report").click();
    await expect(page.getByTestId("create-workspace")).toBeVisible();
    await page.getByTestId("field-title").fill("North pump station");
    await page.getByTestId("form-save").click();
    await expect(page).toHaveURL(/\/field-reports\.nsf\/documents\/doc%3Areport%3A/);

    await page.getByTestId("view-tab-view:report").click();
    await page.getByTestId("status-refresh").click();
    await expect(page.getByText("North pump station")).toBeVisible();

    await page.goto("/field-reports.nsf/designer");
    await expect(page.getByTestId("designer-workspace")).toBeVisible();
    await page.getByTestId("new-type-doctype").fill("inspection");
    await page.getByTestId("new-type-title").fill("Inspection");
    await page.getByTestId("new-type-create").click();

    await page.goto("/field-reports.nsf/views/inspection");
    await expect(page.getByTestId("view-tab-view:inspection")).toBeVisible();
    await page.getByTestId("new-doc-inspection").click();
    await page.getByTestId("field-title").fill("Valve inspection");
    await page.getByTestId("form-save").click();
    await expect(page).toHaveURL(/\/field-reports\.nsf\/documents\/doc%3Ainspection%3A/);

    const template = await page.request
      .post("/api/apps/field-reports/templates/export", { data: { version: "vtest", source: "e2e" } })
      .then((response) => response.json());
    expect(template.appId).toBe("field-reports");
    const ids = template.definitions.map((definition: { _id: string }) => definition._id);
    expect(ids).toEqual(expect.arrayContaining(["app:config", "acl:rules", "audit:policy", "form:report", "view:report", "form:inspection", "view:inspection"]));
    expect(template.definitions.some((definition: { kind: string }) => definition.kind === "document")).toBe(false);

    await page.goto("/catalog.nsf/views/installed-apps");
    await expect(page.getByTestId("installed-app-field-reports")).toBeVisible();
    await page.getByTestId("open-app-field-reports").click();
    await expect(page).toHaveURL(/\/field-reports\.nsf$/);
  });

  test("rejects invalid and duplicate app ids", async ({ page }) => {
    const invalid = await page.request.post("/api/platform/apps", {
      data: { appId: "setup", title: "Setup Clone", docType: "thing", docTypeTitle: "Thing" }
    });
    expect(invalid.status()).toBe(422);

    const created = await page.request.post("/api/platform/apps", {
      data: { appId: "work-orders", title: "Work Orders", docType: "order", docTypeTitle: "Order" }
    });
    expect(created.status()).toBe(201);

    const duplicate = await page.request.post("/api/platform/apps", {
      data: { appId: "work-orders", title: "Work Orders", docType: "order", docTypeTitle: "Order" }
    });
    expect(duplicate.status()).toBe(409);
  });
});
