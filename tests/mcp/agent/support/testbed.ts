import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diffTemplateDefinitions } from "../../../../src/shared/template";
import { validateTemplateDefinitions } from "../../../../src/shared/template-validation";
import type { DesignDocument, TemplateArtifact, TemplateDiff, TemplateDiffEntry } from "../../../../src/shared/types";
import type { LotusHttpMcpClient } from "../../http/support/http-client";
import type { AgentDiagnostics } from "../../../../src/operator/diagnostics";

export type AppTemplateFixture = {
  fixtureId: string;
  sourceTemplate: TemplateArtifact;
  appId: string;
  title: string;
  starterDocType: string;
  starterDocTypeTitle: string;
};

export type ExpectedTemplateDiff = {
  added?: string[];
  changed?: string[];
  removed?: string[];
};

type TemplateBeforeSnapshot = { exists: true; template: TemplateArtifact } | { exists: false; appId: string; error: string };
type TemplateValidationResult = { ok: boolean; errors: string[] };

type DefinitionWithAppId = DesignDocument & { appId?: string };

export function loadTemplateFixture(path: string): TemplateArtifact {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as TemplateArtifact;
}

export function rewriteTemplateForApp(fixture: AppTemplateFixture): TemplateArtifact {
  const database = databaseForAppId(fixture.appId);
  return {
    ...fixture.sourceTemplate,
    templateId: `${fixture.appId}:fixture:${fixture.fixtureId}`,
    appId: fixture.appId,
    version: "fixture",
    source: `agent-fixture:${fixture.fixtureId}`,
    definitions: fixture.sourceTemplate.definitions.map((definition) => rewriteDefinition(definition, fixture.appId, database))
  };
}

export async function installTemplateFixture(
  admin: LotusHttpMcpClient,
  designer: LotusHttpMcpClient,
  fixture: AppTemplateFixture
): Promise<TemplateArtifact> {
  await admin.callJsonTool("lotus_admin_create_app", {
    appId: fixture.appId,
    title: fixture.title,
    docType: fixture.starterDocType,
    docTypeTitle: fixture.starterDocTypeTitle
  });

  const template = rewriteTemplateForApp(fixture);
  const validation = validateTemplateDefinitions(template);
  if (validation.length) {
    throw new Error(`Fixture ${fixture.fixtureId} is invalid after rewrite: ${validation.join("; ")}`);
  }
  await designer.callJsonTool("lotus_designer_apply_template", { appId: fixture.appId, template });
  return template;
}

export async function tryExportTemplate(
  designer: LotusHttpMcpClient,
  diagnostics: AgentDiagnostics,
  appId: string,
  phase: "before" | "after"
): Promise<TemplateBeforeSnapshot> {
  try {
    const template = await designer.callJsonTool<TemplateArtifact>("lotus_designer_export_template", {
      appId,
      version: `${phase}-${diagnostics.runId}`,
      source: `mcp-agent-${phase}`
    });
    diagnostics.writeJson(`template-${phase}-${appId}.json`, phase === "before" ? "template_before" : "template_after", template, {
      attach: "always"
    });
    return { exists: true, template };
  } catch (error) {
    const marker = { exists: false, appId, error: error instanceof Error ? error.message : String(error) };
    diagnostics.writeJson(`template-${phase}-${appId}.json`, phase === "before" ? "template_before" : "template_after", marker, {
      attach: "always"
    });
    return marker;
  }
}

export async function exportValidateAndDiffTemplate(
  designer: LotusHttpMcpClient,
  diagnostics: AgentDiagnostics,
  appId: string,
  before: TemplateBeforeSnapshot
): Promise<{ after: TemplateArtifact; diff: TemplateDiff; validation: TemplateValidationResult }> {
  const after = await designer.callJsonTool<TemplateArtifact>("lotus_designer_export_template", {
    appId,
    version: `after-${diagnostics.runId}`,
    source: "mcp-agent-after"
  });
  diagnostics.writeJson(`template-after-${appId}.json`, "template_after", after, { attach: "always" });

  const validation = await designer.callJsonTool<TemplateValidationResult>("lotus_designer_validate_template", {
    template: after
  });
  diagnostics.writeJson(`template-validation-${appId}.json`, "template_validation", validation, { attach: "always" });

  const diff = before.exists ? diffTemplateDefinitions(before.template.definitions, after.definitions) : allAddedDiff(after.definitions);
  diagnostics.writeJson(
    `template-diff-${appId}.json`,
    "template_diff",
    {
      appId,
      beforeExists: before.exists,
      diff
    },
    { attach: "always" }
  );
  return { after, diff, validation };
}

export function assertTemplateDiff(diff: TemplateDiff, expected: ExpectedTemplateDiff): void {
  const actual = {
    added: ids(diff.added),
    changed: ids(diff.changed),
    removed: ids(diff.removed)
  };
  const wanted = {
    added: sorted(expected.added ?? []),
    changed: sorted(expected.changed ?? []),
    removed: sorted(expected.removed ?? [])
  };
  for (const key of ["added", "changed", "removed"] as const) {
    if (actual[key].join("\n") !== wanted[key].join("\n")) {
      throw new Error(
        `Unexpected template diff ${key}: expected ${JSON.stringify(wanted[key])}, received ${JSON.stringify(actual[key])}`
      );
    }
  }
}

function rewriteDefinition(definition: DesignDocument, appId: string, database: string): DesignDocument {
  if (definition.kind === "app") {
    return { ...definition, appId, database };
  }
  if ("appId" in definition) {
    return { ...(definition as DefinitionWithAppId), appId } as DesignDocument;
  }
  return definition;
}

function databaseForAppId(appId: string): string {
  return `${appId.replace(/-/g, "_")}_app`;
}

function allAddedDiff(definitions: DesignDocument[]): TemplateDiff {
  return { added: definitions.map(diffEntry), removed: [], changed: [], unchanged: [] };
}

function diffEntry(definition: DesignDocument): TemplateDiffEntry {
  return { id: definition._id, kind: definition.kind };
}

function ids(entries: TemplateDiffEntry[]): string[] {
  return sorted(entries.map((entry) => entry.id));
}

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}
