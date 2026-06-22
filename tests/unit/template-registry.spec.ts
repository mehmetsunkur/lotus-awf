import { describe, expect, it } from "vitest";
import { loadSampleTemplate, sampleTemplateDocuments, validateTemplateDefinitions } from "../../src/server/template-registry";
import { seedDocuments } from "../../src/server/seed-data";
import type { BusinessDocument, TemplateArtifact } from "../../src/shared/types";

describe("sample template registry", () => {
  it("loads the Expense template as design docs plus separate sample data", () => {
    const sample = loadSampleTemplate("sample:expense");

    expect(sample.template.templateId).toBe("sample:expense");
    expect(sample.template.definitions.every((definition) => definition.kind !== "document")).toBe(true);
    expect(sample.sampleData).toHaveLength(5);
    expect(sample.sampleData.every((doc) => doc.kind === "document")).toBe(true);
    expect(sample.sampleData.map((doc) => doc._id).sort()).toEqual([
      "doc:expense:client-dinner",
      "doc:expense:stationery",
      "doc:expense:train-ticket",
      "doc:vendor:national-rail",
      "doc:vendor:paper-market"
    ]);
  });

  it("keeps seedDocuments compatible with the JSON sample artifacts", () => {
    expect(seedDocuments()).toEqual(sampleTemplateDocuments("sample:expense"));
  });

  it("rejects business documents in a design template", () => {
    const sample = loadSampleTemplate("sample:expense");
    const businessDoc = sample.sampleData[0] as unknown as TemplateArtifact["definitions"][number];
    const invalid = {
      ...sample.template,
      definitions: [...sample.template.definitions, businessDoc]
    };

    expect(validateTemplateDefinitions(invalid)).toContain("doc:expense:stationery kind is not template-eligible");
  });

  it("rejects runtime data in a design template", () => {
    const sample = loadSampleTemplate("sample:expense");
    const invalid = {
      ...sample.template,
      definitions: [
        ...sample.template.definitions,
        {
          _id: "agent:state",
          kind: "agentstate",
          appId: "expense",
          lastSeq: "0",
          lastRunAt: {}
        }
      ]
    } as unknown as TemplateArtifact;

    expect(validateTemplateDefinitions(invalid)).toContain("agent:state kind is not template-eligible");
  });

  it("rejects stale CouchDB revisions in template definitions", () => {
    const sample = loadSampleTemplate("sample:expense");
    const invalid: TemplateArtifact = {
      ...sample.template,
      definitions: [{ ...sample.template.definitions[0], _rev: "1-stale" }]
    };

    expect(validateTemplateDefinitions(invalid)).toContain("acl:rules must not include _rev");
  });

  it("keeps sample data out of template export shape", () => {
    const docs = sampleTemplateDocuments("sample:expense");
    const businessDocs = docs.filter((doc): doc is BusinessDocument => doc.kind === "document");
    const designDocs = docs.filter((doc) => doc.kind !== "document");

    expect(designDocs).toHaveLength(12);
    expect(businessDocs).toHaveLength(5);
  });
});
