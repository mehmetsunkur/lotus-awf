import fs from "node:fs";
import path from "node:path";
import { validateDesignDefinition } from "../shared/definition-validation";
import {
  normalizeDefinitions,
  validateTemplateArtifact
} from "../shared/template";
import type {
  AclRules,
  AppConfig,
  BusinessDocument,
  DesignDocument,
  TemplateArtifact
} from "../shared/types";

type SampleTemplateFiles = {
  templatePath: string;
  sampleDataPath: string;
};

export type SampleTemplate = {
  template: TemplateArtifact;
  sampleData: BusinessDocument[];
};

const SAMPLE_TEMPLATES: Record<string, SampleTemplateFiles> = {
  "sample:expense": {
    templatePath: "templates/expense/template.json",
    sampleDataPath: "templates/expense/sample-data.json"
  }
};

const projectPath = (relativePath: string) => path.resolve(process.cwd(), relativePath);

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validationError(source: string, messages: string[]): Error {
  return new Error(`${source} is invalid:\n${messages.map((message) => `- ${message}`).join("\n")}`);
}

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
  if (!Array.isArray(definition.users)) messages.push("acl:rules users must be an array");
  for (const [index, user] of (definition.users ?? []).entries()) {
    if (!user.user?.trim()) messages.push(`acl:rules users.${index}.user is required`);
    if (!Array.isArray(user.roles)) messages.push(`acl:rules users.${index}.roles must be an array`);
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

function validateTemplateFile(template: TemplateArtifact, source: string): TemplateArtifact {
  const messages = validateTemplateDefinitions(template);
  if (messages.length) throw validationError(source, messages);
  return {
    ...template,
    definitions: normalizeDefinitions(template.definitions)
  };
}

function validateSampleDocument(doc: BusinessDocument, index: number, appId: string): string[] {
  const prefix = `sampleData.${index}`;
  const messages: string[] = [];
  if (!doc._id?.startsWith(`doc:${doc.docType}:`)) messages.push(`${prefix} _id must start with doc:<docType>:`);
  if (doc.kind !== "document") messages.push(`${prefix} kind must be document`);
  if (doc.appId !== appId) messages.push(`${prefix} appId must match template appId`);
  if (!doc.docType?.trim()) messages.push(`${prefix} docType is required`);
  if (!doc.createdAt?.trim()) messages.push(`${prefix} createdAt is required`);
  if (!doc.updatedAt?.trim()) messages.push(`${prefix} updatedAt is required`);
  if (!doc.createdBy?.trim()) messages.push(`${prefix} createdBy is required`);
  if (!doc.updatedBy?.trim()) messages.push(`${prefix} updatedBy is required`);
  if (!Array.isArray(doc.readers)) messages.push(`${prefix} readers must be an array`);
  if (!Array.isArray(doc.authors)) messages.push(`${prefix} authors must be an array`);
  if (!doc.payload || typeof doc.payload !== "object" || Array.isArray(doc.payload)) {
    messages.push(`${prefix} payload must be an object`);
  }
  if ("_rev" in doc) messages.push(`${prefix} must not include _rev`);
  return messages;
}

function stripBusinessRev(doc: BusinessDocument): BusinessDocument {
  const { _rev, ...rest } = doc;
  return rest as BusinessDocument;
}

function validateSampleData(value: unknown, source: string, appId: string): BusinessDocument[] {
  if (!Array.isArray(value)) throw validationError(source, ["sample data must be an array"]);
  const docs = value as BusinessDocument[];
  const messages = docs.flatMap((doc, index) => validateSampleDocument(doc, index, appId));
  if (messages.length) throw validationError(source, messages);
  return docs.map(stripBusinessRev);
}

export function loadSampleTemplate(templateId: string): SampleTemplate {
  const files = SAMPLE_TEMPLATES[templateId];
  if (!files) throw new Error(`Unknown sample template: ${templateId}`);

  const templatePath = projectPath(files.templatePath);
  const sampleDataPath = projectPath(files.sampleDataPath);
  const template = validateTemplateFile(readJsonFile(templatePath) as TemplateArtifact, files.templatePath);
  const sampleData = validateSampleData(readJsonFile(sampleDataPath), files.sampleDataPath, template.appId);
  return { template, sampleData };
}

export function sampleTemplateDocuments(templateId: string): Array<DesignDocument | BusinessDocument> {
  const { template, sampleData } = loadSampleTemplate(templateId);
  return [...template.definitions, ...sampleData];
}
