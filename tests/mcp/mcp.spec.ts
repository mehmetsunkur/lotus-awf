import { test, expect } from "./support/fixtures";
import { connectLotusMcp, type LotusMcpCredentials, type LotusMcpTestClient, type LotusMcpServerKind } from "./support/mcp-client";
import type { AccessibleApp, AppInstall, AppTemplate, BusinessDocument, DirectoryState, PlatformState, PublicGroup, PublicPerson, SessionState, TemplateArtifact, WorkflowDefinition } from "../../src/shared/types";
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

  async function connect(kind: LotusMcpServerKind, apiBaseURL: string, credentials?: LotusMcpCredentials): Promise<LotusMcpTestClient> {
    const client = await connectLotusMcp(kind, apiBaseURL, credentials);
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

  test("admin surface manages the names.nsf directory", async ({ apiBaseURL }) => {
    const directoryTools = [
      "lotus_admin_get_directory",
      "lotus_admin_create_person",
      "lotus_admin_update_person",
      "lotus_admin_set_person_password",
      "lotus_admin_create_group",
      "lotus_admin_update_group",
      "lotus_admin_add_group_members",
      "lotus_admin_remove_group_members"
    ];
    const admin = await connect("admin", apiBaseURL);
    const adminTools = await admin.listTools();
    for (const tool of directoryTools) expect(adminTools).toContain(tool);
    for (const kind of ["designer", "workspace"] as const) {
      const other = await (await connect(kind, apiBaseURL)).listTools();
      for (const tool of directoryTools) expect(other).not.toContain(tool);
    }

    const outputs: unknown[] = [];
    const call = async <T,>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      const result = await admin.callJsonTool<T>(name, args);
      outputs.push(result);
      return result;
    };

    const suffix = Date.now().toString(36);
    const username = `dana-${suffix}`;
    const slug = `ops-${suffix}`;
    const groupId = `group:${slug}`;

    const created = await call<{ person: PublicPerson }>("lotus_admin_create_person", {
      username,
      displayName: "Dana Ops",
      password: "first-pass-123"
    });
    expect(created.person).toMatchObject({ _id: `person:${username}`, displayName: "Dana Ops", active: true });

    const dana = await connect("workspace", apiBaseURL, { username, password: "first-pass-123" });
    const danaSession = await dana.callJsonTool<SessionState>("lotus_workspace_get_session");
    expect(danaSession.person?.username).toBe(username);

    await call("lotus_admin_update_person", { username, displayName: "Dana Operations" });
    await call("lotus_admin_set_person_password", { username, password: "second-pass-456" });
    await expect(connect("workspace", apiBaseURL, { username, password: "first-pass-123" }).then((c) => c.callJsonTool("lotus_workspace_get_session"))).rejects.toThrow();
    const relogin = await connect("workspace", apiBaseURL, { username, password: "second-pass-456" });
    expect((await relogin.callJsonTool<SessionState>("lotus_workspace_get_session")).person?.username).toBe(username);

    await call("lotus_admin_create_group", { slug, name: "Ops", members: ["person:bob"] });
    // Mixed-case slug and principal resolve exactly as the server normalizes them.
    await call("lotus_admin_add_group_members", { slug: slug.toUpperCase(), members: [`person:${username.toUpperCase()}`, "person:bob"] });
    let directory = await call<DirectoryState>("lotus_admin_get_directory");
    expect(directory.people.find((person) => person.username === username)?.displayName).toBe("Dana Operations");
    expect(directory.groups.find((group) => group._id === groupId)?.members).toEqual(["person:bob", `person:${username}`]);

    const removed = await call<{ notMembers: string[] }>("lotus_admin_remove_group_members", {
      slug: `GROUP:${slug}`,
      members: ["person:Bob", "person:ghost"]
    });
    expect(removed.notMembers).toEqual(["person:ghost"]);
    const renamed = await call<{ group: PublicGroup }>("lotus_admin_update_group", { slug, name: "Operations" });
    expect(renamed.group).toEqual({ _id: groupId, kind: "group", name: "Operations", members: [`person:${username}`] });

    await call("lotus_admin_update_person", { username, active: false });
    await expect(connect("workspace", apiBaseURL, { username, password: "second-pass-456" }).then((c) => c.callJsonTool("lotus_workspace_get_session"))).rejects.toThrow();
    directory = await call<DirectoryState>("lotus_admin_get_directory");
    expect(directory.people.find((person) => person.username === username)?.active).toBe(false);

    // Server-side guards surface as tool errors.
    await expect(admin.callJsonTool("lotus_admin_remove_group_members", { slug: "admins", members: ["person:alice"] })).rejects.toThrow(
      /At least one active admin is required/
    );
    await expect(admin.callJsonTool("lotus_admin_add_group_members", { slug, members: ["person:ghost"] })).rejects.toThrow();
    await expect(admin.callJsonTool("lotus_admin_add_group_members", { slug: `missing-${suffix}`, members: ["person:bob"] })).rejects.toThrow(
      /Group not found/
    );
    await expect(admin.callJsonTool("lotus_admin_create_group", { slug: `bad-${suffix}`, name: "Bad", members: ["group:finance"] })).rejects.toThrow();

    // Responses never carry password material.
    expect(JSON.stringify(outputs)).not.toMatch(/passwordHash|passwordSalt|passwordParams|second-pass-456|first-pass-123/);
  });

  test("directory writes require a manager session", async ({ apiBaseURL }) => {
    const bob = await connect("admin", apiBaseURL, { username: "bob", password: "password123" });
    const directory = await bob.callJsonTool<DirectoryState>("lotus_admin_get_directory");
    expect(directory.people.map((person) => person.username)).toContain("alice");

    const writes: Array<[string, Record<string, unknown>]> = [
      ["lotus_admin_create_person", { username: "mallory", displayName: "Mallory", password: "password123" }],
      ["lotus_admin_update_person", { username: "alice", active: false }],
      ["lotus_admin_set_person_password", { username: "alice", password: "password456" }],
      ["lotus_admin_create_group", { slug: "rogue", name: "Rogue" }],
      ["lotus_admin_update_group", { slug: "admins", members: ["person:bob"] }],
      ["lotus_admin_add_group_members", { slug: "admins", members: ["person:bob"] }],
      ["lotus_admin_remove_group_members", { slug: "finance", members: ["person:alice"] }]
    ];
    for (const [tool, args] of writes) {
      await expect(bob.callJsonTool(tool, args), tool).rejects.toThrow(/403/);
    }
  });

  test("admin surface installs apps from templates and reports unresolved principals", async ({ apiBaseURL }) => {
    const admin = await connect("admin", apiBaseURL);
    expect(await admin.listTools()).toEqual(expect.arrayContaining(["lotus_admin_list_templates", "lotus_admin_install_template"]));
    for (const kind of ["designer", "workspace"] as const) {
      const other = await (await connect(kind, apiBaseURL)).listTools();
      expect(other).not.toContain("lotus_admin_list_templates");
      expect(other).not.toContain("lotus_admin_install_template");
    }

    const templates = await admin.callJsonTool<AppTemplate[]>("lotus_admin_list_templates");
    const kb = templates.find((template) => template.id === "kb");
    expect(kb?.title).toBeTruthy();
    expect(kb?.description).toBeTruthy();

    const appId = `kb-${Date.now().toString(36)}`;
    const installed = await admin.callJsonTool<{ install: AppInstall; accessEntries: Array<{ principal: string }>; unresolvedPrincipals: string[] }>(
      "lotus_admin_install_template",
      { templateId: "kb", appId, title: "Company KB" }
    );
    expect(installed.install).toMatchObject({ appId, title: "Company KB" });
    expect(installed.accessEntries.map((entry) => entry.principal)).toEqual(expect.arrayContaining(["group:admins", "group:employees"]));
    expect(installed.unresolvedPrincipals).toEqual(["group:employees"]);
    expect((await admin.callJsonTool<AppInstall[]>("lotus_admin_list_apps")).map((app) => app.appId)).toContain(appId);

    // Close the gap the install reported, then the member gets reader access.
    await admin.callJsonTool("lotus_admin_create_person", { username: "erin", displayName: "Erin Employee", password: "erin-pass-123" });
    const erin = await connect("workspace", apiBaseURL, { username: "erin", password: "erin-pass-123" });
    expect((await erin.callJsonTool<AccessibleApp[]>("lotus_workspace_list_apps")).map((app) => app.appId)).not.toContain(appId);
    await admin.callJsonTool("lotus_admin_create_group", { slug: "employees", name: "Employees", members: ["person:erin"] });
    const erinApps = await erin.callJsonTool<AccessibleApp[]>("lotus_workspace_list_apps");
    expect(erinApps.find((app) => app.appId === appId)?.accessLevel).toBe("reader");

    // appId/title default to the template's; existing apps and unknown templates are rejected.
    const triage = templates.find((template) => template.id === "triage");
    const defaulted = await admin.callJsonTool<{ install: AppInstall }>("lotus_admin_install_template", { templateId: "triage" });
    expect(defaulted.install).toMatchObject({ appId: "triage", title: triage?.title });
    await expect(admin.callJsonTool("lotus_admin_install_template", { templateId: "kb", appId })).rejects.toThrow(/409|already exists/);
    await expect(admin.callJsonTool("lotus_admin_install_template", { templateId: "nope", appId: "nope-app" })).rejects.toThrow(/Template not found/);
    expect((await admin.callJsonTool<AppInstall[]>("lotus_admin_list_apps")).map((app) => app.appId)).not.toContain("nope-app");
  });

  test("template install requires a manager session", async ({ apiBaseURL }) => {
    const bob = await connect("admin", apiBaseURL, { username: "bob", password: "password123" });
    expect((await bob.callJsonTool<AppTemplate[]>("lotus_admin_list_templates")).map((template) => template.id)).toContain("kb");
    await expect(bob.callJsonTool("lotus_admin_install_template", { templateId: "kb", appId: "bob-kb" })).rejects.toThrow(/403/);
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
    expect(expenseApp.description).toBeTruthy();
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
