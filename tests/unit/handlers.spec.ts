import { describe, expect, it } from "vitest";
import { HANDLER_MANIFEST, findHandler, handlerHasKind } from "../../src/shared/handlers/manifest";
import { pureHandlerNames, runPureHandler } from "../../src/shared/handlers/pure";
import { applyComputedFields } from "../../src/shared/validation";
import { validateDesignDefinition } from "../../src/shared/definition-validation";
import type { FormDefinition, WorkflowDefinition } from "../../src/shared/types";

describe("handler manifest", () => {
  it("declares every pure handler that is implemented, and vice versa", () => {
    const declaredPure = HANDLER_MANIFEST.filter((entry) => entry.kind === "pure")
      .map((entry) => entry.name)
      .sort();
    expect(pureHandlerNames().sort()).toEqual(declaredPure);
  });

  it("matches kind only for the declared kind", () => {
    expect(handlerHasKind("expense-total-with-tax", "pure")).toBe(true);
    expect(handlerHasKind("expense-total-with-tax", "effect")).toBe(false);
    expect(handlerHasKind("audit-transition", "effect")).toBe(true);
    expect(handlerHasKind("nope", "pure")).toBe(false);
    expect(findHandler("nope")).toBeUndefined();
  });
});

describe("pure handler runtime", () => {
  it("is deterministic across calls", () => {
    const ctx = { payload: { amount: 100 } };
    expect(runPureHandler("expense-total-with-tax", ctx)).toBe(120);
    expect(runPureHandler("expense-total-with-tax", ctx)).toBe(120);
  });

  it("rounds to cents and tolerates non-numeric input", () => {
    expect(runPureHandler("expense-total-with-tax", { payload: { amount: 99.99 } })).toBe(119.99);
    expect(runPureHandler("expense-total-with-tax", { payload: { amount: "x" } })).toBe(0);
  });

  it("fails closed on an unknown handler", () => {
    expect(runPureHandler("does-not-exist", { payload: {} })).toBeUndefined();
  });
});

const computeForm: FormDefinition = {
  _id: "form:expense",
  kind: "form",
  appId: "expense",
  docType: "expense",
  title: "Expense",
  fields: [
    { name: "amount", type: "number", label: "Amount" },
    { name: "gross", type: "number", label: "Gross", compute: "expense-total-with-tax" }
  ]
};

describe("applyComputedFields", () => {
  it("overwrites the computed field and leaves inputs untouched", () => {
    const input = { amount: 50 };
    const out = applyComputedFields(computeForm, input);
    expect(out.gross).toBe(60);
    expect(out.amount).toBe(50);
    expect(input).toEqual({ amount: 50 }); // not mutated
  });
});

describe("definition validation of handler references", () => {
  it("accepts a valid pure compute reference", () => {
    expect(validateDesignDefinition(computeForm)).toEqual([]);
  });

  it("rejects an unknown compute handler", () => {
    const bad = { ...computeForm, fields: [{ name: "g", type: "number", label: "G", compute: "ghost" }] } as FormDefinition;
    expect(validateDesignDefinition(bad).some((e) => e.field === "fields.0.compute")).toBe(true);
  });

  it("rejects a compute reference to an effect handler (kind mismatch)", () => {
    const bad = { ...computeForm, fields: [{ name: "g", type: "number", label: "G", compute: "audit-transition" }] } as FormDefinition;
    expect(validateDesignDefinition(bad).some((e) => /not a pure handler/.test(e.message))).toBe(true);
  });

  const workflow: WorkflowDefinition = {
    _id: "workflow:expense",
    kind: "workflow",
    appId: "expense",
    docType: "expense",
    title: "Expense",
    initialState: "draft",
    states: [
      { name: "draft", label: "Draft" },
      { name: "submitted", label: "Submitted" }
    ],
    transitions: [{ id: "submit", label: "Submit", from: "draft", to: "submitted", action: "audit-transition" }]
  };

  it("accepts a valid effect action reference", () => {
    expect(validateDesignDefinition(workflow)).toEqual([]);
  });

  it("rejects an action reference to a pure handler (kind mismatch)", () => {
    const bad = {
      ...workflow,
      transitions: [{ id: "submit", label: "Submit", from: "draft", to: "submitted", action: "expense-total-with-tax" }]
    } as WorkflowDefinition;
    expect(validateDesignDefinition(bad).some((e) => e.field === "transitions.0.action")).toBe(true);
  });
});
