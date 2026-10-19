import { test, expect } from "./support/fixtures";

type Doc = { _id: string; payload: Record<string, unknown> };

/** Commit the search box query and wait for the runtime to settle. */
async function search(app: import("./support/fixtures").RuntimeApp, query: string) {
  await app.page.getByTestId("view-search-input").fill(query);
  await app.page.getByTestId("view-search-submit").click();
  await expect(app.message()).toHaveText(query.trim() ? "Search complete." : "Refresh complete.");
}

test.describe("full-text search", () => {
  test("narrows the view to matching documents and clears back to the full list", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:all-expenses");
    await expect(app.documentRows()).toHaveCount(3);

    await search(app, "train");
    await expect(app.documentRows()).toHaveCount(1);
    await expect(page.getByText("Train ticket")).toBeVisible();

    await search(app, "zzznomatch");
    await expect(app.documentRows()).toHaveCount(0);

    await page.getByTestId("view-search-clear").click();
    await expect(app.message()).toHaveText("Refresh complete.");
    await expect(app.documentRows()).toHaveCount(3);
  });

  test("orders matches by score (more hits rank first)", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:all-expenses");

    // Two docs sharing a term, one repeating it: the repeat must rank first.
    // `save()` returns on click, so wait for each save to settle before the next.
    await app.newDocument();
    await app.fillField("description", "zeta meeting");
    await app.fillField("amount", "10");
    await app.save();
    await expect(page).toHaveURL(/\/expense\.nsf\/documents\/doc%3Aexpense%3A/);
    await app.goto();
    await app.openView("view:all-expenses");

    await app.newDocument();
    await app.fillField("description", "zeta zeta summit");
    await app.fillField("amount", "20");
    await app.save();
    await expect(page).toHaveURL(/\/expense\.nsf\/documents\/doc%3Aexpense%3A/);
    await app.goto();
    await app.openView("view:all-expenses");

    await search(app, "zeta");
    await expect(app.documentRows()).toHaveCount(2);
    const firstRow = app.documentRows().first();
    await expect(firstRow.getByText("zeta zeta summit")).toBeVisible();
  });

  test("search never surfaces a document outside the user's app access (ADR-0026)", async ({ bobApi, page }) => {
    // Every app reader searches the whole app — Bob finds Alice's "Stationery".
    const bobHit = (await bobApi.get("/api/apps/expense/views/view:all-expenses/documents?q=Stationery").then((r) => r.json())) as Doc[];
    expect(bobHit.map((doc) => doc.payload.description)).toContain("Stationery");

    // Without app access, search is refused at the app gate rather than filtered.
    const revoke = await page.request.put("/api/apps/expense/access", {
      data: { entries: [{ principal: "group:finance", level: "manager" }] }
    });
    expect(revoke.ok()).toBeTruthy();
    const refused = await bobApi.get("/api/apps/expense/views/view:all-expenses/documents?q=Stationery");
    expect(refused.status()).toBe(403);
  });
});
