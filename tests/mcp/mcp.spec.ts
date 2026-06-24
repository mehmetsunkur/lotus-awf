import { test, expect } from "@playwright/test";
import { connectLotusMcp, type LotusMcpTestClient } from "./support/mcp-client";
import type { AppInstall, PlatformState, SessionState, TemplateArtifact, WorkflowDefinition } from "../../src/shared/types";

type DefinitionsResponse = {
  forms: Array<{ _id: string; docType: string }>;
  views: Array<{ _id: string; docType: string }>;
  workflows: WorkflowDefinition[];
  accessLevel: string;
};

test.describe("Lotus MCP server", () => {
  let mcp: LotusMcpTestClient;

  test.beforeEach(async ({ request }) => {
    const reset = await request.post("http://localhost:3001/api/reset");
    expect(reset.ok()).toBeTruthy();
    mcp = await connectLotusMcp();
  });

  test.afterEach(async () => {
    await mcp?.close();
  });

  test("authenticates and performs workflow design operations through MCP", async () => {
    const tools = await mcp.listTools();
    expect(tools).toContain("lotus_get_session");
    expect(tools).toContain("lotus_apply_workflow_patch");

    const session = await mcp.callJsonTool<SessionState>("lotus_get_session");
    expect(session.authenticated).toBe(true);
    expect(session.person?.username).toBe("alice");

    const apps = await mcp.callJsonTool<AppInstall[]>("lotus_list_apps");
    expect(apps.map((app) => app.appId)).toContain("expense");

    const platform = await mcp.callJsonTool<PlatformState>("lotus_get_platform_state");
    expect(platform.setupComplete).toBe(true);

    const definitions = await mcp.callJsonTool<DefinitionsResponse>("lotus_get_app_definitions", { appId: "expense" });
    expect(definitions.accessLevel).toBe("manager");
    expect(definitions.forms.map((form) => form._id)).toContain("form:expense");

    const createdType = await mcp.callJsonTool<{ form: { _id: string }; view: { _id: string } }>(
      "lotus_create_document_type",
      {
        appId: "expense",
        docType: "inspection",
        title: "Inspection"
      }
    );
    expect(createdType.form._id).toBe("form:inspection");
    expect(createdType.view._id).toBe("view:inspection");

    const scaffold = await mcp.callJsonTool<{ workflow: WorkflowDefinition; views: Array<{ _id: string }> }>(
      "lotus_scaffold_approval_workflow",
      {
        appId: "expense",
        docType: "inspection",
        approverPrincipal: "group:finance"
      }
    );
    expect(scaffold.workflow._id).toBe("workflow:inspection");
    expect(scaffold.views.map((view) => view._id)).toContain("view:inspection-submitted");

    const preview = await mcp.callJsonTool<{ ok: boolean; workflow: WorkflowDefinition; summary: string[] }>(
      "lotus_preview_workflow_patch",
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
      "lotus_apply_workflow_patch",
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

    const template = await mcp.callJsonTool<TemplateArtifact>("lotus_export_template", {
      appId: "expense",
      source: "mcp-e2e"
    });
    const workflow = template.definitions.find((definition): definition is WorkflowDefinition =>
      definition._id === "workflow:inspection" && definition.kind === "workflow"
    );
    expect(workflow?.states.map((state) => state.name)).toContain("archived");
    expect(workflow?.transitions.map((transition) => transition.id)).toContain("archive");
  });
});
