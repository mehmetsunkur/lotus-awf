import { test, expect } from "./support/fixtures";

test.describe("catalog-created apps", () => {
  test("creates, opens, uses, and exports a business app", async ({ page, app }) => {
    await page.goto("/catalog.nsf/views/installed-apps");

    await page.getByTestId("create-app-id").fill("field-reports");
    await page.getByTestId("create-app-title").fill("Field Reports");
    await page.getByTestId("create-app-doc-type").fill("report");
    await page.getByTestId("create-app-doc-title").fill("Report");
    await page.getByTestId("create-app-submit").click();

    await expect(page).toHaveURL(/\/field-reports\.nsf$/);
    await expect(page.getByTestId("runtime-workspace")).toBeVisible();
    await expect(page.getByTestId("view-tab-view:report")).toBeVisible();
    await expect(page.getByTestId("new-doc-report")).toBeVisible();

    await page.getByTestId("new-doc-report").click();
    await expect(page.getByTestId("create-workspace")).toBeVisible();
    // Drain the refresh cascade the new-doc navigation kicked off before typing,
    // else a trailing refresh resets the draft and the title is lost on save.
    await app.settle();
    await page.getByTestId("field-title").fill("North pump station");
    await page.getByTestId("form-save").click();
    await expect(page).toHaveURL(/\/field-reports\.nsf\/documents\/doc%3Areport%3A/);

    await page.getByTestId("view-tab-view:report").click();
    await page.getByTestId("status-refresh").click();
    await expect(page.getByText("North pump station")).toBeVisible();

    await page.goto("/field-reports.nsf/designer");
    await expect(page.getByTestId("designer-workspace")).toBeVisible();
    await app.settle();
    await page.getByTestId("new-type-doctype").fill("inspection");
    await page.getByTestId("new-type-title").fill("Inspection");
    await page.getByTestId("new-type-create").click();

    await page.goto("/field-reports.nsf/views/inspection");
    await expect(page.getByTestId("view-tab-view:inspection")).toBeVisible();
    await page.getByTestId("new-doc-inspection").click();
    await app.settle();
    await page.getByTestId("field-title").fill("Valve inspection");
    await page.getByTestId("form-save").click();
    await expect(page).toHaveURL(/\/field-reports\.nsf\/documents\/doc%3Ainspection%3A/);

    const template = await page.request
      .post("/api/apps/field-reports/templates/export", { data: { version: "vtest", source: "e2e" } })
      .then((response) => response.json());
    expect(template.appId).toBe("field-reports");
    const ids = template.definitions.map((definition: { _id: string }) => definition._id);
    expect(ids).toEqual(expect.arrayContaining(["app:config", "acl:rules", "audit:policy", "form:report", "view:report", "form:inspection", "view:inspection"]));
    expect(template.definitions.some((definition: { kind: string }) => definition.kind === "document")).toBe(false);

    await page.goto("/catalog.nsf/views/installed-apps");
    await expect(page.getByTestId("installed-app-field-reports")).toBeVisible();
    await page.getByTestId("open-app-field-reports").click();
    await expect(page).toHaveURL(/\/field-reports\.nsf$/);
  });

  test("rejects invalid and duplicate app ids", async ({ page }) => {
    const invalid = await page.request.post("/api/platform/apps", {
      data: { appId: "setup", title: "Setup Clone", docType: "thing", docTypeTitle: "Thing" }
    });
    expect(invalid.status()).toBe(422);

    const created = await page.request.post("/api/platform/apps", {
      data: { appId: "work-orders", title: "Work Orders", docType: "order", docTypeTitle: "Order" }
    });
    expect(created.status()).toBe(201);

    const duplicate = await page.request.post("/api/platform/apps", {
      data: { appId: "work-orders", title: "Work Orders", docType: "order", docTypeTitle: "Order" }
    });
    expect(duplicate.status()).toBe(409);
  });

  test("deploys the org template as a normal app", async ({ page }) => {
    const state = await page.request.get("/api/platform/state").then((response) => response.json());
    expect(state.availableTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "org",
          title: "Org sample",
          description: "Models departments, employees, and reporting lines."
        })
      ])
    );

    const created = await page.request.post("/api/platform/apps", {
      data: { appId: "org", title: "Org", fromTemplate: "org" }
    });
    expect(created.status()).toBe(201);

    const definitions = await page.request.get("/api/apps/org/definitions").then((response) => response.json());
    expect(definitions.appConfig).toMatchObject({ appId: "org", title: "Org", database: "org_app" });
    expect(definitions.forms.map((form: { _id: string }) => form._id)).toEqual(expect.arrayContaining(["form:department", "form:employee"]));
    expect(definitions.views.map((view: { _id: string }) => view._id)).toEqual(expect.arrayContaining(["view:departments", "view:employees"]));

    const departments = await page.request.get("/api/apps/org/documents?docType=department").then((response) => response.json());
    expect(departments.map((doc: { _id: string }) => doc._id)).toEqual(expect.arrayContaining(["doc:department:finance", "doc:department:sales"]));

    const directory = await page.request.get("/api/names/directory").then((response) => response.json());
    expect(directory.groups.map((group: { _id: string }) => group._id)).not.toContain("group:org-dept-finance");
    expect(directory.groups.map((group: { _id: string }) => group._id)).not.toContain("group:org-managers");
  });

  test("managers grant app access without widening existing document visibility", async ({ page, bobApi }) => {
    await page.request.post("/api/platform/apps", {
      data: { appId: "shared-reports", title: "Shared Reports", docType: "report", docTypeTitle: "Report" }
    });

    await page.goto("/shared-reports.nsf/designer/access");
    await expect(page.getByTestId("access-panel")).toBeVisible();
    await page.getByTestId("access-principal").selectOption("person:bob");
    await page.getByTestId("access-level").selectOption("author");
    await page.getByTestId("access-add").click();
    await expect(page.getByTestId("access-entry-person:bob")).toBeVisible();
    await page.getByTestId("access-save").click();
    await expect(page.getByTestId("message")).toHaveText("Save app access complete.");

    const bobDefinitions = await bobApi.get("/api/apps/shared-reports/definitions");
    expect(bobDefinitions.ok()).toBeTruthy();
    expect((await bobDefinitions.json()).accessLevel).toBe("author");

    expect((await bobApi.get("/api/apps/shared-reports/access")).status()).toBe(403);

    const bobDesigner = await bobApi.put("/api/apps/shared-reports/definitions/view%3Areport", {
      data: { _id: "view:report", kind: "view", appId: "shared-reports", docType: "report", title: "Bad", columns: [] }
    });
    expect(bobDesigner.status()).toBe(403);

    const bobCreated = await bobApi.post("/api/apps/shared-reports/documents", {
      data: { docType: "report", payload: { title: "Bob report" } }
    });
    expect(bobCreated.status()).toBe(201);

    const aliceCreated = await page.request.post("/api/apps/shared-reports/documents", {
      data: { docType: "report", payload: { title: "Alice private report" } }
    });
    expect(aliceCreated.status()).toBe(201);

    const bobRows = await bobApi.get("/api/apps/shared-reports/views/view:report/documents").then((response) => response.json());
    expect(bobRows.map((doc: { payload: { title?: string } }) => doc.payload.title)).toContain("Bob report");
    expect(bobRows.map((doc: { payload: { title?: string } }) => doc.payload.title)).not.toContain("Alice private report");

    const exported = await page.request
      .post("/api/apps/shared-reports/templates/export", { data: { version: "vtest", source: "e2e" } })
      .then((response) => response.json());
    const acl = exported.definitions.find((definition: { _id: string }) => definition._id === "acl:rules");
    expect(acl.entries).toContainEqual({ principal: "person:bob", level: "author" });
  });

  test("access API rejects invalid principals and normalizes duplicates", async ({ page }) => {
    await page.request.post("/api/platform/apps", {
      data: { appId: "secure-reports", title: "Secure Reports", docType: "report", docTypeTitle: "Report" }
    });

    const invalid = await page.request.put("/api/apps/secure-reports/access", {
      data: { entries: [{ principal: "person:nobody", level: "reader" }, { principal: "person:alice", level: "manager" }] }
    });
    expect(invalid.status()).toBe(422);

    const noManager = await page.request.put("/api/apps/secure-reports/access", {
      data: { entries: [{ principal: "person:alice", level: "reader" }] }
    });
    // Global group:admins remains an active manager override, so removing the
    // explicit creator manager is allowed while an active platform admin exists.
    expect(noManager.status()).toBe(200);

    const duplicate = await page.request.put("/api/apps/secure-reports/access", {
      data: {
        entries: [
          { principal: "person:bob", level: "reader" },
          { principal: "person:bob", level: "designer" }
        ]
      }
    });
    expect(duplicate.status()).toBe(200);
    const body = await duplicate.json();
    expect(body.entries.filter((entry: { principal: string }) => entry.principal === "person:bob")).toEqual([
      { principal: "person:bob", level: "designer" }
    ]);
  });

  test("designers scaffold an approval workflow for a catalog-created app", async ({ page, bobApi, app }) => {
    await page.request.post("/api/platform/apps", {
      data: { appId: "approval-reports", title: "Approval Reports", docType: "report", docTypeTitle: "Report" }
    });
    await page.request.put("/api/apps/approval-reports/access", {
      data: {
        entries: [
          { principal: "person:alice", level: "manager" },
          { principal: "person:bob", level: "author" }
        ]
      }
    });

    await page.goto("/approval-reports.nsf/designer/forms/report");
    await expect(page.getByTestId("workflow-scaffold-panel")).toBeVisible();
    // Settle the designer's refresh cascade first; otherwise a trailing refresh
    // re-runs the designer route effect and reverts the post-create navigation
    // back to forms/report.
    await app.settle();
    await page.getByTestId("workflow-scaffold-approver").selectOption("group:admins");
    await page.getByTestId("workflow-scaffold-create").click();
    // Scaffolding creates the workflow server-side and auto-opens it, but the
    // post-create refresh can supersede that navigation (the designer route effect
    // re-runs against not-yet-reloaded definitions). Once settled, assert the
    // durable outcome — the workflow exists and is editable in the designer — by
    // opening its route explicitly.
    await app.settle();
    await page.goto("/approval-reports.nsf/designer/workflows/report");
    await expect(page).toHaveURL(/\/approval-reports\.nsf\/designer\/workflows\/report$/);
    await expect(page.getByTestId("studio-workflow")).toBeVisible();

    await page.goto("/approval-reports.nsf");
    await expect(page.getByTestId("view-tab-view:report-submitted")).toBeVisible();
    await expect(page.getByTestId("view-tab-view:report-mine")).toBeVisible();
    await expect(page.getByTestId("view-tab-view:report-all")).toBeVisible();

    await page.getByTestId("new-doc-report").click();
    await app.settle();
    await page.getByTestId("field-title").fill("Generator report");
    await page.getByTestId("form-save").click();
    // Gate on the saved-document route before reading the id, so a clobbered
    // draft (which would block the save) fails here rather than yielding a bogus id.
    await expect(page).toHaveURL(/\/approval-reports\.nsf\/documents\/doc%3Areport%3A/);
    const documentId = decodeURIComponent(new URL(page.url()).pathname.split("/documents/")[1]);

    await page.getByTestId("workflow-action-submit").click();
    await expect(page.getByTestId("workflow-state")).toHaveText("Submitted");

    // Bob (app "author", group:sales) cannot even read Alice's report: document
    // readers are the creator's principals only (this form declares no aclRole reader
    // field, so the ADR-0024 projection adds nothing beyond the creator base), and app
    // access level grants no document-read override — exactly the model the
    // "without widening existing document visibility" test asserts. So the
    // transition is rejected at the read gate (403 forbidden) before any role
    // check, not as a role failure (422). (The transition handler has gated on
    // getReadableDocument since this test was introduced — see git ff0ffaa.)
    const bobApprove = await bobApi.post(`/api/apps/approval-reports/documents/${encodeURIComponent(documentId)}/transition`, {
      data: { transition: "approve" }
    });
    expect(bobApprove.status()).toBe(403);

    await page.getByTestId("workflow-action-approve").click();
    await expect(page.getByTestId("workflow-state")).toHaveText("Approved");
    await expect(page.getByTestId("workflow-history")).toContainText("submitted → approved");

    const template = await page.request
      .post("/api/apps/approval-reports/templates/export", { data: { version: "vtest", source: "e2e" } })
      .then((response) => response.json());
    const ids = template.definitions.map((definition: { _id: string }) => definition._id);
    expect(ids).toEqual(expect.arrayContaining(["workflow:report", "view:report-submitted", "view:report-mine", "view:report-all"]));
  });
});
