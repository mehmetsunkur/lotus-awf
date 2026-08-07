import { describe, expect, it } from "vitest";
import { listSampleTemplates, loadSampleTemplate, sampleTemplateDocuments, validateTemplateDefinitions } from "../../src/server/template-registry";
import { seedDocuments } from "../../src/server/seed-data";
import type { BusinessDocument, TemplateArtifact } from "../../src/shared/types";

// ADR-0024: extra readers are declared by an `aclRole:"reader"` computed-once
// field whose formula returns a constant principal list (was `defaultReaders`).
// Returns that list for a form definition, or undefined if the form has none.
function aclReaderList(form: unknown): string[] | undefined {
  const fields = (form as { fields?: Array<{ aclRole?: string; formula?: string }> } | undefined)?.fields ?? [];
  const field = fields.find((candidate) => candidate.aclRole === "reader");
  return field?.formula ? (JSON.parse(field.formula) as string[]) : undefined;
}

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

  it("lists and loads the Org template as design docs plus separate sample data", () => {
    expect(listSampleTemplates()).toEqual(
      expect.arrayContaining([
        {
          templateId: "sample:org",
          appId: "org",
          title: "Org sample",
          description: "Models departments, employees, and reporting lines."
        }
      ])
    );

    const sample = loadSampleTemplate("sample:org");

    expect(sample.template.templateId).toBe("sample:org");
    expect(sample.template.definitions.every((definition) => definition.kind !== "document")).toBe(true);
    expect(sample.template.definitions.map((definition) => definition._id).sort()).toEqual([
      "acl:rules",
      "app:config",
      "audit:policy",
      "form:department",
      "form:employee",
      "view:departments",
      "view:employees"
    ]);
    expect(sample.sampleData.map((doc) => doc._id).sort()).toEqual([
      "doc:department:finance",
      "doc:department:sales",
      "doc:employee:alice",
      "doc:employee:bob"
    ]);
  });

  it("lists and loads the Leave request template as design docs plus separate sample data", () => {
    expect(listSampleTemplates()).toEqual(
      expect.arrayContaining([
        {
          templateId: "sample:leave-request",
          appId: "leave-request",
          title: "Leave request sample",
          description: "Employees file leave requests; managers approve or reject them."
        }
      ])
    );

    const sample = loadSampleTemplate("sample:leave-request");

    expect(sample.template.templateId).toBe("sample:leave-request");
    expect(sample.template.definitions.every((definition) => definition.kind !== "document")).toBe(true);
    expect(sample.template.definitions.map((definition) => definition._id).sort()).toEqual([
      "acl:rules",
      "app:config",
      "audit:policy",
      "form:leave-request",
      "view:my-approvals",
      "view:my-requests",
      "view:pending-approval",
      "workflow:leave-request"
    ]);
    expect(sample.sampleData.map((doc) => doc._id).sort()).toEqual([
      "doc:leave-request:alice-annual",
      "doc:leave-request:bob-sick"
    ]);
    expect(
      sample.sampleData.every((doc) => doc.readers.includes("group:managers") && doc.readers.includes(doc.createdBy))
    ).toBe(true);
  });

  it("lists and loads the Knowledge base template as design docs plus separate sample data", () => {
    expect(listSampleTemplates()).toEqual(
      expect.arrayContaining([
        {
          templateId: "sample:kb",
          appId: "kb",
          title: "Knowledge base sample",
          description: "Handbook articles for everyone; team procedures scoped to the team that wrote them."
        }
      ])
    );

    const sample = loadSampleTemplate("sample:kb");

    expect(sample.template.templateId).toBe("sample:kb");
    expect(sample.template.definitions.every((definition) => definition.kind !== "document")).toBe(true);
    expect(sample.template.definitions.map((definition) => definition._id).sort()).toEqual([
      "acl:rules",
      "app:config",
      "audit:policy",
      "form:article",
      "form:procedure",
      "view:handbook",
      "view:procedures"
    ]);
    expect(sample.sampleData.map((doc) => doc._id)).toEqual(["doc:article:welcome-sample"]);
    // The procedure form deliberately has NO aclRole reader field: procedure visibility
    // comes from the creator's principal set alone (ADR-0024 authorship scoping — M27).
    const procedureForm = sample.template.definitions.find((definition) => definition._id === "form:procedure");
    expect(aclReaderList(procedureForm)).toBeUndefined();
  });

  it("lists and loads the Turnaround template as design docs plus separate sample data", () => {
    expect(listSampleTemplates()).toEqual(
      expect.arrayContaining([
        {
          templateId: "sample:turnaround",
          appId: "turnaround",
          title: "Turnaround sample",
          description: "Flight turnaround operations: a multi-department workflow from scheduling to dispatch."
        }
      ])
    );

    const sample = loadSampleTemplate("sample:turnaround");

    expect(sample.template.templateId).toBe("sample:turnaround");
    expect(sample.template.definitions.map((definition) => definition._id).sort()).toEqual([
      "acl:rules",
      "app:config",
      "audit:policy",
      "form:flight",
      "view:board",
      "view:my-queue",
      "workflow:flight"
    ]);
    expect(sample.sampleData.map((doc) => doc._id)).toEqual(["doc:flight:aa101-sample"]);
    // Flights are readable by the two working departments and deliberately NOT by
    // group:managers, so finance (a managers member) has a real boundary (M27).
    const flightForm = sample.template.definitions.find((definition) => definition._id === "form:flight");
    expect(aclReaderList(flightForm)).toEqual(["group:flight-ops", "group:ground-ops"]);
  });

  it("lists and loads the Agent operations template as design docs plus separate sample data", () => {
    expect(listSampleTemplates()).toEqual(
      expect.arrayContaining([
        {
          templateId: "sample:agent-ops",
          appId: "agent-ops",
          title: "Agent operations sample",
          description: "Agent sessions as documents: request, claim, run, and audit autonomous agent shifts."
        }
      ])
    );

    const sample = loadSampleTemplate("sample:agent-ops");

    expect(sample.template.templateId).toBe("sample:agent-ops");
    expect(sample.template.definitions.map((definition) => definition._id).sort()).toEqual([
      "acl:rules",
      "app:config",
      "audit:policy",
      "form:agent-session",
      "form:artifact",
      "view:artifacts",
      "view:my-sessions",
      "view:sessions",
      "workflow:agent-session"
    ]);
    expect(sample.sampleData.map((doc) => doc._id)).toEqual(["doc:agent-session:sample-draft"]);
    // ADR-0021: sessions carry NO prompt field — prompts are derived from governed
    // company data by the operator, never supplied by a requester. Statically checkable.
    const sessionForm = sample.template.definitions.find((definition) => definition._id === "form:agent-session") as {
      fields?: Array<{ name: string; aclRole?: string }>;
    };
    // The user-supplied inputs are exactly persona + driver (no `prompt`); the trailing
    // aclRole field is a server-computed reader projection, not a requester input.
    expect(sessionForm.fields?.filter((field) => !field.aclRole).map((field) => field.name)).toEqual([
      "persona",
      "driver"
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
