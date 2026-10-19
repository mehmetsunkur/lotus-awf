import { describe, expect, it } from "vitest";
import {
  listSampleTemplates,
  loadSampleTemplate,
  sampleTemplateDocuments,
  validateSampleDocument,
  validateTemplateDefinitions
} from "../../src/server/template-registry";
import { seedDocuments } from "../../src/server/seed-data";
import type { BusinessDocument, TemplateArtifact } from "../../src/shared/types";

// ADR-0026: document visibility is the app ACL. Returns the principals holding an
// app ACL entry in a template's `acl:rules` definition.
function aclPrincipals(definitions: unknown[]): string[] {
  const rules = definitions.find((definition) => (definition as { _id?: string })._id === "acl:rules") as
    | { entries?: Array<{ principal: string }> }
    | undefined;
  return (rules?.entries ?? []).map((entry) => entry.principal);
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
    expect(sample.sampleData.every((doc) => doc.authors.includes(doc.createdBy))).toBe(true);
  });

  it("lists and loads the Knowledge base template as design docs plus separate sample data", () => {
    expect(listSampleTemplates()).toEqual(
      expect.arrayContaining([
        {
          templateId: "sample:kb",
          appId: "kb",
          title: "Knowledge base sample",
          description: "Handbook articles and team procedures for everyone with access to the app."
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
    // group:managers, so finance (a managers member) has a real boundary (M27) —
    // since ADR-0026 that boundary is the app ACL itself.
    const principals = aclPrincipals(sample.template.definitions);
    expect(principals).toEqual(expect.arrayContaining(["group:flight-ops", "group:ground-ops"]));
    expect(principals).not.toContain("group:managers");
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

  it("lists and loads the Triage board template as design docs plus separate sample data", () => {
    expect(listSampleTemplates()).toEqual(
      expect.arrayContaining([
        {
          templateId: "sample:triage",
          appId: "triage",
          title: "Triage board sample",
          description:
            "A pooled support backlog: the triage team owns the queue collectively; a member claims a ticket to become its individual owner (ADR-0025 responsible vs. assignee)."
        }
      ])
    );

    const sample = loadSampleTemplate("sample:triage");

    expect(sample.template.templateId).toBe("sample:triage");
    expect(sample.template.definitions.every((definition) => definition.kind !== "document")).toBe(true);
    expect(sample.template.definitions.map((definition) => definition._id).sort()).toEqual([
      "acl:rules",
      "app:config",
      "audit:policy",
      "form:ticket",
      "view:all-tickets",
      "view:backlog",
      "view:my-work",
      "view:team-queue",
      "workflow:ticket"
    ]);
    expect(sample.sampleData.map((doc) => doc._id).sort()).toEqual([
      "doc:ticket:sample-backlog",
      "doc:ticket:sample-new"
    ]);
    // ADR-0025: the pool/individual split lives on the workflow states — `backlog`
    // declares only the standing responsibility; `in-progress` adds the individual
    // (assigneeFormula) and is fail-closed (requireAssignee). Statically checkable.
    const workflow = sample.template.definitions.find((definition) => definition._id === "workflow:ticket") as {
      states: Array<{ name: string; responsibleFormula?: string; assigneeFormula?: string; requireAssignee?: boolean }>;
    };
    const backlog = workflow.states.find((state) => state.name === "backlog");
    expect(backlog?.responsibleFormula).toBe('"group:triage"');
    expect(backlog?.assigneeFormula).toBeUndefined();
    const inProgress = workflow.states.find((state) => state.name === "in-progress");
    expect(inProgress?.responsibleFormula).toBe('"group:triage"');
    expect(inProgress?.assigneeFormula).toBe("user");
    expect(inProgress?.requireAssignee).toBe(true);
    // The three ADR-0025 §5 worklist views plus an all-tickets overview.
    const filterField = (viewId: string, field: string) => {
      const view = sample.template.definitions.find((definition) => definition._id === viewId) as {
        filters: Array<{ field: string; op: string; value: unknown }>;
      };
      return view.filters.find((filter) => filter.field === field);
    };
    expect(filterField("view:team-queue", "responsible")).toEqual({ field: "responsible", op: "in", value: "@me" });
    expect(filterField("view:my-work", "assignee")).toEqual({ field: "assignee", op: "in", value: "@me" });
    expect(filterField("view:backlog", "state")).toEqual({ field: "state", op: "eq", value: "backlog" });
    expect(filterField("view:backlog", "responsible")).toEqual({ field: "responsible", op: "in", value: "@me" });
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

describe("ADR-0026: templates carry no per-document readers", () => {
  it("no sample document has readers and no form declares an aclRole reader field", () => {
    for (const { templateId } of listSampleTemplates()) {
      const sample = loadSampleTemplate(templateId);
      expect(sample.sampleData.every((doc) => !("readers" in doc)), templateId).toBe(true);
      const fields = sample.template.definitions.flatMap(
        (definition) => ((definition as { fields?: Array<{ aclRole?: string }> }).fields ?? [])
      );
      expect(fields.some((field) => (field.aclRole as string | undefined) === "reader"), templateId).toBe(false);
    }
  });

  it("rejects template sample data that carries readers", () => {
    const sample = loadSampleTemplate("sample:expense");
    expect(validateSampleDocument(sample.sampleData[0], 0, sample.template.appId)).toEqual([]);
    const tainted = { ...sample.sampleData[0], readers: ["group:finance"] } as unknown as BusinessDocument;
    expect(validateSampleDocument(tainted, 0, sample.template.appId)).toContain(
      "sampleData.0 must not include readers (ADR-0026)"
    );
  });
});
