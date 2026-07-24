import { describe, expect, it } from "vitest";
import {
  applyTransition,
  availableTransitions,
  currentState,
  guardReferencedFields,
  isFinalState,
  transitionAffordances
} from "../../src/shared/workflow";
import type { BusinessDocument, FormDefinition, WorkflowDefinition } from "../../src/shared/types";

const NOW = "2026-06-29T00:00:00.000Z";

const workflow = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  _id: "workflow:expense",
  kind: "workflow",
  appId: "expense",
  docType: "expense",
  title: "Expense approval",
  initialState: "draft",
  states: [
    { name: "draft", label: "Draft" },
    { name: "submitted", label: "Submitted" },
    { name: "approved", label: "Approved", final: true }
  ],
  transitions: [
    { id: "submit", label: "Submit", from: "draft", to: "submitted" },
    {
      id: "approve",
      label: "Approve",
      from: "submitted",
      to: "approved",
      requiredRole: "group:finance"
    },
    { id: "withdraw", label: "Withdraw", from: "*", to: "draft" }
  ],
  ...overrides
});

const doc = (overrides: Partial<BusinessDocument> = {}): BusinessDocument => ({
  _id: "doc:expense:1",
  kind: "document",
  appId: "expense",
  docType: "expense",
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: "alice",
  updatedBy: "alice",
  readers: ["alice"],
  authors: ["alice"],
  payload: { amount: 100 },
  ...overrides
});

describe("currentState", () => {
  it("falls back to the workflow initialState when the document has no state", () => {
    expect(currentState(doc(), workflow())).toBe("draft");
  });
  it("returns the document's explicit state when set", () => {
    expect(currentState(doc({ state: "submitted" }), workflow())).toBe("submitted");
  });
});

describe("isFinalState", () => {
  it("is true only for states flagged final", () => {
    expect(isFinalState("approved", workflow())).toBe(true);
    expect(isFinalState("draft", workflow())).toBe(false);
  });
  it("is false for an unknown state", () => {
    expect(isFinalState("nope", workflow())).toBe(false);
  });
});

describe("availableTransitions", () => {
  it("offers transitions whose source matches the current state", () => {
    const ids = availableTransitions(doc(), workflow(), "alice", [], NOW).map((t) => t.id);
    // draft: `submit` (from draft) and `withdraw` (wildcard, draft is non-final).
    expect(ids).toEqual(["submit", "withdraw"]);
  });

  it("matches a wildcard `from` on any non-final state but not on a final one", () => {
    const fromSubmitted = availableTransitions(doc({ state: "submitted" }), workflow(), "fin", ["group:finance"], NOW);
    expect(fromSubmitted.map((t) => t.id)).toContain("withdraw");

    const fromApproved = availableTransitions(doc({ state: "approved" }), workflow(), "alice", [], NOW);
    expect(fromApproved.map((t) => t.id)).not.toContain("withdraw");
  });

  it("hides a transition whose requiredRole the user does not hold", () => {
    const submitted = doc({ state: "submitted" });
    expect(availableTransitions(submitted, workflow(), "alice", [], NOW).map((t) => t.id)).not.toContain("approve");
    expect(
      availableTransitions(submitted, workflow(), "fin", ["group:finance"], NOW).map((t) => t.id)
    ).toContain("approve");
  });

  it("filters on the transition guard over the document payload", () => {
    const guarded = workflow({
      transitions: [{ id: "submit", label: "Submit", from: "draft", to: "submitted", guard: "payload.amount > 50" }]
    });
    expect(availableTransitions(doc({ payload: { amount: 100 } }), guarded, "alice", [], NOW)).toHaveLength(1);
    expect(availableTransitions(doc({ payload: { amount: 10 } }), guarded, "alice", [], NOW)).toHaveLength(0);
  });

  it("fails closed: a guard with a blocked token denies rather than throwing", () => {
    const malicious = workflow({
      transitions: [{ id: "submit", label: "Submit", from: "draft", to: "submitted", guard: "process.exit(1)" }]
    });
    expect(availableTransitions(doc(), malicious, "alice", [], NOW)).toHaveLength(0);
  });
});

describe("guardReferencedFields", () => {
  it("returns [] for an absent or empty guard", () => {
    expect(guardReferencedFields(undefined)).toEqual([]);
    expect(guardReferencedFields("")).toEqual([]);
  });

  it("extracts payload field names, deduped in source order", () => {
    expect(guardReferencedFields("payload.amount > 50 && payload.approver != '' && payload.amount < 900")).toEqual([
      "amount",
      "approver"
    ]);
  });

  it("ignores non-payload references (user, now, principals)", () => {
    expect(guardReferencedFields("principals.includes(payload.approver) && now > '2026'")).toEqual(["approver"]);
  });
});

describe("transitionAffordances", () => {
  const describedFlow = (): WorkflowDefinition =>
    workflow({
      transitions: [
        {
          id: "submit",
          label: "Submit",
          from: "draft",
          to: "submitted",
          description: "Send the expense for approval.",
          guard: "payload.amount > 0"
        },
        { id: "withdraw", label: "Withdraw", from: "*", to: "draft" }
      ]
    });

  const form = (overrides: Partial<FormDefinition> = {}): FormDefinition => ({
    _id: "form:expense",
    kind: "form",
    appId: "expense",
    docType: "expense",
    title: "Expense",
    fields: [
      { name: "amount", type: "number", label: "Amount", helpText: "Total spend in USD." },
      { name: "memo", type: "text", label: "Memo" }
    ],
    ...overrides
  });

  it("annotates each available transition with id, label, to, and its description", () => {
    const affordances = transitionAffordances(doc(), describedFlow(), "alice", [], undefined, NOW);
    // draft offers `submit` (guard passes: amount 100 > 0) and `withdraw`.
    expect(affordances.map((a) => ({ id: a.id, to: a.to, description: a.description }))).toEqual([
      { id: "submit", to: "submitted", description: "Send the expense for approval." },
      { id: "withdraw", to: "draft", description: undefined }
    ]);
  });

  it("mirrors availableTransitions exactly — a guard-blocked transition is not surfaced", () => {
    const affordances = transitionAffordances(doc({ payload: { amount: 0 } }), describedFlow(), "alice", [], undefined, NOW);
    // amount 0 fails `payload.amount > 0`; only the wildcard withdraw remains.
    expect(affordances.map((a) => a.id)).toEqual(["withdraw"]);
  });

  it("surfaces the helpText of guard-referenced fields when the form is supplied", () => {
    const affordances = transitionAffordances(doc(), describedFlow(), "alice", [], form(), NOW);
    const submit = affordances.find((a) => a.id === "submit");
    expect(submit?.requiredFields).toEqual([{ name: "amount", label: "Amount", helpText: "Total spend in USD." }]);
  });

  it("omits requiredFields when the form is absent or the guard reads no known field", () => {
    const noForm = transitionAffordances(doc(), describedFlow(), "alice", [], undefined, NOW);
    expect(noForm.find((a) => a.id === "submit")?.requiredFields).toBeUndefined();
    // `withdraw` has no guard, so no required fields even with a form.
    const withForm = transitionAffordances(doc(), describedFlow(), "alice", [], form(), NOW);
    expect(withForm.find((a) => a.id === "withdraw")?.requiredFields).toBeUndefined();
  });
});

describe("applyTransition", () => {
  it("advances state, stamps the actor/time, and appends history without mutating the input", () => {
    const before = doc();
    const result = applyTransition(before, workflow(), "submit", "alice", [], NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.state).toBe("submitted");
    expect(result.document.stateUpdatedAt).toBe(NOW);
    expect(result.document.stateUpdatedBy).toBe("alice");
    expect(result.document.history).toEqual([
      { transition: "submit", from: "draft", to: "submitted", at: NOW, by: "alice" }
    ]);
    // Input untouched (pure).
    expect(before.state).toBeUndefined();
    expect(before.history).toBeUndefined();
  });

  it("appends to existing history rather than replacing it", () => {
    const prior = { transition: "submit", from: "draft", to: "submitted", at: NOW, by: "alice" };
    const result = applyTransition(
      doc({ state: "submitted", history: [prior] }),
      workflow(),
      "approve",
      "fin",
      ["group:finance"],
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.history).toHaveLength(2);
    expect(result.document.history?.[0]).toEqual(prior);
  });

  it("rejects an unknown transition id", () => {
    const result = applyTransition(doc(), workflow(), "nope", "alice", [], NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toMatch(/Unknown transition/);
  });

  it("rejects a transition that does not match the current state", () => {
    const result = applyTransition(doc(), workflow(), "approve", "fin", ["group:finance"], NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toMatch(/Cannot Approve from draft/);
  });

  it("rejects when the required role is missing", () => {
    const result = applyTransition(doc({ state: "submitted" }), workflow(), "approve", "alice", [], NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toMatch(/requires group:finance/);
  });

  it("rejects when the guard denies the transition", () => {
    const guarded = workflow({
      transitions: [{ id: "submit", label: "Submit", from: "draft", to: "submitted", guard: "payload.amount > 1000" }]
    });
    const result = applyTransition(doc({ payload: { amount: 10 } }), guarded, "submit", "alice", [], NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toMatch(/is not allowed/);
  });
});
