import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LotusClient } from "../lotus-client";
import { asToolResult } from "../tool-result";
import { appIdSchema, jsonObjectSchema } from "./common";

export function registerWorkspaceTools(server: McpServer, client: LotusClient): void {
  server.registerTool(
    "lotus_workspace_get_session",
    {
      title: "Get Lotus Workspace Session",
      description: "Return the current Lotus session state for the configured MCP credentials."
    },
    () => asToolResult(() => client.getSession())
  );

  server.registerTool(
    "lotus_workspace_get_app_definitions",
    {
      title: "Get Workspace Definitions",
      description: "Return app definitions so a workspace agent can discover forms, views, and workflows.",
      inputSchema: appIdSchema
    },
    ({ appId }) => asToolResult(() => client.appDefinitions(appId))
  );

  server.registerTool(
    "lotus_workspace_list_documents",
    {
      title: "List Documents",
      description: "List readable documents by document type.",
      inputSchema: {
        ...appIdSchema,
        docType: z.string().min(1).describe("Document type to list")
      }
    },
    ({ appId, docType }) => asToolResult(() => client.listDocuments(appId, docType))
  );

  server.registerTool(
    "lotus_workspace_query_view",
    {
      title: "Query View",
      description: "Query a view's readable documents, optionally narrowed by search text.",
      inputSchema: {
        ...appIdSchema,
        viewId: z.string().min(1).describe("View design document id, such as view:my-expenses"),
        query: z.string().optional().describe("Optional free-text search query")
      }
    },
    ({ appId, viewId, query }) => asToolResult(() => client.queryView(appId, viewId, query))
  );

  server.registerTool(
    "lotus_workspace_get_document",
    {
      title: "Get Document",
      description: "Fetch one readable business document by id.",
      inputSchema: {
        ...appIdSchema,
        id: z.string().min(1).describe("Business document id")
      }
    },
    ({ appId, id }) => asToolResult(() => client.getDocument(appId, id))
  );

  server.registerTool(
    "lotus_workspace_create_document",
    {
      title: "Create Document",
      description: "Create a business document through the app-scoped API.",
      inputSchema: {
        ...appIdSchema,
        docType: z.string().min(1).describe("Document type to create"),
        payload: jsonObjectSchema.describe("Document payload")
      }
    },
    ({ appId, docType, payload }) => asToolResult(() => client.createDocument(appId, { docType, payload }))
  );

  server.registerTool(
    "lotus_workspace_update_document",
    {
      title: "Update Document",
      description: "Update a business document payload through the app-scoped API.",
      inputSchema: {
        ...appIdSchema,
        id: z.string().min(1).describe("Business document id"),
        payload: jsonObjectSchema.describe("Replacement document payload")
      }
    },
    ({ appId, id, payload }) => asToolResult(() => client.updateDocument(appId, id, { payload }))
  );

  server.registerTool(
    "lotus_workspace_transition_document",
    {
      title: "Transition Document",
      description: "Apply a workflow transition to a business document.",
      inputSchema: {
        ...appIdSchema,
        id: z.string().min(1).describe("Business document id"),
        transition: z.string().min(1).describe("Workflow transition id")
      }
    },
    ({ appId, id, transition }) => asToolResult(() => client.transitionDocument(appId, id, transition))
  );
}

