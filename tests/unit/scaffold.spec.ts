import { describe, expect, it } from "vitest";
import { scaffoldDocumentType, slugifyDocType, validateDocType } from "../../src/shared/scaffold";
import { validateFormDefinition, validateViewDefinition } from "../../src/shared/definition-validation";

describe("slugifyDocType", () => {
  it("lowercases, accent-folds, and dash-joins", () => {
    expect(slugifyDocType("Purchase Order")).toBe("purchase-order");
    expect(slugifyDocType("  Résumé  ")).toBe("resume");
    expect(slugifyDocType("Invoice #2025!")).toBe("invoice-2025");
  });
});

describe("validateDocType", () => {
  it("accepts a clean slug", () => {
    expect(validateDocType("invoice")).toEqual([]);
    expect(validateDocType("purchase-order")).toEqual([]);
  });
  it("rejects empty, non-slug, and reserved types", () => {
    expect(validateDocType("").some((e) => e.field === "docType")).toBe(true);
    expect(validateDocType("Invoice").some((e) => e.field === "docType")).toBe(true); // uppercase
    expect(validateDocType("2025").some((e) => e.field === "docType")).toBe(true); // leading digit
    expect(validateDocType("form").some((e) => /reserved/.test(e.message))).toBe(true);
    expect(validateDocType("audit").some((e) => /reserved/.test(e.message))).toBe(true);
  });
});

describe("scaffoldDocumentType", () => {
  it("produces a valid form and view that pass the shared validators", () => {
    const { form, view } = scaffoldDocumentType("expense", "invoice", "Invoice");
    expect(form._id).toBe("form:invoice");
    expect(view._id).toBe("view:invoice");
    expect(form.docType).toBe("invoice");
    expect(view.docType).toBe("invoice");
    expect(validateFormDefinition(form)).toEqual([]);
    expect(validateViewDefinition(view)).toEqual([]);
  });
  it("seeds a required title field placed in a section, and a title column", () => {
    const { form, view } = scaffoldDocumentType("expense", "invoice", "Invoice");
    expect(form.fields).toEqual([{ name: "title", type: "text", label: "Title", required: true }]);
    expect(form.sections).toEqual([{ title: "Details", fields: ["title"] }]);
    expect(view.columns).toEqual([{ field: "payload.title", label: "Title" }]);
    expect(view.sort).toEqual([{ field: "updatedAt", direction: "desc" }]);
  });
  it("falls back to the docType when the title is blank", () => {
    const { form } = scaffoldDocumentType("expense", "invoice", "   ");
    expect(form.title).toBe("invoice");
  });
});
