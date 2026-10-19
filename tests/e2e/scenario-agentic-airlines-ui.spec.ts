import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, RuntimeApp, test } from "./support/fixtures";
import {
  AIRLINE_PASSWORD,
  seedAgenticAirlines,
  type AirlinePersonaName,
  type AirlineScenario
} from "./support/scenario-agentic-airlines";

type PersonaBrowser = {
  app: RuntimeApp;
  context: BrowserContext;
  page: Page;
};

async function openPersona(
  browser: Browser,
  baseURL: string,
  username: AirlinePersonaName
): Promise<PersonaBrowser> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const app = new RuntimeApp(page);

  await page.goto("/login.nsf");
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(AIRLINE_PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/catalog\.nsf/);

  return { app, context, page };
}

async function openBusinessApp(persona: PersonaBrowser, appId: string): Promise<void> {
  await persona.page.goto(`/${appId}.nsf`);
  await persona.app.waitForReady();
}

async function createLeaveRequest(
  persona: PersonaBrowser,
  scenario: AirlineScenario,
  fields: { type: string; from: string; to: string; reason: string }
): Promise<string> {
  await openBusinessApp(persona, scenario.leaveRequestAppId);
  await persona.app.newDocument("leave-request");
  await persona.app.selectOption("type", fields.type);
  await persona.app.fillField("from", fields.from);
  await persona.app.fillField("to", fields.to);
  await persona.app.fillField("reason", fields.reason);
  await expect(persona.page.getByTestId("form-save")).toBeEnabled();
  await persona.app.save();
  await expect(persona.page).toHaveURL(new RegExp(`/${scenario.leaveRequestAppId}\\.nsf/documents/doc%3Aleave-request%3A`));
  await persona.app.settle();
  await expect(persona.page.getByTestId("workflow-state")).toHaveText("Draft");

  return decodeURIComponent(new URL(persona.page.url()).pathname.split("/documents/")[1]);
}

async function submitSelectedRequest(persona: PersonaBrowser): Promise<void> {
  await persona.page.getByTestId("workflow-action-submit").click();
  await expect(persona.page.getByTestId("workflow-state")).toHaveText("Submitted");
  await persona.app.settle();
}

async function openView(persona: PersonaBrowser, scenario: AirlineScenario, viewId: string): Promise<void> {
  await openBusinessApp(persona, scenario.leaveRequestAppId);
  await persona.app.openView(viewId);
}

function rowContaining(page: Page, text: string) {
  return page.getByTestId("doc-row").filter({ hasText: text });
}

test.describe("Agentic Airlines PLC browser stories", () => {
  test.setTimeout(120_000);

  test("Dave submits leave, Carol approves it, and Frank cannot see it", async ({
    browser,
    apiBaseURL,
    page
  }) => {
    const scenario = await seedAgenticAirlines(page.request);
    const contexts: BrowserContext[] = [];
    const persona = async (username: AirlinePersonaName) => {
      const opened = await openPersona(browser, apiBaseURL, username);
      contexts.push(opened.context);
      return opened;
    };

    try {
      const dave = await persona("dave");
      const requestId = await createLeaveRequest(dave, scenario, {
        type: "annual",
        from: "2026-10-12",
        to: "2026-10-16",
        reason: "Browser story - Dave annual leave"
      });
      await submitSelectedRequest(dave);
      await expect(dave.page.getByTestId("workflow-responsible")).toContainText("person:carol");

      const carol = await persona("carol");
      await openView(carol, scenario, "view:my-approvals");
      await expect(rowContaining(carol.page, "2026-10-12")).toBeVisible();
      await rowContaining(carol.page, "2026-10-12").click();
      await expect(carol.page.getByTestId("document-workspace")).toBeVisible();
      await expect(carol.page.getByTestId("workflow-state")).toHaveText("Submitted");
      await carol.page.getByTestId("workflow-action-approve").click();
      await expect(carol.page.getByTestId("workflow-state")).toHaveText("Approved");

      await openView(dave, scenario, "view:my-requests");
      const daveRow = rowContaining(dave.page, "2026-10-12");
      await expect(daveRow).toBeVisible();
      await expect(daveRow.getByTestId("doc-row-state")).toContainText("approved");

      const frank = await persona("frank");
      await openView(frank, scenario, "view:my-requests");
      await expect(rowContaining(frank.page, "2026-10-12")).toHaveCount(0);

      // ADR-0026: visibility is the app ACL — frank (an app author) can read Dave's
      // request directly, but it is not in his personal view and he cannot edit it.
      const docUrl = `/api/apps/${scenario.leaveRequestAppId}/documents/${encodeURIComponent(requestId)}`;
      const direct = await frank.page.request.get(docUrl);
      expect(direct.status()).toBe(200);
      const frankEdit = await frank.page.request.put(docUrl, { data: { payload: (await direct.json()).payload } });
      expect(frankEdit.status()).toBe(403);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test("@me approval inboxes route person and group assignments to the right browsers", async ({
    browser,
    apiBaseURL,
    page
  }) => {
    const scenario = await seedAgenticAirlines(page.request);
    const contexts: BrowserContext[] = [];
    const persona = async (username: AirlinePersonaName) => {
      const opened = await openPersona(browser, apiBaseURL, username);
      contexts.push(opened.context);
      return opened;
    };

    try {
      const ivy = await persona("ivy");
      await createLeaveRequest(ivy, scenario, {
        type: "sick",
        from: "2026-07-09",
        to: "2026-07-10",
        reason: "Browser story - Ivy routed to Hank"
      });
      await submitSelectedRequest(ivy);
      await expect(ivy.page.getByTestId("workflow-responsible")).toContainText("person:hank");

      const hank = await persona("hank");
      await openView(hank, scenario, "view:my-approvals");
      await expect(rowContaining(hank.page, "2026-07-09")).toBeVisible();

      const deptId = scenario.departmentDocIds["ground-ops"];
      const blankHead = await page.request.put(
        `/api/apps/${scenario.orgAppId}/documents/${encodeURIComponent(deptId)}`,
        { data: { payload: { name: "Ground Operations", slug: "ground-ops", parent: "", head: "" } } }
      );
      expect(blankHead.status()).toBe(200);

      await createLeaveRequest(ivy, scenario, {
        type: "unpaid",
        from: "2026-08-03",
        to: "2026-08-04",
        reason: "Browser story - group manager inbox"
      });
      await submitSelectedRequest(ivy);
      await expect(ivy.page.getByTestId("workflow-responsible")).toContainText("group:managers");

      for (const manager of ["carol", "erin", "grace"] as const) {
        const managerBrowser = await persona(manager);
        await openView(managerBrowser, scenario, "view:my-approvals");
        await expect(rowContaining(managerBrowser.page, "2026-08-03"), `${manager}'s inbox`).toBeVisible();
      }

      await openView(hank, scenario, "view:my-approvals");
      await expect(rowContaining(hank.page, "2026-08-03")).toHaveCount(0);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
