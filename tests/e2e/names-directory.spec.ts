import { test, expect } from "./support/fixtures";

test.describe("names.nsf system app", () => {
  test("catalog.nsf uses the standard workspace shell and routed sections", async ({ page }) => {
    await page.goto("/catalog.nsf");

    await expect(page).toHaveURL(/\/catalog\.nsf\/views\/system-apps$/);
    await expect(page.getByTestId("catalog-shell")).toBeVisible();
    await expect(page.getByTestId("runtime-workspace")).toBeVisible();
    await expect(page.getByTestId("runtime-sidebar")).toBeVisible();
    await expect(page.getByTestId("system-apps")).toBeVisible();

    await page.getByTestId("view-tab-view:sample-templates").click();
    await expect(page).toHaveURL(/\/catalog\.nsf\/views\/sample-templates$/);
    await expect(page.getByTestId("available-templates")).toBeVisible();
  });

  test("catalog shows names.nsf and admins can open the directory console", async ({ page }) => {
    await page.goto("/catalog.nsf");

    await expect(page.getByTestId("system-app-names")).toBeVisible();
    await expect(page.getByTestId("open-names")).toBeVisible();

    await page.getByTestId("open-names").click();
    await expect(page).toHaveURL(/\/names\.nsf\/views\/people$/);
    await expect(page.getByTestId("names-directory")).toBeVisible();
    await expect(page.getByTestId("runtime-workspace")).toBeVisible();
    await expect(page.getByTestId("runtime-sidebar")).toBeVisible();
    await expect(page.getByTestId("person-row-alice")).toBeVisible();
    await page.getByTestId("view-tab-view:groups").click();
    await expect(page.getByTestId("group-row-admins")).toBeVisible();
  });

  test("admins manage people, passwords, groups, and active sessions", async ({ page, playwright, apiBaseURL, app }) => {
    await page.goto("/names.nsf");
    await expect(page.getByTestId("names-directory")).toBeVisible();
    // The directory console issues the same background refresh cascade as the
    // runtime; settle before/between edits so a trailing refresh doesn't reset a
    // field mid-fill or land before a save's effect persists.
    await app.settle();

    await page.getByTestId("person-new-username").fill("charlie");
    await page.getByTestId("person-new-display").fill("Charlie Auditor");
    await page.getByTestId("person-new-password").fill("password123");
    await page.getByTestId("person-create").click();
    await expect(page.getByTestId("message")).toHaveText("Create person complete.");
    await expect(page.getByTestId("person-row-charlie")).toBeVisible();
    await expect(page.getByTestId("person-row-charlie")).not.toContainText("passwordHash");

    const charlieApi = await playwright.request.newContext({ baseURL: apiBaseURL });
    const charlieLogin = await charlieApi.post("/api/session/login", {
      data: { username: "charlie", password: "password123" }
    });
    expect(charlieLogin.ok()).toBeTruthy();
    const forbidden = await charlieApi.get("/api/names/directory");
    expect(forbidden.status()).toBe(403);
    await charlieApi.dispose();

    await app.settle();
    await page.getByTestId("person-display-charlie").fill("Charlie Directory");
    await page.getByTestId("person-save-charlie").click();
    await expect(page.getByTestId("person-row-charlie")).toContainText("Charlie Directory");

    await app.settle();
    await page.getByTestId("person-password-charlie").fill("newpass123");
    await page.getByTestId("person-reset-charlie").click();
    // Wait for the password reset to persist before probing login — otherwise the
    // old-password check races the write and still succeeds.
    await app.settle();
    const resetApi = await playwright.request.newContext({ baseURL: apiBaseURL });
    expect((await resetApi.post("/api/session/login", { data: { username: "charlie", password: "password123" } })).status()).toBe(401);
    expect((await resetApi.post("/api/session/login", { data: { username: "charlie", password: "newpass123" } })).ok()).toBeTruthy();
    await resetApi.dispose();

    await page.getByTestId("view-tab-view:groups").click();
    await app.settle();
    await page.getByTestId("group-new-slug").fill("auditors");
    await page.getByTestId("group-new-name").fill("Auditors");
    await page.getByTestId("group-create").click();
    await expect(page.getByTestId("group-row-auditors")).toBeVisible();
    await page.getByTestId("group-member-auditors-charlie").check();
    await page.getByTestId("group-save-auditors").click();
    await expect(page.getByTestId("group-member-auditors-charlie")).toBeChecked();

    await page.getByTestId("view-tab-view:people").click();
    await app.settle();
    await page.getByTestId("person-deactivate-charlie").click();
    await expect(page.getByTestId("message")).toHaveText("Save person complete.");
    await app.settle();
    const inactiveApi = await playwright.request.newContext({ baseURL: apiBaseURL });
    expect((await inactiveApi.post("/api/session/login", { data: { username: "charlie", password: "newpass123" } })).status()).toBe(401);
    await inactiveApi.dispose();
  });

  test("directory APIs prevent last active admin lockout", async ({ page }) => {
    await page.goto("/names.nsf");
    await expect(page.getByTestId("names-directory")).toBeVisible();

    await page.getByTestId("view-tab-view:groups").click();
    await page.getByTestId("group-member-admins-alice").uncheck();
    await page.getByTestId("group-save-admins").click();
    await expect(page.getByTestId("message")).toContainText("At least one active admin is required");

    await page.getByTestId("view-tab-view:people").click();
    await page.getByTestId("person-deactivate-alice").click();
    await expect(page.getByTestId("message")).toContainText("At least one active admin is required");
  });
});
