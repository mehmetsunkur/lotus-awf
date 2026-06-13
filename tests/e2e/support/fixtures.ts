import { test as base, expect, type Page } from "@playwright/test";

/**
 * Page-object helper for the M2 runtime shell. Wraps the data-testid selectors
 * added to src/client/main.tsx so specs read at the level of user intent.
 */
export class RuntimeApp {
  constructor(public readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/");
    await this.waitForReady();
  }

  /** Wait until the seeded runtime shell (not the empty/booting state) is shown. */
  async waitForReady(): Promise<void> {
    await expect(this.page.getByTestId("view-picker")).toBeVisible();
  }

  async selectView(viewId: string): Promise<void> {
    await this.page.getByTestId(`view-tab-${viewId}`).click();
  }

  async newDocument(): Promise<void> {
    await this.page.getByTestId("form-new").click();
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
