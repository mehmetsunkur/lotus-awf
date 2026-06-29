import { describe, expect, it } from "vitest";
import {
  diffTemplateDefinitions,
  normalizeDefinitions,
  sortDefinitions,
  stripDefinitionRev,
  validateTemplateArtifact
} from "../../src/shared/template";
import type { DesignDocument, FormDefinition, TemplateArtifact } from "../../src/shared/types";

const form = (id: string, overrides: Partial<FormDefinition> = {}): FormDefinition => ({
  _id: `form:${id}`,
  kind: "form",
  appId: "expense",
  docType: id,
  title: id,
  fields: [],
  ...overrides
});

const artifact = (overrides: Partial<TemplateArtifact> = {}): TemplateArtifact => ({
  kind: "template",
  templateId: "expense@1",
  appId: "expense",
  version: "1",
  createdAt: "2026-06-29T00:00:00.000Z",
  createdBy: "alice",
  source: "expense",
  definitions: [form("expense")],
  ...overrides
});

describe("stripDefinitionRev", () => {
  it("removes _rev and leaves the rest intact", () => {
    const stripped = stripDefinitionRev(form("expense", { _rev: "2-abc" }));
    expect(stripped).not.toHaveProperty("_rev");
    expect(stripped._id).toBe("form:expense");
  });
});

describe("sortDefinitions / normalizeDefinitions", () => {
  it("sorts by _id without mutating the input array", () => {
    const input = [form("b"), form("a")];
    expect(sortDefinitions(input).map((d) => d._id)).toEqual(["form:a", "form:b"]);
    expect(input.map((d) => d._id)).toEqual(["form:b", "form:a"]);
  });
  it("normalize sorts and strips revs together", () => {
    const normalized = normalizeDefinitions([form("b", { _rev: "1-x" }), form("a", { _rev: "1-y" })]);
    expect(normalized.map((d) => d._id)).toEqual(["form:a", "form:b"]);
    expect(normalized.every((d) => !("_rev" in d))).toBe(true);
  });
});

describe("diffTemplateDefinitions", () => {
  it("classifies added, removed, changed, and unchanged definitions", () => {
    const current: DesignDocument[] = [
      form("kept"),
      form("gone"),
      form("edit", { title: "old" })
    ];
    const template: DesignDocument[] = [
      form("kept"),
      form("edit", { title: "new" }),
      form("fresh")
    ];

    const diff = diffTemplateDefinitions(current, template);
    expect(diff.added.map((e) => e.id)).toEqual(["form:fresh"]);
    expect(diff.removed.map((e) => e.id)).toEqual(["form:gone"]);
    expect(diff.changed.map((e) => e.id)).toEqual(["form:edit"]);
    expect(diff.unchanged.map((e) => e.id)).toEqual(["form:kept"]);
  });

  it("ignores _rev when deciding equality (a rev-only delta is unchanged)", () => {
    const diff = diffTemplateDefinitions([form("a", { _rev: "1-x" })], [form("a", { _rev: "9-z" })]);
    expect(diff.unchanged.map((e) => e.id)).toEqual(["form:a"]);
    expect(diff.changed).toEqual([]);
  });
});

describe("validateTemplateArtifact", () => {
  it("accepts a well-formed artifact", () => {
    expect(validateTemplateArtifact(artifact())).toEqual([]);
  });

  it("reports missing required fields", () => {
    const errors = validateTemplateArtifact(
      artifact({ kind: "form" as never, appId: "", version: "", templateId: "" })
    );
    expect(errors).toContain("kind must be template");
    expect(errors).toContain("appId is required");
    expect(errors).toContain("version is required");
    expect(errors).toContain("templateId is required");
  });

  it("requires at least one definition and stops there", () => {
    expect(validateTemplateArtifact(artifact({ definitions: [] }))).toEqual([
      "definitions must contain at least one definition"
    ]);
  });

  it("flags a duplicate definition id", () => {
    const errors = validateTemplateArtifact(artifact({ definitions: [form("dup"), form("dup")] }));
    expect(errors).toContain("duplicate definition id: form:dup");
  });

  it("requires each definition's appId to match, exempting app/acl docs", () => {
    const errors = validateTemplateArtifact(
      artifact({ definitions: [form("expense"), form("other", { appId: "different" })] })
    );
    expect(errors).toContain("form:other appId must match template appId");

    const exempt = validateTemplateArtifact(
      artifact({
        definitions: [
          form("expense"),
          { _id: "app:config", kind: "app", appId: "different", title: "x", database: "x" },
          { _id: "acl:rules", kind: "acl", appId: "different", policy: "p", entries: [] }
        ]
      })
    );
    expect(exempt).toEqual([]);
  });
});
