import { describe, expect, it } from "vitest";
import { evaluateFormulaAsync, formulaBlockedToken, formulaSyntaxError, type DbReader } from "../../src/shared/formula";
import { validateFormDefinition } from "../../src/shared/definition-validation";
import { normalizePayload, validatePayload } from "../../src/shared/validation";
import type { PrincipalScope } from "../../src/shared/access";
import type { BusinessDocument, FormDefinition } from "../../src/shared/types";

function employee(slug: string, person: string, department: string, readers: string[]): BusinessDocument {
  return {
    _id: `doc:employee:${slug}`,
    kind: "document",
    appId: "org",
    docType: "employee",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    createdBy: "person:root",
    updatedBy: "person:root",
    readers,
    authors: ["person:root"],
    payload: { person, department }
  };
}

const CORPUS: BusinessDocument[] = [
  employee("alice", "person:alice", "finance", ["person:alice"]),
  employee("bob", "person:bob", "sales", ["person:bob"]),
  employee("carol", "person:carol", "eng", ["group:eng"])
];

const read: DbReader = async (appId, docType) =>
  appId === "org" && docType === "employee" ? CORPUS : [];

const scope = (person: string, ...principals: string[]): PrincipalScope => ({
  person,
  groups: principals.filter((p) => p.startsWith("group:")),
  principals: [person, ...principals]
});

describe("formula async lane — @DbColumn/@DbLookup", () => {
  it("scopes reads by the caller: the same formula returns only readable rows", async () => {
    const formula = "(await DbColumn('org', 'employee', 'payload.person')).length";
    expect(await evaluateFormulaAsync(formula, { scope: scope("person:alice"), read })).toBe(1);
    expect(await evaluateFormulaAsync(formula, { scope: scope("person:bob"), read })).toBe(1);
    expect(await evaluateFormulaAsync(formula, { scope: scope("person:dave", "group:eng"), read })).toBe(1);
  });

  it("@DbLookup never surfaces a value from an unreadable row", async () => {
    const lookup = "await DbLookup('org', 'employee', 'payload.person', 'person:bob', 'payload.department')";
    expect(await evaluateFormulaAsync(lookup, { scope: scope("person:bob"), read })).toBe("sales");
    expect(await evaluateFormulaAsync(lookup, { scope: scope("person:alice"), read })).toBeUndefined();
  });

  it("supports inline await and reads the doc/payload context", async () => {
    const formula = "await DbLookup('org','employee','payload.person', payload.owner, 'payload.department')";
    const value = await evaluateFormulaAsync(formula, {
      payload: { owner: "person:bob" },
      scope: scope("person:bob"),
      read
    });
    expect(value).toBe("sales");
  });

  it("fails closed to undefined on a runtime error", async () => {
    expect(await evaluateFormulaAsync("await DbColumn('org','employee','payload.person').nope.nope", { scope: scope("person:alice"), read })).toBeUndefined();
  });

  it("NEVER throws: a blocked token or a syntax error fails closed to undefined", async () => {
    // The read path must not throw — that would 500 the endpoint and drop the batch.
    expect(await evaluateFormulaAsync("process.exit()", { scope: scope("person:alice"), read })).toBeUndefined();
    expect(await evaluateFormulaAsync("payload.a (", { scope: scope("person:alice"), read })).toBeUndefined();
    // formulaBlockedToken/formulaSyntaxError still report the reason for authoring.
    expect(formulaBlockedToken("process.exit()")).toBe("process");
    expect(formulaSyntaxError("payload.a (")).toBeTruthy();
    expect(formulaSyntaxError("payload.a")).toBeUndefined();
  });
});

describe("computed-for-display field — definition validation & payload lifecycle (ADR-0019 mode shape)", () => {
  const form = (formula: unknown, mode: unknown = "computed-for-display"): FormDefinition =>
    ({
      _id: "form:report",
      kind: "form",
      appId: "app",
      docType: "report",
      title: "Report",
      fields: [
        { name: "title", type: "text", label: "Title", required: true },
        { name: "dept", type: "text", label: "Dept", ...(mode === null ? {} : { mode }), ...(formula === undefined ? {} : { formula }) }
      ]
    }) as unknown as FormDefinition;

  it("accepts a valid formula field", () => {
    const errors = validateFormDefinition(form("await DbLookup('org','employee','payload.person', payload.owner, 'payload.department')"));
    expect(errors).toEqual([]);
  });

  it("requires a formula on a formula field", () => {
    const errors = validateFormDefinition(form(undefined));
    expect(errors.some((e) => e.field === "fields.1.formula")).toBe(true);
  });

  it("rejects a blocked token in a formula (async lane, not the sync expression lane)", () => {
    const errors = validateFormDefinition(form("(() => process)()"));
    expect(errors.some((e) => e.field === "fields.1.formula" && /blocked token/.test(e.message))).toBe(true);
  });

  it("rejects a formula set on an editable field", () => {
    const errors = validateFormDefinition(form("payload.x", null));
    expect(errors.some((e) => e.field === "fields.1.formula")).toBe(true);
  });

  it("rejects a syntactically-invalid formula at authoring (keeps it off the read path)", () => {
    const errors = validateFormDefinition(form("payload.a ("));
    expect(errors.some((e) => e.field === "fields.1.formula" && /not valid/.test(e.message))).toBe(true);
  });

  it("excludes formula fields from the stored payload and skips their required/validation checks", () => {
    const def = form("await DbColumn('org','employee','payload.person')");
    // A formula field is read-only/server-resolved: not stored, never 'required'.
    expect(normalizePayload(def, { title: "Q3" })).toEqual({ title: "Q3" });
    expect(validatePayload(def, { title: "Q3" })).toEqual([]);
  });
});
