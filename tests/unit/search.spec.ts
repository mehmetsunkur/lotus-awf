import { describe, expect, it } from "vitest";
import { fold, scoreDocument, searchableFields, searchDocuments, tokenize } from "../../src/shared/search";
import { validateDesignDefinition } from "../../src/shared/definition-validation";
import type { BusinessDocument, FormDefinition } from "../../src/shared/types";

const form: FormDefinition = {
  _id: "form:expense",
  kind: "form",
  appId: "expense",
  docType: "expense",
  title: "Expense",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "notes", type: "textarea", label: "Notes" },
    { name: "category", type: "select", label: "Category" },
    { name: "amount", type: "number", label: "Amount" },
    { name: "secret", type: "text", label: "Secret", searchable: false }
  ]
};

const doc = (payload: Record<string, unknown>): BusinessDocument =>
  ({ kind: "document", docType: "expense", payload } as unknown as BusinessDocument);

describe("fold / tokenize", () => {
  it("is case-insensitive and accent-folded", () => {
    expect(fold("Café RÉSUMÉ")).toBe("cafe resume");
  });
  it("splits on whitespace and punctuation, dropping empties", () => {
    expect(tokenize("  Hello, world!-foo ")).toEqual(["hello", "world", "foo"]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("searchableFields", () => {
  it("defaults text-ish fields on and other types off, honoring explicit flags", () => {
    expect(searchableFields(form).map((f) => f.name)).toEqual(["title", "notes", "category"]);
  });
  it("opts a non-text field in when flagged", () => {
    const withAmount = { ...form, fields: [{ name: "amount", type: "number", label: "Amount", searchable: true }] } as FormDefinition;
    expect(searchableFields(withAmount).map((f) => f.name)).toEqual(["amount"]);
  });
});

describe("scoreDocument (AND-of-terms, prefix)", () => {
  const fields = searchableFields(form);
  it("matches a prefix across searchable fields", () => {
    expect(scoreDocument(doc({ title: "Travel reimbursement" }), fields, ["trav"])).toBeGreaterThan(0);
  });
  it("requires every term to match (AND)", () => {
    expect(scoreDocument(doc({ title: "Travel", notes: "taxi" }), fields, ["travel", "taxi"])).toBeGreaterThan(0);
    expect(scoreDocument(doc({ title: "Travel", notes: "taxi" }), fields, ["travel", "hotel"])).toBeNull();
  });
  it("ignores non-searchable fields", () => {
    expect(scoreDocument(doc({ secret: "classified" }), fields, ["classified"])).toBeNull();
  });
});

describe("searchDocuments", () => {
  it("returns matches ranked by score, with a stable tie-break", () => {
    const docs = [
      doc({ title: "taxi" }),
      doc({ title: "taxi taxi cab" }),
      doc({ title: "hotel" })
    ];
    const result = searchDocuments(docs, form, "taxi");
    expect(result.map((d) => d.payload.title)).toEqual(["taxi taxi cab", "taxi"]);
  });
  it("passes through the full list for an empty query, preserving order", () => {
    const docs = [doc({ title: "b" }), doc({ title: "a" })];
    expect(searchDocuments(docs, form, "   ")).toBe(docs);
  });
  it("returns nothing when the form exposes no searchable fields", () => {
    const noFields = { ...form, fields: [{ name: "amount", type: "number", label: "Amount" }] } as FormDefinition;
    expect(searchDocuments([doc({ amount: 5 })], noFields, "5")).toEqual([]);
  });
});

describe("validateDesignDefinition for the searchable flag", () => {
  it("accepts a boolean searchable flag", () => {
    expect(validateDesignDefinition(form)).toEqual([]);
  });
  it("rejects a non-boolean searchable flag", () => {
    const bad = { ...form, fields: [{ name: "title", type: "text", label: "Title", searchable: "yes" }] } as unknown as FormDefinition;
    expect(validateDesignDefinition(bad).some((e) => e.field === "fields.0.searchable")).toBe(true);
  });
});
