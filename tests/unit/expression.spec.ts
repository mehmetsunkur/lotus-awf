import { describe, expect, it } from "vitest";
import { evaluateBoolean, evaluateExpression } from "../../src/shared/expression";

describe("evaluateExpression", () => {
  it("returns true for an empty or whitespace expression", () => {
    expect(evaluateExpression(undefined, { payload: {} })).toBe(true);
    expect(evaluateExpression("   ", { payload: {} })).toBe(true);
  });

  it("evaluates arithmetic and comparisons over the payload", () => {
    expect(evaluateExpression("payload.amount * 2", { payload: { amount: 21 } })).toBe(42);
    expect(evaluateExpression("payload.amount > 100", { payload: { amount: 150 } })).toBe(true);
  });

  it("exposes doc, user, and now in scope", () => {
    expect(evaluateExpression("doc.state === 'submitted'", { payload: {}, doc: { state: "submitted" } })).toBe(true);
    expect(evaluateExpression("user === 'alice'", { payload: {}, user: "alice" })).toBe(true);
    expect(evaluateExpression("now", { payload: {}, now: "2026-06-29" })).toBe("2026-06-29");
  });

  it("throws on a blocked token rather than executing it", () => {
    expect(() => evaluateExpression("process.exit(1)", { payload: {} })).toThrow(/blocked token/);
    expect(() => evaluateExpression("constructor", { payload: {} })).toThrow(/blocked token/);
    expect(() => evaluateExpression("(() => 1)()", { payload: {} })).toThrow(/blocked token/);
  });
});

describe("evaluateBoolean", () => {
  it("returns the fallback for an empty expression", () => {
    expect(evaluateBoolean(undefined, { payload: {} })).toBe(true);
    expect(evaluateBoolean("", { payload: {} }, false)).toBe(false);
  });

  it("coerces the expression result to a boolean", () => {
    expect(evaluateBoolean("payload.amount", { payload: { amount: 5 } })).toBe(true);
    expect(evaluateBoolean("payload.amount", { payload: { amount: 0 } })).toBe(false);
    expect(evaluateBoolean("payload.flag === true", { payload: { flag: true } })).toBe(true);
  });
});
