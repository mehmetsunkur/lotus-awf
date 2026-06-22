import { test, expect } from "./support/fixtures";

/**
 * M7 plugin/handler runtime. The seeded expense form has a computed `gross`
 * field (pure handler `expense-total-with-tax`) and the submit transition
 * carries an `audit-transition` effect. The e2e server runs as person:alice.
 */
test.describe("plugin runtime", () => {
  test.setTimeout(60_000);

  test("a computed field derives its value and recomputes live, read-only", async ({ app, page }) => {
    await app.goto();
    await app.openView("view:all-expenses");
    await app.documentRows().filter({ hasText: "Stationery" }).click();

    // Stationery amount is 42.5 → gross 51 (amount + 20% tax), computed offline.
    const gross = page.getByTestId("field-gross");
    await expect(gross).toHaveValue("51");
    await expect(gross).toBeDisabled();

    // Editing the input recomputes the derived field with no save / round-trip.
    await app.fillField("amount", "200");
    await expect(gross).toHaveValue("240");
  });

  test("the server computes the same value on save (validation parity)", async ({ page }) => {
    const created = await page.request.post("/api/documents", {
      data: { docType: "expense", payload: { amount: 10, description: "Plugin parity", category: "supplies" } }
    });
    expect(created.ok()).toBeTruthy();
    expect((await created.json()).payload.gross).toBe(12);
  });

  test("a transition runs its effect handler server-side and logs it", async ({ page }) => {
    const docs = await page.request.get("/api/documents?docType=expense").then((r) => r.json());
    const id: string = docs.find((d: { payload: { description: string } }) => d.payload.description === "Stationery")._id;

    const res = await page.request.post(`/api/documents/${encodeURIComponent(id)}/transition`, {
      data: { transition: "submit" }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // State change is authoritative AND the effect ran best-effort alongside it.
    expect(body.state).toBe("submitted");
    expect(body.effects?.[0]).toEqual(expect.objectContaining({ name: "audit-transition", ok: true }));

    const log = await page.request.get("/api/plugins/log").then((r) => r.json());
    expect(log.some((entry: { docId: string; transition: string }) => entry.docId === id && entry.transition === "submit")).toBe(true);
  });

  test("the plugin manifest lists declared handlers with their kind", async ({ page }) => {
    const manifest = await page.request.get("/api/plugins/manifest").then((r) => r.json());
    expect(manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "expense-total-with-tax", kind: "pure" }),
        expect.objectContaining({ name: "audit-transition", kind: "effect" })
      ])
    );
  });
});
