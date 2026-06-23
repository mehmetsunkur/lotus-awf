import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LotusClient } from "./lotus-client";
import { asToolResult } from "./tool-result";
import { validateDesignDefinition } from "../shared/definition-validation";
import { validateTemplateDefinitions } from "../shared/template-validation";
import type { CouchDocument, DesignDocument, TemplateArtifact } from "../shared/types";

const appIdSchema = {
  appId: z.string().min(1).describe("Installed business app id, without the .nsf suffix")
};

export function registerLotusTools(server: McpServer, client: LotusClient): void {
  server.registerTool(
    "lotus_get_session",
    {
      title: "Get Lotus Session",
      description: "Return the current Lotus session state for the configured MCP credentials."
    },
    () => asToolResult(() => client.getSession())
  );

  server.registerTool(
    "lotus_get_platform_state",
    {
      title: "Get Lotus Platform State",
      description: "Return setup state, system apps, installed business apps, samples, and session state."
    },
    () => asToolResult(() => client.platformState())
  );

  server.registerTool(
    "lotus_list_apps",
    {
      title: "List Lotus Apps",
      description: "Return installed business apps from platform state."
    },
    () => asToolResult(async () => {
      const state = await client.platformState();
      return state.installedApps;
    })
  );

  server.registerTool(
    "lotus_get_app_definitions",
    {
      title: "Get App Definitions",
      description: "Return app config, forms, views, workflows, current roles, and access level.",
      inputSchema: appIdSchema
    },
    ({ appId }) => asToolResult(() => client.appDefinitions(appId))
  );

  server.registerTool(
    "lotus_get_workflow",
    {
      title: "Get Workflow",
      description: "Return workflow:<docType> from an installed app.",
      inputSchema: {
        ...appIdSchema,
        docType: z.string().min(1).describe("Document type whose workflow should be returned")
      }
    },
    ({ appId, docType }) => asToolResult(() => client.workflow(appId, docType))
  );

  server.registerTool(
    "lotus_get_workflow_scaffold_options",
    {
      title: "Get Workflow Scaffold Options",
      description: "Return sanitized people and groups that can be selected as approval principals.",
      inputSchema: appIdSchema
    },
    ({ appId }) => asToolResult(() => client.workflowScaffoldOptions(appId))
  );

  server.registerTool(
    "lotus_export_template",
    {
      title: "Export App Template",
      description: "Export current app design definitions as a template artifact.",
      inputSchema: {
        ...appIdSchema,
        version: z.string().optional().describe("Optional template version"),
        source: z.string().optional().describe("Optional source label")
      }
    },
    ({ appId, version, source }) => asToolResult(() => client.exportTemplate(appId, { version, source }))
  );

  server.registerTool(
    "lotus_diff_template",
    {
      title: "Diff App Template",
      description: "Diff a proposed template artifact against the current app definitions.",
      inputSchema: {
        ...appIdSchema,
        template: z.custom<TemplateArtifact>().describe("Template artifact to diff")
      }
    },
    ({ appId, template }) => asToolResult(() => client.diffTemplate(appId, template))
  );

  server.registerTool(
    "lotus_validate_definition",
    {
      title: "Validate Definition",
      description: "Validate a single Lotus design definition locally using shared validation.",
      inputSchema: {
        definition: z.custom<DesignDocument>().describe("Design definition to validate")
      }
    },
    ({ definition }) => asToolResult(async () => {
      const errors = validateDesignDefinition(definition as CouchDocument);
      return { ok: errors.length === 0, errors };
    })
  );

  server.registerTool(
    "lotus_validate_template",
    {
      title: "Validate Template",
      description: "Validate a Lotus template artifact locally using shared template validation.",
      inputSchema: {
        template: z.custom<TemplateArtifact>().describe("Template artifact to validate")
      }
    },
    ({ template }) => asToolResult(async () => {
      const errors = validateTemplateDefinitions(template);
      return { ok: errors.length === 0, errors };
    })
  );

  server.registerTool(
    "lotus_create_document_type",
    {
      title: "Create Document Type",
      description: "Create a new document type by scaffolding its form and list view through the app-scoped API.",
      inputSchema: {
        ...appIdSchema,
        docType: z.string().min(1).describe("Lowercase document type slug"),
        title: z.string().min(1).describe("Human-readable document type title")
      }
    },
    ({ appId, docType, title }) => asToolResult(() => client.createDocumentType(appId, { docType, title }))
  );

  server.registerTool(
    "lotus_scaffold_approval_workflow",
    {
      title: "Scaffold Approval Workflow",
      description: "Create the standard approval workflow and worklist views for an existing document type.",
      inputSchema: {
        ...appIdSchema,
        docType: z.string().min(1).describe("Existing document type slug"),
        approverPrincipal: z.string().min(1).describe("person:* or group:* principal that can approve/reject")
      }
    },
    ({ appId, docType, approverPrincipal }) =>
      asToolResult(() => client.scaffoldApprovalWorkflow(appId, { docType, approverPrincipal }))
  );
}
