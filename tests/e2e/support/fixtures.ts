import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { startHarness, type Harness } from "./worker-harness";

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
    await this.settle();
  }

  /**
   * Wait until the runtime stops issuing background `/api` requests. Navigation
   * and view switches each trigger a refresh cascade (status/definitions/
   * conflicts/documents/options/audit) driven by effects on the freshly loaded
   * `definitions`; a trailing cascade landing mid-typing resets the form draft
   * (main.tsx rebuilds the draft on new `definitions`/`selected` identity) and
   * wipes fields a spec just entered. The completion-message gates confirm the
   * *explicit* refresh finished, but not these effect-driven ones.
   *
   * Playwright's `networkidle` (500ms quiet) is too eager here: an effect fires
   * its refresh a few hundred ms after the route change, so the cascades have
   * sub-second gaps that `networkidle` mistakes for "settled". Instead we require
   * a longer continuous quiet window with zero in-flight `/api` requests. The app
   * uses no websockets/polling, so sustained silence is a reliable settled signal.
   */
  async settle(quietMs = 1_500, timeoutMs = 20_000): Promise<void> {
    const isApi = (url: string) => url.includes("/api/");
    let inFlight = 0;
    let lastActivity = Date.now();
    const onRequest = (request: { url: () => string }) => {
      if (isApi(request.url())) {
        inFlight += 1;
        lastActivity = Date.now();
      }
    };
    const onSettled = (request: { url: () => string }) => {
      if (isApi(request.url())) {
        inFlight = Math.max(0, inFlight - 1);
        lastActivity = Date.now();
      }
    };
    this.page.on("request", onRequest);
    this.page.on("requestfinished", onSettled);
    this.page.on("requestfailed", onSettled);
    try {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (inFlight === 0 && Date.now() - lastActivity >= quietMs) return;
        await this.page.waitForTimeout(100);
      }
    } finally {
      this.page.off("request", onRequest);
      this.page.off("requestfinished", onSettled);
      this.page.off("requestfailed", onSettled);
    }
  }

  /**
   * Wait until the seeded runtime shell is shown AND the initial refresh has
   * fully settled. The boot sequence issues several refreshes that re-set the
   * selected row and reload definition objects; interacting before they finish
   * races those state updates, so we gate on the completion message and then on
   * network idle.
   */
  async waitForReady(): Promise<void> {
    await expect(this.page.getByTestId("view-picker")).toBeVisible();
    await expect(this.message()).toHaveText(/Initial refresh complete\.|Open Expense complete\./);
    await this.settle();
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
    await this.settle();
  }

  /** Switch to a view and load its documents in one deterministic step. */
  async openView(viewId: string): Promise<void> {
    await this.selectView(viewId);
    await this.refresh();
  }

  async newDocument(docType = "expense"): Promise<void> {
    await this.page.getByTestId(`new-doc-${docType}`).click();
    // New documents have no Delete button; wait for it to confirm the form
    // really cleared the selection before we start filling fields.
    await expect(this.page.getByTestId("form-delete")).toBeHidden();
    // Drain any background refresh the new-doc navigation kicked off before we
    // type — otherwise it lands mid-typing and resets the freshly cleared draft.
    await this.settle();
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

type WorkerFixtures = {
  /**
   * Per-worker isolated environment: a private CouchDB pair + Express server.
   * Created once per worker and torn down when the worker exits.
   */
  workerHarness: Harness;
  /** This worker's Express base URL — for fixtures/specs that open their own
   *  request contexts (e.g. distinct users) rather than using `page`. */
  apiBaseURL: string;
  /** This worker's local-replica CouchDB host endpoint (http://host:port, no
   *  credentials) — for specs that assert/seed CouchDB directly. */
  localCouchUrl: string;
  /** This worker's server-replica CouchDB host endpoint. */
  serverCouchUrl: string;
};

type TestFixtures = {
  app: RuntimeApp;
  bobApi: APIRequestContext;
  /** Auto fixture: re-seed this worker's CouchDB pair before each test. */
  resetState: void;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerHarness: [
    async ({}, use) => {
      const harness = await startHarness();
      await use(harness);
      await harness.stop();
    },
    { scope: "worker", timeout: 120_000 }
  ],
  apiBaseURL: [
    async ({ workerHarness }, use) => {
      await use(workerHarness.baseURL);
    },
    { scope: "worker" }
  ],
  localCouchUrl: [
    async ({ workerHarness }, use) => {
      await use(workerHarness.localCouchUrl);
    },
    { scope: "worker" }
  ],
  serverCouchUrl: [
    async ({ workerHarness }, use) => {
      await use(workerHarness.serverCouchUrl);
    },
    { scope: "worker" }
  ],
  // Override Playwright's built-in baseURL (test-scoped) so `page` and
  // `page.request` resolve relative paths against this worker's server.
  baseURL: async ({ workerHarness }, use) => {
    await use(workerHarness.baseURL);
  },
  resetState: [
    async ({ page }, use) => {
      const response = await page.request.post("/api/reset");
      if (!response.ok()) {
        throw new Error(`/api/reset failed with status ${response.status()}`);
      }
      const alice = await page.request.post("/api/session/login", { data: { username: "alice", password: "password123" } });
      if (!alice.ok()) throw new Error(`/api/session/login alice failed with status ${alice.status()}`);
      await use();
    },
    { auto: true }
  ],
  bobApi: async ({ playwright, apiBaseURL, resetState }, use) => {
    void resetState;
    // Same worker server, separate cookie jar — sessions live in CouchDB, so a
    // fresh request context is a fully independent authenticated identity.
    const bobApi = await playwright.request.newContext({ baseURL: apiBaseURL });
    const login = await bobApi.post("/api/session/login", {
      data: { username: "bob", password: "password123" }
    });
    if (!login.ok()) throw new Error(`/api/session/login bob failed with status ${login.status()}`);
    await use(bobApi);
    await bobApi.dispose();
  },
  app: async ({ page }, use) => {
    await use(new RuntimeApp(page));
  }
});

export { expect };
