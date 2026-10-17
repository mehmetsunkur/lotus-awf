import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normalizeGroupSlug, normalizePersonPrincipal } from "../../shared/directory";
import { addMembers, findGroup, missingMembers, removeMembers, type PersonPrincipal } from "../directory-members";
import type { LotusClient } from "../lotus-client";
import { asToolResult } from "../tool-result";
import { appIdSchema } from "./common";

const accessEntrySchema = z.object({
  principal: z.string().min(1).describe("person:* or group:* principal"),
  level: z.enum(["reader", "author", "editor", "designer", "manager"])
});

const usernameSchema = z.string().min(1).describe("Lowercase username slug (person:<username>)");
const groupSlugSchema = z.string().min(1).describe("Group slug, e.g. finance (group:<slug>); a group:* principal is also accepted");
const passwordSchema = z
  .string()
  .min(8)
  .describe("SENSITIVE: initial/new password, at least 8 characters. Write-only; never returned by any tool.");
const membersSchema = z
  .array(z.string().regex(/^person:.+/i, "Members must be person:* principals"))
  .describe("person:* principals (direct membership only; nested groups are not supported)");

async function mergeGroupMembers(
  client: LotusClient,
  slug: string,
  members: string[],
  merge: (current: PersonPrincipal[], change: string[]) => PersonPrincipal[]
) {
  const group = findGroup((await client.directory()).groups, slug);
  if (!group) throw new Error(`Group not found: group:${normalizeGroupSlug(slug)}`);
  const result = await client.updateGroup(normalizeGroupSlug(slug), { members: merge(group.members, members) });
  return { group: result.group, directory: result.directory, previousMembers: group.members };
}

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

  // names.nsf directory (ADR-0012). Thin adapters over /api/names/*: the server enforces
  // manager-only writes, member existence, the last-active-admin rule, and sanitized responses.
  server.registerTool(
    "lotus_admin_get_directory",
    {
      title: "Get Directory",
      description: "Return the names.nsf directory: sanitized people (username, displayName, active) and groups (name, person:* members)."
    },
    () => asToolResult(() => client.directory())
  );

  server.registerTool(
    "lotus_admin_create_person",
    {
      title: "Create Person",
      description:
        "Create an active person in the names.nsf directory (manager only). The password is sensitive input and is never returned.",
      inputSchema: {
        username: usernameSchema,
        displayName: z.string().min(1).describe("Human-readable display name"),
        password: passwordSchema
      }
    },
    ({ username, displayName, password }) => asToolResult(() => client.createPerson({ username, displayName, password }))
  );

  server.registerTool(
    "lotus_admin_update_person",
    {
      title: "Update Person",
      description:
        "Update a person's displayName and/or active flag (manager only). Deactivating a person ends all of their sessions — including this MCP session's own if it targets the caller — and the last active admin cannot be deactivated.",
      inputSchema: {
        username: usernameSchema,
        displayName: z.string().min(1).optional().describe("New display name"),
        active: z.boolean().optional().describe("false deactivates the person and revokes their sessions")
      }
    },
    ({ username, displayName, active }) => asToolResult(() => client.updatePerson(username, { displayName, active }))
  );

  server.registerTool(
    "lotus_admin_set_person_password",
    {
      title: "Set Person Password",
      description: "Replace a person's password (manager only). The password is sensitive input and is never returned.",
      inputSchema: {
        username: usernameSchema,
        password: passwordSchema
      }
    },
    ({ username, password }) => asToolResult(() => client.setPersonPassword(username, password))
  );

  server.registerTool(
    "lotus_admin_create_group",
    {
      title: "Create Group",
      description: "Create a group in the names.nsf directory (manager only). Every member must be an existing person.",
      inputSchema: {
        slug: groupSlugSchema,
        name: z.string().min(1).describe("Human-readable group name"),
        members: membersSchema.optional()
      }
    },
    ({ slug, name, members }) => asToolResult(() => client.createGroup({ slug: normalizeGroupSlug(slug), name, members: members?.map(normalizePersonPrincipal) }))
  );

  server.registerTool(
    "lotus_admin_update_group",
    {
      title: "Update Group",
      description:
        "Update a group's name and/or REPLACE its whole members list (manager only). Prefer lotus_admin_add_group_members / lotus_admin_remove_group_members for incremental changes. group:admins must keep at least one active member.",
      inputSchema: {
        slug: groupSlugSchema,
        name: z.string().min(1).optional().describe("New group name"),
        members: membersSchema.optional().describe("Replacement person:* members list")
      }
    },
    ({ slug, name, members }) => asToolResult(() => client.updateGroup(normalizeGroupSlug(slug), { name, members: members?.map(normalizePersonPrincipal) }))
  );

  server.registerTool(
    "lotus_admin_add_group_members",
    {
      title: "Add Group Members",
      description:
        "Add people to a group, keeping existing members (manager only). Reads the group then writes the merged list; last write wins against concurrent edits.",
      inputSchema: {
        slug: groupSlugSchema,
        members: membersSchema.min(1)
      }
    },
    ({ slug, members }) =>
      asToolResult(async () => {
        const { group, directory } = await mergeGroupMembers(client, slug, members, addMembers);
        return { group, directory };
      })
  );

  server.registerTool(
    "lotus_admin_remove_group_members",
    {
      title: "Remove Group Members",
      description:
        "Remove people from a group (manager only). Requested people who were not members are listed in notMembers — check it before assuming a removal happened. group:admins must keep at least one active member. Last write wins against concurrent edits.",
      inputSchema: {
        slug: groupSlugSchema,
        members: membersSchema.min(1)
      }
    },
    ({ slug, members }) =>
      asToolResult(async () => {
        const { previousMembers, ...result } = await mergeGroupMembers(client, slug, members, removeMembers);
        return { ...result, notMembers: missingMembers(previousMembers, members) };
      })
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

