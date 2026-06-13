import { test, expect } from "./support/fixtures";

test.describe("local definition editor", () => {
  test("editing a view title locally updates the runtime view tab", async ({ app, page }) => {
    await app.goto();

    // Load the all-expenses view definition into the JSON editor.
    await page.getByTestId("definition-select").selectOption("view:all-expenses");
    const editor = page.getByTestId("definition-json");
    await expect(editor).toHaveValue(/view:all-expenses/);

    const definition = JSON.parse(await editor.inputValue()) as { title: string };
    definition.title = "All Expenses (Edited)";
    await app.setDefinitionJson(JSON.stringify(definition, null, 2));

    await page.getByTestId("definition-save").click();

    // The runtime re-reads definitions and relabels the tab (id is unchanged).
    await expect(page.getByTestId("view-tab-view:all-expenses")).toContainText("All Expenses (Edited)");
  });

  test("rejects invalid JSON with an inline error", async ({ app, page }) => {
    await app.goto();

    await app.setDefinitionJson("{ not valid json");
    await expect(page.getByTestId("definition-json")).toHaveValue("{ not valid json");
    await page.getByTestId("definition-save").click();

    await expect(page.getByTestId("definition-error")).toBeVisible();
  });
});
