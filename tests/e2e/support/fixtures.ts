import { test as base, expect, type Page } from "@playwright/test";

/**
 * Page-object helper for the M2 runtime shell. Wraps the data-testid selectors
 * added to src/client/main.tsx so specs read at the level of user intent.
 */
export class RuntimeApp {
  constructor(public readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/expense.nsf");
    await this.waitForReady();
  }

  async gotoDesigner(path = "/expense.nsf/designer"): Promise<void> {
    await this.page.goto(path);
    await expect(this.page.getByTestId("designer-workspace")).toBeVisible();
    await expect(this.message()).toHaveText(/Open Expense complete\./);
  }

  /**
   * Wait until the seeded runtime shell is shown AND the initial refresh has
   * fully settled. The boot sequence issues several refreshes that re-set the
   * selected row and reload definition objects; interacting before they finish
   * races those state updates, so we gate on the completion message.
   */
  async waitForReady(): Promise<void> {
    await expect(this.page.getByTestId("view-picker")).toBeVisible();
    await expect(this.message()).toHaveText(/Initial refresh complete\.|Open Expense complete\./);
  }

  async selectView(viewId: string): Promise<void> {
    await this.page.getByTestId(`view-tab-${viewId}`).click();
  }

  /**
   * Click Refresh and wait for the runtime to fully settle. Switching a view tab
   * alone does not refetch documents, so specs that change views call this to
   * load the matching rows deterministically. We wait on the completion message
   * (not a single HTTP response) because a refresh cycle issues several requests
   * and only sets the selected row once all of them have applied.
   */
  async refresh(): Promise<void> {
    await this.page.getByTestId("status-refresh").click();
    await expect(this.message()).toHaveText("Refresh complete.");
  }

  /** Switch to a view and load its documents in one deterministic step. */
  async openView(viewId: string): Promise<void> {
    await this.selectView(viewId);
    await this.refresh();
  }

  async newDocument(): Promise<void> {
    await this.page.getByTestId("form-new").click();
    // New documents have no Delete button; wait for it to confirm the form
    // really cleared the selection before we start filling fields.
    await expect(this.page.getByTestId("form-delete")).toBeHidden();
  }

  async fillField(name: string, value: string): Promise<void> {
    await this.page.getByTestId(`field-${name}`).fill(value);
  }

  async selectOption(name: string, value: string): Promise<void> {
    await this.page.getByTestId(`field-${name}`).selectOption(value);
  }

  async save(): Promise<void> {
    await this.page.getByTestId("form-save").click();
  }

  /**
   * Set the definition JSON editor's value. Playwright's fill() is unreliable on
   * this controlled textarea, so we drive React's onChange via the native value
   * setter + an input event (works instantly regardless of content size).
   */
  async setDefinitionJson(value: string): Promise<void> {
    await this.page.getByTestId("definition-json").evaluate((element, next) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      setter?.call(element, next);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }

  documentRows() {
    return this.page.getByTestId("doc-row");
  }

  row(docId: string) {
    return this.page.locator(`[data-testid="doc-row"][data-doc-id="${docId}"]`);
  }

  async documentCount(): Promise<number> {
    return Number(await this.page.getByTestId("document-count").innerText());
  }

  message() {
    return this.page.getByTestId("message");
  }
}

type Fixtures = {
  app: RuntimeApp;
  /** Auto fixture: re-seed both CouchDB instances before each test. */
  resetState: void;
};

export const test = base.extend<Fixtures>({
  resetState: [
    async ({ request }, use) => {
      const response = await request.post("/api/reset");
      if (!response.ok()) {
        throw new Error(`/api/reset failed with status ${response.status()}`);
      }
      await use();
    },
    { auto: true }
  ],
  app: async ({ page }, use) => {
    await use(new RuntimeApp(page));
  }
});

export { expect };
