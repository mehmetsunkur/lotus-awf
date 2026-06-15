import type { DesignDocument, TemplateArtifact, TemplateDiff, TemplateDiffEntry } from "./types";

export function stripDefinitionRev<T extends DesignDocument>(definition: T): T {
  const { _rev, ...rest } = definition;
  return rest as T;
}

export function sortDefinitions(definitions: DesignDocument[]): DesignDocument[] {
  return [...definitions].sort((left, right) => left._id.localeCompare(right._id));
}

export function normalizeDefinitions(definitions: DesignDocument[]): DesignDocument[] {
  return sortDefinitions(definitions).map(stripDefinitionRev);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "_rev")
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function diffEntry(definition: DesignDocument): TemplateDiffEntry {
  return { id: definition._id, kind: definition.kind };
}

export function diffTemplateDefinitions(
  currentDefinitions: DesignDocument[],
  templateDefinitions: DesignDocument[]
): TemplateDiff {
  const current = new Map(normalizeDefinitions(currentDefinitions).map((definition) => [definition._id, definition]));
  const template = new Map(normalizeDefinitions(templateDefinitions).map((definition) => [definition._id, definition]));

  const added: TemplateDiffEntry[] = [];
  const removed: TemplateDiffEntry[] = [];
  const changed: TemplateDiffEntry[] = [];
  const unchanged: TemplateDiffEntry[] = [];

  for (const definition of template.values()) {
    const existing = current.get(definition._id);
    if (!existing) {
      added.push(diffEntry(definition));
    } else if (stableJson(existing) === stableJson(definition)) {
      unchanged.push(diffEntry(definition));
    } else {
      changed.push(diffEntry(definition));
    }
  }

  for (const definition of current.values()) {
    if (!template.has(definition._id)) removed.push(diffEntry(definition));
  }

  return { added, removed, changed, unchanged };
}

export function validateTemplateArtifact(template: TemplateArtifact): string[] {
  const errors: string[] = [];
  if (template.kind !== "template") errors.push("kind must be template");
  if (!template.appId?.trim()) errors.push("appId is required");
  if (!template.version?.trim()) errors.push("version is required");
  if (!template.templateId?.trim()) errors.push("templateId is required");
  if (!Array.isArray(template.definitions) || !template.definitions.length) {
    errors.push("definitions must contain at least one definition");
    return errors;
  }

  const ids = new Set<string>();
  for (const definition of template.definitions) {
    if (!definition?._id) {
      errors.push("definition _id is required");
      continue;
    }
    if (ids.has(definition._id)) errors.push(`duplicate definition id: ${definition._id}`);
    ids.add(definition._id);
    if (definition.kind !== "app" && definition.kind !== "acl" && definition.appId !== template.appId) {
      errors.push(`${definition._id} appId must match template appId`);
    }
  }
  return errors;
}
