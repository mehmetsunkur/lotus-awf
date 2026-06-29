import { describe, expect, it } from "vitest";
import {
  applyComputedFields,
  applyFormDefaults,
  defaultValueForField,
  isFieldReadOnly,
  isFieldRequired,
  isFieldVisible,
  normalizePayload,
  validatePayload
} from "../../src/shared/validation";
import type { FormDefinition, FormField } from "../../src/shared/types";

const field = (overrides: Partial<FormField> & Pick<FormField, "name" | "type" | "label">): FormField => overrides;

const form = (fields: FormField[]): FormDefinition => ({
  _id: "form:expense",
  kind: "form",
  appId: "expense",
  docType: "expense",
  title: "Expense",
  fields
});

describe("defaultValueForField", () => {
  it("prefers an explicit defaultValue", () => {
    expect(defaultValueForField(field({ name: "n", type: "number", label: "N", defaultValue: 7 }))).toBe(7);
  });
  it("falls back to a type-appropriate empty value", () => {
    expect(defaultValueForField(field({ name: "n", type: "number", label: "N" }))).toBe(0);
    expect(defaultValueForField(field({ name: "b", type: "boolean", label: "B" }))).toBe(false);
    expect(defaultValueForField(field({ name: "t", type: "text", label: "T" }))).toBe("");
  });
});

describe("applyFormDefaults", () => {
  it("fills only missing fields and never mutates the input", () => {
    const input = { amount: 50 };
    const result = applyFormDefaults(
      form([
        field({ name: "amount", type: "number", label: "Amount" }),
        field({ name: "note", type: "text", label: "Note" })
      ]),
      input
    );
    expect(result).toEqual({ amount: 50, note: "" });
    expect(input).toEqual({ amount: 50 });
  });
});

describe("applyComputedFields", () => {
  const computed = form([
    field({ name: "amount", type: "number", label: "Amount" }),
    field({ name: "total", type: "number", label: "Total", compute: "expense-total-with-tax" })
  ]);

  it("overwrites a compute field with its registered pure handler result", () => {
    expect(applyComputedFields(computed, { amount: 100 }).total).toBe(120);
  });
  it("overrides any user-supplied value for a compute field", () => {
    expect(applyComputedFields(computed, { amount: 100, total: 9999 }).total).toBe(120);
  });
  it("fails closed to undefined for an unknown handler", () => {
    const bad = form([field({ name: "total", type: "number", label: "Total", compute: "does-not-exist" })]);
    expect(applyComputedFields(bad, {}).total).toBeUndefined();
  });
});

describe("field state predicates", () => {
  const f = field({
    name: "reason",
    type: "text",
    label: "Reason",
    visibleWhen: "payload.amount > 100",
    readOnlyWhen: "doc.state === 'approved'",
    requiredWhen: "payload.amount > 100"
  });

  it("isFieldVisible defaults to visible and honors visibleWhen", () => {
    expect(isFieldVisible(field({ name: "x", type: "text", label: "X" }), undefined, {})).toBe(true);
    expect(isFieldVisible(f, undefined, { amount: 150 })).toBe(true);
    expect(isFieldVisible(f, undefined, { amount: 10 })).toBe(false);
  });

  it("isFieldReadOnly defaults to false and honors readOnlyWhen", () => {
    expect(isFieldReadOnly(field({ name: "x", type: "text", label: "X" }), undefined, {})).toBe(false);
    expect(isFieldReadOnly(f, { state: "approved" } as never, {})).toBe(true);
  });

  it("isFieldRequired is true when required or requiredWhen matches", () => {
    expect(isFieldRequired(field({ name: "x", type: "text", label: "X", required: true }), undefined, {})).toBe(true);
    expect(isFieldRequired(f, undefined, { amount: 150 })).toBe(true);
    expect(isFieldRequired(f, undefined, { amount: 10 })).toBe(false);
  });
});

describe("normalizePayload", () => {
  it("coerces values to their field types and fills defaults", () => {
    const normalized = normalizePayload(
      form([
        field({ name: "amount", type: "number", label: "Amount" }),
        field({ name: "active", type: "boolean", label: "Active" }),
        field({ name: "note", type: "text", label: "Note" })
      ]),
      { amount: "42", active: 1 }
    );
    expect(normalized).toEqual({ amount: 42, active: true, note: "" });
  });
});

describe("validatePayload", () => {
  it("flags a required field that is empty", () => {
    const errors = validatePayload(form([field({ name: "title", type: "text", label: "Title", required: true })]), {});
    expect(errors).toEqual([{ field: "title", message: "Title is required" }]);
  });

  it("skips validation for fields hidden by visibleWhen", () => {
    const errors = validatePayload(
      form([
        field({ name: "amount", type: "number", label: "Amount" }),
        field({ name: "reason", type: "text", label: "Reason", required: true, visibleWhen: "payload.amount > 100" })
      ]),
      { amount: 10 }
    );
    expect(errors).toEqual([]);
  });

  it("rejects a select value outside the allowed options", () => {
    const f = field({
      name: "status",
      type: "select",
      label: "Status",
      options: [
        { label: "Open", value: "open" },
        { label: "Closed", value: "closed" }
      ]
    });
    expect(validatePayload(form([f]), { status: "bogus" })).toEqual([
      { field: "status", message: "Status is not a valid option" }
    ]);
    expect(validatePayload(form([f]), { status: "open" })).toEqual([]);
  });

  it("applies a custom validate rule and reports its message", () => {
    const f = field({
      name: "amount",
      type: "number",
      label: "Amount",
      validate: [{ expression: "payload.amount <= 1000", message: "Amount too large" }]
    });
    expect(validatePayload(form([f]), { amount: 5000 })).toEqual([{ field: "amount", message: "Amount too large" }]);
    expect(validatePayload(form([f]), { amount: 500 })).toEqual([]);
  });

  it("fails closed when a validate rule expression throws", () => {
    const f = field({
      name: "amount",
      type: "number",
      label: "Amount",
      validate: [{ expression: "process.exit(1)", message: "ignored" }]
    });
    const errors = validatePayload(form([f]), { amount: 1 });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("amount");
    expect(errors[0].message).toMatch(/blocked token/);
  });
});
