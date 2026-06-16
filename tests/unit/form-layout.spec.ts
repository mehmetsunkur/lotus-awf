import { describe, expect, it } from "vitest";
import {
  addFieldToSection,
  addSection,
  ensureSections,
  isLayoutNormalized,
  moveFieldToSection,
  moveFieldWithinSection,
  moveSection,
  removeField,
  removeSection,
  renameField,
  renameSection
} from "../../src/shared/form-layout";
import type { FieldType, FormDefinition } from "../../src/shared/types";

const field = (name: string, type: FieldType = "text") => ({ name, type, label: name });

const form = (overrides: Partial<FormDefinition> = {}): FormDefinition => ({
  _id: "form:expense",
  kind: "form",
  appId: "expense",
  docType: "expense",
  title: "Expense",
  fields: [field("a"), field("b"), field("c")],
  sections: [
    { title: "One", fields: ["a", "b"] },
    { title: "Two", fields: ["c"] }
  ],
  ...overrides
});

describe("ensureSections", () => {
  it("collapses a section-less form to one covering section", () => {
    const normalized = ensureSections(form({ sections: undefined }));
    expect(normalized.sections).toEqual([{ title: "Expense", fields: ["a", "b", "c"] }]);
    expect(isLayoutNormalized(normalized)).toBe(true);
  });
  it("appends fields missing from all sections to the first section", () => {
    const normalized = ensureSections(form({ sections: [{ title: "One", fields: ["a"] }] }));
    expect(normalized.sections![0].fields).toEqual(["a", "b", "c"]);
    expect(isLayoutNormalized(normalized)).toBe(true);
  });
  it("drops section references to unknown fields", () => {
    const normalized = ensureSections(form({ sections: [{ title: "One", fields: ["a", "ghost", "b", "c"] }] }));
    expect(normalized.sections![0].fields).toEqual(["a", "b", "c"]);
  });
});

describe("field moves keep the one-section-per-field invariant", () => {
  it("reorders within a section", () => {
    const next = moveFieldWithinSection(form(), 0, 0, 1);
    expect(next.sections![0].fields).toEqual(["b", "a"]);
    expect(isLayoutNormalized(next)).toBe(true);
  });
  it("moves a field across sections (removed from the old, added to the new)", () => {
    const next = moveFieldToSection(form(), "a", 1);
    expect(next.sections![0].fields).toEqual(["b"]);
    expect(next.sections![1].fields).toEqual(["c", "a"]);
    expect(isLayoutNormalized(next)).toBe(true);
  });
  it("honors an explicit position when moving across sections", () => {
    const next = moveFieldToSection(form(), "a", 1, 0);
    expect(next.sections![1].fields).toEqual(["a", "c"]);
  });
  it("is a no-op for an unknown field", () => {
    expect(moveFieldToSection(form(), "ghost", 1)).toEqual(ensureSections(form()));
  });
});

describe("section operations", () => {
  it("adds, renames, and reorders sections", () => {
    expect(addSection(form(), "Three").sections!.map((s) => s.title)).toEqual(["One", "Two", "Three"]);
    expect(renameSection(form(), 1, "Renamed").sections![1].title).toBe("Renamed");
    expect(moveSection(form(), 0, 1).sections!.map((s) => s.title)).toEqual(["Two", "One"]);
  });
  it("removing a section reassigns its fields to the first remaining one", () => {
    const next = removeSection(form(), 0); // section One holds a, b
    expect(next.sections).toHaveLength(1);
    expect(next.sections![0].fields).toEqual(["c", "a", "b"]);
    expect(isLayoutNormalized(next)).toBe(true);
  });
  it("refuses to remove the last section", () => {
    const single = form({ sections: [{ title: "Only", fields: ["a", "b", "c"] }] });
    expect(removeSection(single, 0)).toEqual(single);
  });
});

describe("field add / remove / rename", () => {
  it("adds a field into a chosen section", () => {
    const next = addFieldToSection(form(), field("d"), 1);
    expect(next.fields.map((f) => f.name)).toContain("d");
    expect(next.sections![1].fields).toEqual(["c", "d"]);
    expect(isLayoutNormalized(next)).toBe(true);
  });
  it("removes a field from the form and its section", () => {
    const next = removeField(form(), "a");
    expect(next.fields.map((f) => f.name)).toEqual(["b", "c"]);
    expect(next.sections![0].fields).toEqual(["b"]);
    expect(isLayoutNormalized(next)).toBe(true);
  });
  it("renames a field in the field list and its section", () => {
    const next = renameField(form(), 0, "alpha");
    expect(next.fields[0].name).toBe("alpha");
    expect(next.sections![0].fields).toEqual(["alpha", "b"]);
    expect(isLayoutNormalized(next)).toBe(true);
  });
});
