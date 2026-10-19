import { describe, expect, it } from "vitest";
import { validateFormDefinition } from "../../src/shared/definition-validation";
import type { FormDefinition, FormField } from "../../src/shared/types";

// ADR-0024 §1: `aclRole` is a third orthogonal FormField axis (author only since
// ADR-0026 retired "reader"), COMPUTED-ONLY — a flagged field must be `computed`/`computed-once` with a formula
// so its value is server-resolved and tamper-safe by construction.

const formWith = (field: FormField): FormDefinition => ({
  _id: "form:doc",
  kind: "form",
  appId: "app",
  docType: "doc",
  title: "Doc",
  fields: [{ name: "title", type: "text", label: "Title", required: true }, field]
});

const aclErrors = (field: FormField): string[] =>
  validateFormDefinition(formWith(field))
    .filter((e) => e.field.endsWith(".aclRole"))
    .map((e) => e.message);

describe("aclRole field validation", () => {
  it("accepts a computed-once author field returning a constant principal list", () => {
    expect(
      validateFormDefinition(
        formWith({
          name: "aclAuthors",
          type: "text",
          label: "Authors",
          aclRole: "author",
          mode: "computed-once",
          formula: '["group:employees"]'
        })
      )
    ).toEqual([]);
  });

  it("rejects aclRole \"reader\" — document visibility is the app ACL (ADR-0026)", () => {
    const errors = aclErrors({
      name: "aclReaders",
      type: "text",
      label: "Readers",
      aclRole: "reader" as unknown as "author",
      mode: "computed-once",
      formula: '["group:employees"]'
    });
    expect(errors.some((m) => /not supported.*ADR-0026/.test(m))).toBe(true);
  });

  it("accepts a computed author field", () => {
    expect(
      aclErrors({
        name: "aclAuthors",
        type: "text",
        label: "Authors",
        aclRole: "author",
        mode: "computed",
        formula: "[payload.owner]"
      })
    ).toEqual([]);
  });

  it("rejects an unknown aclRole value", () => {
    const errors = aclErrors({
      name: "aclX",
      type: "text",
      label: "X",
      aclRole: "manager" as unknown as "author",
      mode: "computed-once",
      formula: "[]"
    });
    expect(errors.some((m) => /aclRole is invalid/.test(m))).toBe(true);
  });

  it("rejects an editable (non-computed) aclRole field — no mode", () => {
    const errors = aclErrors({ name: "aclAuthors", type: "text", label: "Authors", aclRole: "author" });
    expect(errors.some((m) => /must be computed or computed-once/.test(m))).toBe(true);
  });

  it("rejects a computed-for-display aclRole field (display values are never stored)", () => {
    const errors = aclErrors({
      name: "aclAuthors",
      type: "text",
      label: "Authors",
      aclRole: "author",
      mode: "computed-for-display",
      formula: "[]"
    });
    expect(errors.some((m) => /must be computed or computed-once/.test(m))).toBe(true);
  });
});
