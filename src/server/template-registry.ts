import fs from "node:fs";
import path from "node:path";
import { normalizeDefinitions } from "../shared/template";
import { validateTemplateDefinitions } from "../shared/template-validation";
import type {
  BusinessDocument,
  DesignDocument,
  TemplateArtifact
} from "../shared/types";

type SampleTemplateFiles = {
  templatePath: string;
  sampleDataPath: string;
  /** App this template installs as, and its catalog metadata. Drives the generic
   *  install endpoint and the platform `samples[]` list — no per-app base code. */
  appId: string;
  title: string;
  description: string;
};

export type SampleTemplateInfo = {
  templateId: string;
  appId: string;
  title: string;
  description: string;
};

export type SampleTemplate = {
  template: TemplateArtifact;
  sampleData: BusinessDocument[];
};

export { validateTemplateDefinitions };

const SAMPLE_TEMPLATES: Record<string, SampleTemplateFiles> = {
  "sample:expense": {
    templatePath: "templates/expense/template.json",
    sampleDataPath: "templates/expense/sample-data.json",
    appId: "expense",
    title: "Expense sample",
    description: "A sample approval app with forms, views, workflow, agents, search, and audit."
  },
  "sample:org": {
    templatePath: "templates/org/template.json",
    sampleDataPath: "templates/org/sample-data.json",
    appId: "org",
    title: "Org sample",
    description: "Models departments, employees, and reporting lines."
  },
  "sample:leave-request": {
    templatePath: "templates/leave-request/template.json",
    sampleDataPath: "templates/leave-request/sample-data.json",
    appId: "leave-request",
    title: "Leave request sample",
    description: "Employees file leave requests; managers approve or reject them."
  }
};

/** Catalog metadata for every registered sample — drives the generic install
 *  endpoint and platform `samples[]` without hardcoding any app in base logic. */
export function listSampleTemplates(): SampleTemplateInfo[] {
  return Object.entries(SAMPLE_TEMPLATES).map(([templateId, files]) => ({
    templateId,
    appId: files.appId,
    title: files.title,
    description: files.description
  }));
}

/** Resolve a sample by the app id it installs as (e.g. "expense" → "sample:expense"). */
export function sampleTemplateForApp(appId: string): SampleTemplateInfo | undefined {
  return listSampleTemplates().find((sample) => sample.appId === appId);
}

const projectPath = (relativePath: string) => path.resolve(process.cwd(), relativePath);

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validationError(source: string, messages: string[]): Error {
  return new Error(`${source} is invalid:\n${messages.map((message) => `- ${message}`).join("\n")}`);
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
