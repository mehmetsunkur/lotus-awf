import { test, expect } from "./support/fixtures";

test.describe("setup.nsf system app", () => {
  test("catalog shows setup.nsf and admins can open the directory console", async ({ page }) => {
    await page.goto("/catalog.nsf");

    await expect(page.getByTestId("system-app-setup")).toBeVisible();
    await expect(page.getByTestId("open-setup")).toBeVisible();

    await page.getByTestId("open-setup").click();
    await expect(page).toHaveURL(/\/setup\.nsf/);
    await expect(page.getByTestId("setup-directory")).toBeVisible();
    await expect(page.getByTestId("person-row-alice")).toBeVisible();
    await expect(page.getByTestId("group-row-admins")).toBeVisible();
  });

  test("admins manage people, passwords, groups, and active sessions", async ({ page, playwright }) => {
    await page.goto("/setup.nsf");
    await expect(page.getByTestId("setup-directory")).toBeVisible();

    await page.getByTestId("person-new-username").fill("charlie");
    await page.getByTestId("person-new-display").fill("Charlie Auditor");
    await page.getByTestId("person-new-password").fill("password123");
    await page.getByTestId("person-create").click();
    await expect(page.getByTestId("message")).toHaveText("Create person complete.");
    await expect(page.getByTestId("person-row-charlie")).toBeVisible();
    await expect(page.getByTestId("person-row-charlie")).not.toContainText("passwordHash");

    const charlieApi = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    const charlieLogin = await charlieApi.post("/api/session/login", {
      data: { username: "charlie", password: "password123" }
    });
    expect(charlieLogin.ok()).toBeTruthy();
    const forbidden = await charlieApi.get("/api/setup/directory");
    expect(forbidden.status()).toBe(403);
    await charlieApi.dispose();

    await page.getByTestId("person-display-charlie").fill("Charlie Directory");
    await page.getByTestId("person-save-charlie").click();
    await expect(page.getByTestId("person-row-charlie")).toContainText("Charlie Directory");

    await page.getByTestId("person-password-charlie").fill("newpass123");
    await page.getByTestId("person-reset-charlie").click();
    const resetApi = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    expect((await resetApi.post("/api/session/login", { data: { username: "charlie", password: "password123" } })).status()).toBe(401);
    expect((await resetApi.post("/api/session/login", { data: { username: "charlie", password: "newpass123" } })).ok()).toBeTruthy();
    await resetApi.dispose();

    await page.getByTestId("group-new-slug").fill("auditors");
    await page.getByTestId("group-new-name").fill("Auditors");
    await page.getByTestId("group-create").click();
    await expect(page.getByTestId("group-row-auditors")).toBeVisible();
    await page.getByTestId("group-member-auditors-charlie").check();
    await page.getByTestId("group-save-auditors").click();
    await expect(page.getByTestId("group-member-auditors-charlie")).toBeChecked();

    await page.getByTestId("person-deactivate-charlie").click();
    await expect(page.getByTestId("message")).toHaveText("Save person complete.");
    const inactiveApi = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    expect((await inactiveApi.post("/api/session/login", { data: { username: "charlie", password: "newpass123" } })).status()).toBe(401);
    await inactiveApi.dispose();
  });

  test("directory APIs prevent last active admin lockout", async ({ page }) => {
    await page.goto("/setup.nsf");
    await expect(page.getByTestId("setup-directory")).toBeVisible();

    await page.getByTestId("group-member-admins-alice").uncheck();
    await page.getByTestId("group-save-admins").click();
    await expect(page.getByTestId("message")).toContainText("At least one active admin is required");

    await page.getByTestId("person-deactivate-alice").click();
    await expect(page.getByTestId("message")).toContainText("At least one active admin is required");
  });
});
