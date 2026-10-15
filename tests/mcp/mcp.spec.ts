import { test, expect } from "./support/fixtures";
import { connectLotusMcp, type LotusMcpTestClient, type LotusMcpServerKind } from "./support/mcp-client";
import type { AccessibleApp, AppInstall, BusinessDocument, PlatformState, SessionState, TemplateArtifact, WorkflowDefinition } from "../../src/shared/types";
import type { TransitionAffordance } from "../../src/shared/workflow";

type DocumentWithAffordances = { document: BusinessDocument; availableTransitions: TransitionAffordance[] };

type DefinitionsResponse = {
  forms: Array<{ _id: string; docType: string }>;
  views: Array<{ _id: string; docType: string }>;
  workflows: WorkflowDefinition[];
  accessLevel: string;
};

test.describe("Lotus MCP server", () => {
  const clients: LotusMcpTestClient[] = [];
  const uniqueId = () => `field-reports-${Date.now().toString(36)}`;

  // State reset is handled by the auto `resetState` fixture (tests/mcp/support/fixtures.ts).

  test.afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  async function connect(kind: LotusMcpServerKind, apiBaseURL: string): Promise<LotusMcpTestClient> {
    const client = await connectLotusMcp(kind, apiBaseURL);
    clients.push(client);
    return client;
  }

  test("admin surface creates apps and exposes only admin tools", async ({ apiBaseURL }) => {
    const mcp = await connect("admin", apiBaseURL);
    const tools = await mcp.listTools();
    expect(tools).toContain("lotus_admin_create_app");
    expect(tools).toContain("lotus_admin_update_app_access");
    expect(tools).not.toContain("lotus_designer_create_document_type");
    expect(tools).not.toContain("lotus_workspace_create_document");

    const session = await mcp.callJsonTool<SessionState>("lotus_admin_get_session");
    expect(session.authenticated).toBe(true);
    expect(session.person?.username).toBe("alice");

    const apps = await mcp.callJsonTool<AppInstall[]>("lotus_admin_list_apps");
    expect(apps.map((app) => app.appId)).toContain("expense");

    const appId = uniqueId();
    const created = await mcp.callJsonTool<PlatformState>("lotus_admin_create_app", {
      appId,
      title: "Field Reports",
      docType: "report",
      docTypeTitle: "Report"
    });
    expect(created.installedApps.map((app) => app.appId)).toContain(appId);

    const access = await mcp.callJsonTool<{ entries: Array<{ principal: string; level: string }> }>(
      "lotus_admin_get_app_access",
      { appId }
    );
    expect(access.entries).toContainEqual({ principal: "person:alice", level: "manager" });
  });

  test("designer surface changes app design and exposes only designer tools", async ({ apiBaseURL }) => {
    const mcp = await connect("designer", apiBaseURL);
    const tools = await mcp.listTools();
    expect(tools).toContain("lotus_designer_create_document_type");
    expect(tools).toContain("lotus_designer_apply_workflow_patch");
    expect(tools).not.toContain("lotus_admin_create_app");
    expect(tools).not.toContain("lotus_workspace_create_document");

    const session = await mcp.callJsonTool<SessionState>("lotus_designer_get_session");
    expect(session.authenticated).toBe(true);

    const definitions = await mcp.callJsonTool<DefinitionsResponse>("lotus_designer_get_app_definitions", { appId: "expense" });
    expect(definitions.accessLevel).toBe("manager");
    expect(definitions.forms.map((form) => form._id)).toContain("form:expense");

    const createdType = await mcp.callJsonTool<{ form: { _id: string }; view: { _id: string } }>(
      "lotus_designer_create_document_type",
      {
        appId: "expense",
        docType: "inspection",
        title: "Inspection"
      }
    );
    expect(createdType.form._id).toBe("form:inspection");
    expect(createdType.view._id).toBe("view:inspection");

    const scaffold = await mcp.callJsonTool<{ workflow: WorkflowDefinition; views: Array<{ _id: string }> }>(
      "lotus_designer_scaffold_approval_workflow",
      {
        appId: "expense",
        docType: "inspection",
        approverPrincipal: "group:finance"
      }
    );
    expect(scaffold.workflow._id).toBe("workflow:inspection");
    expect(scaffold.views.map((view) => view._id)).toContain("view:inspection-submitted");

    const preview = await mcp.callJsonTool<{ ok: boolean; workflow: WorkflowDefinition; summary: string[] }>(
      "lotus_designer_preview_workflow_patch",
      {
        appId: "expense",
        docType: "inspection",
        operations: [
          { type: "add_state", name: "archived", label: "Archived", final: true },
          {
            type: "add_transition",
            transition: { id: "archive", label: "Archive", from: "approved", to: "archived" }
          }
        ]
      }
    );
    expect(preview.ok).toBe(true);
    expect(preview.workflow.states.map((state) => state.name)).toContain("archived");
    expect(preview.summary).toEqual(["Added state archived", "Added transition archive"]);

    const applied = await mcp.callJsonTool<{ ok: boolean; written: { _id: string }; workflow: WorkflowDefinition }>(
      "lotus_designer_apply_workflow_patch",
      {
        appId: "expense",
        docType: "inspection",
        operations: [
          { type: "add_state", name: "archived", label: "Archived", final: true },
          {
            type: "add_transition",
            transition: { id: "archive", label: "Archive", from: "approved", to: "archived" }
          }
        ]
      }
    );
    expect(applied.ok).toBe(true);
    expect(applied.written._id).toBe("workflow:inspection");

    const template = await mcp.callJsonTool<TemplateArtifact>("lotus_designer_export_template", {
      appId: "expense",
      source: "mcp-e2e"
    });
    const workflow = template.definitions.find((definition): definition is WorkflowDefinition =>
      definition._id === "workflow:inspection" && definition.kind === "workflow"
    );
    expect(workflow?.states.map((state) => state.name)).toContain("archived");
    expect(workflow?.transitions.map((transition) => transition.id)).toContain("archive");
  });

  test("workspace surface works with documents and exposes only workspace tools", async ({ apiBaseURL }) => {
    const mcp = await connect("workspace", apiBaseURL);
    const tools = await mcp.listTools();
    expect(tools).toContain("lotus_workspace_list_apps");
    expect(tools).toContain("lotus_workspace_create_document");
    expect(tools).toContain("lotus_workspace_transition_document");
    expect(tools).toContain("lotus_workspace_get_form");
    expect(tools).toContain("lotus_workspace_get_view");
    expect(tools).toContain("lotus_workspace_get_workflow");
    expect(tools).not.toContain("lotus_admin_create_app");
    expect(tools).not.toContain("lotus_designer_create_document_type");

    // Discovery: list_apps returns accessible apps with accessLevel.
    const apps = await mcp.callJsonTool<AccessibleApp[]>("lotus_workspace_list_apps");
    expect(apps.map((a) => a.appId)).toContain("expense");
    const expenseApp = apps.find((a) => a.appId === "expense")!;
    expect(expenseApp.title).toBeTruthy();
    expect(["reader", "author", "editor", "designer", "manager"]).toContain(expenseApp.accessLevel);

    // ADR-0023 Phase 2: the workspace listing is LEAN — self-describing headers
    // only, no field/column/state bodies. Scoped tools fetch one full definition.
    type Summary = {
      forms: Array<{ _id: string; docType: string; title: string; fields?: unknown }>;
      views: Array<{ _id: string; columns?: unknown }>;
      workflows: Array<{ _id: string; docType: string; transitions?: unknown }>;
    };
    const definitions = await mcp.callJsonTool<Summary>("lotus_workspace_get_app_definitions", { appId: "expense" });
    expect(definitions.views.map((view) => view._id)).toContain("view:my-expenses");
    // Lean: bodies are absent in the index.
    expect(definitions.forms[0]?.fields).toBeUndefined();
    expect(definitions.views[0]?.columns).toBeUndefined();
    expect(definitions.workflows[0]?.transitions).toBeUndefined();

    // Scoped reads return the full definition for one node.
    const form = await mcp.callJsonTool<{ docType: string; fields: unknown[] }>("lotus_workspace_get_form", {
      appId: "expense",
      docType: "expense"
    });
    expect(form.docType).toBe("expense");
    expect(Array.isArray(form.fields)).toBe(true);

    const workflow = await mcp.callJsonTool<WorkflowDefinition>("lotus_workspace_get_workflow", {
      appId: "expense",
      docType: "expense"
    });
    expect(workflow.transitions.map((transition) => transition.id)).toContain("submit");

    const view = await mcp.callJsonTool<{ _id: string; columns: unknown[] }>("lotus_workspace_get_view", {
      appId: "expense",
      viewId: "view:my-expenses"
    });
    expect(view._id).toBe("view:my-expenses");
    expect(Array.isArray(view.columns)).toBe(true);

    const created = await mcp.callJsonTool<BusinessDocument>("lotus_workspace_create_document", {
      appId: "expense",
      docType: "expense",
      payload: {
        description: "Workspace permit",
        amount: 42,
        category: "travel"
      }
    });
    expect(created._id).toMatch(/^doc:expense:/);

    // ADR-0023 Phase 2: get_document wraps the raw envelope and annotates the
    // actor's currently-available transitions. A fresh draft can `submit`; the
    // affordance carries the guard-referenced field's label (helpText when set).
    const opened = await mcp.callJsonTool<DocumentWithAffordances>("lotus_workspace_get_document", {
      appId: "expense",
      id: created._id
    });
    expect(opened.document._id).toBe(created._id);
    expect(opened.document.payload.description).toBe("Workspace permit");
    const submit = opened.availableTransitions.find((affordance) => affordance.id === "submit");
    expect(submit).toBeDefined();
    expect(submit?.to).toBe("submitted");
    // guard `payload.amount > 0` ⇒ the `amount` field is surfaced as required.
    expect(submit?.requiredFields?.map((field) => field.name)).toContain("amount");

    const queried = await mcp.callJsonTool<BusinessDocument[]>("lotus_workspace_query_view", {
      appId: "expense",
      viewId: "view:my-expenses",
      query: "Workspace"
    });
    expect(queried.map((doc) => doc._id)).toContain(created._id);

    const updated = await mcp.callJsonTool<BusinessDocument>("lotus_workspace_update_document", {
      appId: "expense",
      id: created._id,
      payload: {
        description: "Workspace permit updated",
        amount: 55,
        category: "travel"
      }
    });
    expect(updated.payload.description).toBe("Workspace permit updated");

    const transitioned = await mcp.callJsonTool<BusinessDocument>("lotus_workspace_transition_document", {
      appId: "expense",
      id: created._id,
      transition: "submit"
    });
    expect(transitioned.state).toBe("submitted");
  });

  test("list_apps filters to accessible apps — inaccessible apps are hidden", async ({ request, apiBaseURL }) => {
    // Create a second app as alice (admin). Bob has no ACL entry on it.
    const admin = await connect("admin", apiBaseURL);
    const newAppId = `private-${Date.now().toString(36)}`;
    await admin.callJsonTool<PlatformState>("lotus_admin_create_app", {
      appId: newAppId,
      title: "Private App",
      docType: "item",
      docTypeTitle: "Item"
    });

    // Login as bob and call GET /api/apps directly.
    const loginRes = await request.post(`${apiBaseURL}/api/session/login`, {
      data: { username: "bob", password: "password123" }
    });
    expect(loginRes.ok()).toBe(true);
    const cookie = loginRes.headers()["set-cookie"];

    const appsRes = await request.get(`${apiBaseURL}/api/apps`, {
      headers: { cookie }
    });
    expect(appsRes.ok()).toBe(true);
    const apps = (await appsRes.json()) as AccessibleApp[];

    // Bob has "author" on expense — it must appear.
    expect(apps.map((a) => a.appId)).toContain("expense");
    // Bob has no entry on the new app — it must be absent.
    expect(apps.map((a) => a.appId)).not.toContain(newAppId);
    // Every returned entry must have a valid non-"none" accessLevel.
    for (const app of apps) {
      expect(["reader", "author", "editor", "designer", "manager"]).toContain(app.accessLevel);
    }
  });
});
