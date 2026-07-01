import { test, expect } from "./support/fixtures";

type TemplateArtifact = {
  kind: "template";
  templateId: string;
  appId: string;
  version: string;
  definitions: Array<{ _id: string; _rev?: string; kind: string; title?: string }>;
};

test.describe("template promotion", () => {
  test("exports definitions as a versioned artifact without business documents", async ({ page }) => {
    const response = await page.request.post("/api/apps/expense/templates/export", {
      data: { version: "vtest001", source: "e2e" }
    });
    expect(response.ok()).toBeTruthy();

    const template = (await response.json()) as TemplateArtifact;
    expect(template.kind).toBe("template");
    expect(template.templateId).toBe("expense:vtest001");
    expect(template.appId).toBe("expense");
    expect(template.version).toBe("vtest001");
    expect(template.definitions.map((definition) => definition._id)).toEqual([
      "acl:rules",
      "agent:daily-digest",
      "agent:on-expense-change",
      "app:config",
      "audit:policy",
      "form:expense",
      "form:vendor",
      "view:all-expenses",
      "view:my-expenses",
      "view:pending-approvals",
      "view:vendors",
      "workflow:expense"
    ]);
    expect(template.definitions.some((definition) => definition.kind === "document")).toBe(false);
    expect(template.definitions.some((definition) => definition._rev)).toBe(false);
  });

  test("diffs and applies a template without touching business documents", async ({ page }) => {
    const exported = await page.request.post("/api/apps/expense/templates/export", {
      data: { version: "vrestore", source: "e2e" }
    });
    const template = (await exported.json()) as TemplateArtifact;

    const beforeDocs = await page.request.get("/api/apps/expense/documents?docType=expense").then((response) => response.json());
    const beforeIds = beforeDocs.map((doc: { _id: string }) => doc._id).sort();

    const definitions = await page.request.get("/api/apps/expense/definitions").then((response) => response.json());
    const changedView = {
      ...definitions.views.find((view: { _id: string }) => view._id === "view:all-expenses"),
      title: "All Expenses (Promotion Drift)"
    };
    const save = await page.request.put("/api/apps/expense/definitions/view%3Aall-expenses", { data: changedView });
    expect(save.ok()).toBeTruthy();

    const diff = await page.request.post("/api/apps/expense/templates/diff", { data: { template } });
    expect(diff.ok()).toBeTruthy();
    const diffBody = await diff.json();
    expect(diffBody.changed).toContainEqual({ id: "view:all-expenses", kind: "view" });

    const apply = await page.request.post("/api/apps/expense/templates/apply", { data: { template } });
    expect(apply.ok()).toBeTruthy();
    const applyBody = await apply.json();
    expect(applyBody.diff.changed).toContainEqual({ id: "view:all-expenses", kind: "view" });

    const restored = await page.request.get("/api/apps/expense/definitions").then((response) => response.json());
    const restoredTitle = restored.views.find((view: { _id: string }) => view._id === "view:all-expenses").title;
    expect(restoredTitle).toBe("All Expenses");

    const afterDocs = await page.request.get("/api/apps/expense/documents?docType=expense").then((response) => response.json());
    const afterIds = afterDocs.map((doc: { _id: string }) => doc._id).sort();
    expect(afterIds).toEqual(beforeIds);
  });

  test("rejects invalid template definitions", async ({ page }) => {
    const exported = await page.request.post("/api/apps/expense/templates/export", {
      data: { version: "vinvalid", source: "e2e" }
    });
    const template = (await exported.json()) as TemplateArtifact;
    const invalid = {
      ...template,
      definitions: template.definitions.map((definition) =>
        definition._id === "view:all-expenses" ? { ...definition, columns: [] } : definition
      )
    };

    const apply = await page.request.post("/api/apps/expense/templates/apply", { data: { template: invalid } });
    expect(apply.status()).toBe(422);
    expect(JSON.stringify(await apply.json())).toContain("A view needs at least one column");
  });
});
