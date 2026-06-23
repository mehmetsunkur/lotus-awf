import { validateDesignDefinition } from "./definition-validation";
import { validateTemplateArtifact } from "./template";
import type { AclRules, AppConfig, TemplateArtifact } from "./types";

function validateAppDefinition(definition: AppConfig): string[] {
  const messages: string[] = [];
  if (definition._id !== "app:config") messages.push("app definition id must be app:config");
  if (!definition.appId?.trim()) messages.push("app:config appId is required");
  if (!definition.title?.trim()) messages.push("app:config title is required");
  if (!definition.database?.trim()) messages.push("app:config database is required");
  return messages;
}

function validateAclDefinition(definition: AclRules): string[] {
  const messages: string[] = [];
  if (definition._id !== "acl:rules") messages.push("acl definition id must be acl:rules");
  if (!definition.appId?.trim()) messages.push("acl:rules appId is required");
  if (!Array.isArray(definition.entries)) messages.push("acl:rules entries must be an array");
  for (const [index, entry] of (definition.entries ?? []).entries()) {
    if (!entry.principal?.trim()) messages.push(`acl:rules entries.${index}.principal is required`);
    if (!entry.level?.trim()) messages.push(`acl:rules entries.${index}.level is required`);
  }
  return messages;
}

export function validateTemplateDefinitions(template: TemplateArtifact): string[] {
  const messages = validateTemplateArtifact(template);
  for (const definition of template.definitions ?? []) {
    if ("_rev" in definition) messages.push(`${definition._id} must not include _rev`);
    if (
      definition.kind === "form" ||
      definition.kind === "view" ||
      definition.kind === "workflow" ||
      definition.kind === "agent" ||
      definition.kind === "auditpolicy"
    ) {
      messages.push(...validateDesignDefinition(definition).map((error) => `${definition._id}.${error.field}: ${error.message}`));
    } else if (definition.kind === "app") {
      messages.push(...validateAppDefinition(definition));
    } else if (definition.kind === "acl") {
      messages.push(...validateAclDefinition(definition));
    } else {
      messages.push(`${(definition as { _id?: string })._id ?? "unknown"} kind is not template-eligible`);
    }
  }
  return messages;
}
