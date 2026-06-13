import { test, expect } from "./support/fixtures";

test.describe("conflict inspection and resolution", () => {
  // The demo seeds a doc, replicates, edits both sides, and replicates again.
  test.setTimeout(90_000);

  test("inspects a replicated data conflict and resolves it", async ({ app, page }) => {
    await app.goto();

    // Start clean.
    await expect(page.getByTestId("conflict-empty")).toBeVisible();

    // Trigger the bidirectional data-conflict demo.
    await page.getByTestId("status-data-conflict").click();

    // A conflict shows up in the resolution queue.
    const conflictItem = page.getByTestId("conflict-item").first();
    await expect(conflictItem).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("conflict-count")).not.toHaveText("0");

    // Inspect it: the winning revision and the resolve action appear.
    await conflictItem.click();
    await expect(page.getByTestId("conflict-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Winning revision" })).toBeVisible();

    // Resolve by keeping the winning revision; the queue empties.
    await page.getByTestId("conflict-resolve").click();
    await expect(page.getByTestId("conflict-empty")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("conflict-count")).toHaveText("0");
  });
});
