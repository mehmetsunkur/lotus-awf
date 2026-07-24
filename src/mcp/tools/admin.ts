import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LotusClient } from "../lotus-client";
import { asToolResult } from "../tool-result";
import { appIdSchema } from "./common";

const accessEntrySchema = z.object({
  principal: z.string().min(1).describe("person:* or group:* principal"),
  level: z.enum(["reader", "author", "editor", "designer", "manager"])
});

export function registerAdminTools(server: McpServer, client: LotusClient): void {
  server.registerTool(
    "lotus_admin_get_session",
    {
      title: "Get Lotus Admin Session",
      description: "Return the current Lotus session state for the configured MCP credentials."
    },
    () => asToolResult(() => client.getSession())
  );

  server.registerTool(
    "lotus_admin_get_platform_state",
    {
      title: "Get Lotus Platform State",
      description: "Return setup state, system apps, installed business apps, samples, and session state."
    },
    () => asToolResult(() => client.platformState())
  );

  server.registerTool(
    "lotus_admin_list_apps",
    {
      title: "List Lotus Apps",
      description:
        "Return installed business apps from platform state, including each app's id, title, and a short purpose blurb (description) when the app defines one."
    },
    () => asToolResult(async () => {
      const state = await client.platformState();
      return state.installedApps;
    })
  );

  server.registerTool(
    "lotus_admin_create_app",
    {
      title: "Create Lotus App",
      description: "Create a new business app with starter metadata through the platform catalog API.",
      inputSchema: {
        appId: z.string().min(1).describe("Lowercase app id slug"),
        title: z.string().min(1).describe("Human-readable app title"),
        docType: z.string().min(1).describe("Starter document type slug"),
        docTypeTitle: z.string().min(1).describe("Starter document type title")
      }
    },
    ({ appId, title, docType, docTypeTitle }) =>
      asToolResult(() => client.createApp({ appId, title, docType, docTypeTitle }))
  );

  server.registerTool(
    "lotus_admin_get_app_access",
    {
      title: "Get App Access",
      description: "Return app ACL entries and sanitized directory people/groups.",
      inputSchema: appIdSchema
    },
    ({ appId }) => asToolResult(() => client.appAccess(appId))
  );

  server.registerTool(
    "lotus_admin_update_app_access",
    {
      title: "Update App Access",
      description: "Replace app ACL entries through the app-scoped access API.",
      inputSchema: {
        ...appIdSchema,
        entries: z.array(accessEntrySchema).describe("Replacement app ACL entries")
      }
    },
    ({ appId, entries }) => asToolResult(() => client.updateAppAccess(appId, { entries }))
  );
}

