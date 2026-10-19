import { describe, expect, it } from "vitest";
import { ME_SENTINEL, mangoSelector } from "../../src/shared/view-query";
import { validateViewDefinition } from "../../src/shared/definition-validation";
import type { ViewDefinition, ViewFilter } from "../../src/shared/types";

/**
 * ADR-0020: the @me actor-aware filter — substitution semantics and the
 * authoring-time value-shape rules from the plan review (M1/M2/M4/M5).
 */

const PRINCIPALS = ["person:carol", "group:managers", "group:flight-ops"];

describe("mangoSelector @me substitution", () => {
  it("substitutes the caller's full principal set for @me", () => {
    const selector = mangoSelector(
      [{ field: "responsible", op: "in", value: ME_SENTINEL }],
      "leave-request",
      PRINCIPALS
    );
    expect(selector.responsible).toEqual({ $in: PRINCIPALS });
    expect(selector.docType).toBe("leave-request");
  });

  it("fails closed on an empty principal set ($in: [] matches nothing)", () => {
    const selector = mangoSelector([{ field: "responsible", op: "in", value: ME_SENTINEL }], "x", []);
    expect(selector.responsible).toEqual({ $in: [] });
  });

  it("leaves literal values untouched, including arrays and the string elsewhere", () => {
    const selector = mangoSelector(
      [
        { field: "state", op: "eq", value: "submitted" },
        { field: "payload.tags", op: "in", value: ["a", "b"] }
      ],
      "x",
      PRINCIPALS
    );
    expect(selector.state).toEqual({ $eq: "submitted" });
    expect(selector["payload.tags"]).toEqual({ $in: ["a", "b"] });
  });

  it("kind precedence (ADR-0026): re-asserting kind after the view selector keeps reads on business docs", () => {
    // The route builds { ...mangoSelector(...), kind: "document" } — a designer
    // filter on `kind` can never widen a view to design/runtime documents.
    const viewSelector = mangoSelector([{ field: "kind", op: "eq", value: "acl" } as ViewFilter], "x", PRINCIPALS);
    const combined = { ...viewSelector, kind: "document" };
    expect(combined.kind).toBe("document");
  });
});

describe("validateFilter @me rules (ADR-0020)", () => {
  const view = (filter: ViewFilter): ViewDefinition => ({
    _id: "view:test",
    kind: "view",
    appId: "x",
    docType: "x",
    title: "Test",
    columns: [{ field: "state", label: "State" }],
    filters: [filter]
  });
  const fieldsOf = (definition: ViewDefinition) => validateViewDefinition(definition).map((error) => error.field);

  it("accepts @me with the in op and plain filters unchanged", () => {
    expect(validateViewDefinition(view({ field: "responsible", op: "in", value: "@me" }))).toEqual([]);
    expect(validateViewDefinition(view({ field: "state", op: "eq", value: "submitted" }))).toEqual([]);
    expect(validateViewDefinition(view({ field: "payload.tags", op: "in", value: ["a"] }))).toEqual([]);
  });

  it("rejects @me with any other op", () => {
    for (const op of ["eq", "ne", "gt", "gte", "lt", "lte"] as const) {
      expect(fieldsOf(view({ field: "responsible", op, value: "@me" }))).toContain("filters.0.value");
    }
  });

  it("rejects @me inside an array value (must be the entire value)", () => {
    expect(fieldsOf(view({ field: "responsible", op: "in", value: ["@me", "person:bob"] }))).toContain(
      "filters.0.value"
    );
  });

  it("rejects an in op with a scalar non-@me value (catches near-miss typos)", () => {
    for (const value of ["@Me", " @me", "person:bob"]) {
      expect(fieldsOf(view({ field: "responsible", op: "in", value }))).toContain("filters.0.value");
    }
  });

  it("rejects ACL envelope (readers/authors) filters (review M2, ADR-0026)", () => {
    expect(fieldsOf(view({ field: "readers", op: "in", value: ["group:x"] }))).toContain("filters.0.field");
    expect(fieldsOf(view({ field: "authors", op: "eq", value: "person:x" }))).toContain("filters.0.field");
  });
});
