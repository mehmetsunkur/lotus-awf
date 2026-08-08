import { describe, expect, it } from "vitest";
import {
  applyTransition,
  availableTransitions,
  normalizeResolvedPrincipals
} from "../../src/shared/workflow";
import { validateFormDefinition, validateWorkflowDefinition } from "../../src/shared/definition-validation";
import {
  applyFormDefaults,
  isEditableField,
  isPayloadField,
  normalizePayload,
  validatePayload
} from "../../src/shared/validation";
import { evaluateExpression } from "../../src/shared/expression";
import type { BusinessDocument, FormDefinition, WorkflowDefinition } from "../../src/shared/types";

/**
 * ADR-0019 (guard-gated approvers over server-stamped computed fields, field
 * computation modes) + ADR-0018 (engine-stamped assignee). Encodes the ADR-0019
 * review resolutions: guard membership via `principals` (parity, no advisory
 * offering), mode/field consistency matrix, the two-predicate split (m4), and
 * the superseded-approverFormula rejection (m1).
 */

const NOW = "2026-07-02T00:00:00.000Z";

const workflow = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  _id: "workflow:leave-request",
  kind: "workflow",
  appId: "leave-request",
  docType: "leave-request",
  title: "Leave approval",
  initialState: "draft",
  states: [
    { name: "draft", label: "Draft" },
    { name: "submitted", label: "Submitted", responsible: "group:managers", responsibleFormula: "payload.approver" },
    { name: "approved", label: "Approved", final: true, responsible: "group:managers" }
  ],
  transitions: [
    { id: "submit", label: "Submit", from: "draft", to: "submitted", guard: "!!payload.approver" },
    {
      id: "approve",
      label: "Approve",
      from: "submitted",
      to: "approved",
      guard: "principals.includes(payload.approver)"
    },
    { id: "revise", label: "Revise", from: "submitted", to: "draft" }
  ],
  ...overrides
});

const doc = (overrides: Partial<BusinessDocument> = {}): BusinessDocument => ({
  _id: "doc:leave-request:1",
  kind: "document",
  appId: "leave-request",
  docType: "leave-request",
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: "person:dave",
  updatedBy: "person:dave",
  readers: ["person:dave", "group:managers"],
  authors: ["person:dave"],
  payload: { department: "flight-ops", approver: "person:carol" },
  state: "submitted",
  ...overrides
});

describe("ADR-0019 guard-gated approvers (principals in the sync lane)", () => {
  it("admits exactly the stamped approver, regardless of any role", () => {
    const carol = applyTransition(doc(), workflow(), "approve", "person:carol", ["person:carol", "group:managers"], NOW);
    expect(carol.ok).toBe(true);

    // A bona fide manager who is NOT the stamped approver is refused.
    const erin = applyTransition(doc(), workflow(), "approve", "person:erin", ["person:erin", "group:managers"], NOW);
    expect(erin.ok).toBe(false);
    if (!erin.ok) expect(erin.errors[0].message).toBe("Approve is not allowed for this document");
  });

  it("admits a head with NO role at all — authority comes from the stamp", () => {
    const hankDoc = doc({ payload: { department: "ground-ops", approver: "person:hank" } });
    const result = applyTransition(hankDoc, workflow(), "approve", "person:hank", ["person:hank", "group:ground-ops"], NOW);
    expect(result.ok).toBe(true);
  });

  it("matches group-valued approvers by membership (headless fallback)", () => {
    const fallbackDoc = doc({ payload: { approver: "group:managers" } });
    const manager = applyTransition(fallbackDoc, workflow(), "approve", "person:erin", ["person:erin", "group:managers"], NOW);
    expect(manager.ok).toBe(true);
    const outsider = applyTransition(fallbackDoc, workflow(), "approve", "person:hank", ["person:hank", "group:ground-ops"], NOW);
    expect(outsider.ok).toBe(false);
  });

  it("offering EXACTLY mirrors enforcement — no advisory divergence", () => {
    const offeredToCarol = availableTransitions(doc(), workflow(), "person:carol", ["person:carol", "group:managers"], NOW);
    expect(offeredToCarol.map((transition) => transition.id)).toContain("approve");
    const offeredToErin = availableTransitions(doc(), workflow(), "person:erin", ["person:erin", "group:managers"], NOW);
    expect(offeredToErin.map((transition) => transition.id)).not.toContain("approve");
  });

  it("an unstamped document refuses submit via the belt-and-braces guard", () => {
    const unstamped = doc({ state: "draft", payload: { department: "flight-ops" } });
    const result = applyTransition(unstamped, workflow(), "submit", "person:dave", ["person:dave"], NOW);
    expect(result.ok).toBe(false);
  });

  it("principals is empty (not an error) outside guard contexts", () => {
    expect(evaluateExpression("principals.length", { payload: {} })).toBe(0);
  });
});

describe("normalizeResolvedPrincipals", () => {
  it("keeps only principal-shaped strings", () => {
    expect(normalizeResolvedPrincipals("person:carol")).toEqual(["person:carol"]);
    expect(normalizeResolvedPrincipals(["group:managers", "carol", 42])).toEqual(["group:managers"]);
    expect(normalizeResolvedPrincipals(undefined)).toEqual([]);
  });
});

describe("ADR-0025 responsible stamping (renamed+widened from ADR-0018 assignee)", () => {
  it("stamps the resolved responsible set (and the hand-off in history) on state entry", () => {
    const result = applyTransition(doc({ state: "draft" }), workflow(), "submit", "person:dave", ["person:dave"], NOW, {
      responsible: ["person:carol"]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.responsible).toEqual(["person:carol"]);
      expect(result.document.responsibleAt).toBe(NOW);
      expect(result.document.history?.at(-1)).toMatchObject({ transition: "submit", responsible: ["person:carol"] });
    }
  });

  it("falls back to the target state's static responsible", () => {
    const result = applyTransition(doc({ state: "draft" }), workflow(), "submit", "person:dave", ["person:dave"], NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.responsible).toEqual(["group:managers"]);
  });

  it("clears the responsible on final states even when the state declares a responsible", () => {
    const result = applyTransition(
      doc({ responsible: ["person:carol"], responsibleAt: NOW }),
      workflow(),
      "approve",
      "person:carol",
      ["person:carol", "group:managers"],
      NOW
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("responsible" in result.document).toBe(false);
      expect("responsibleAt" in result.document).toBe(false);
    }
  });

  it("stamps on a transition INTO the initial state (revise → draft)", () => {
    const def = workflow();
    def.states[0] = { ...def.states[0], responsibleFormula: "doc.createdBy" };
    const result = applyTransition(doc(), def, "revise", "person:erin", ["group:managers"], NOW, {
      responsible: ["person:dave"]
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.responsible).toEqual(["person:dave"]);
  });

  it("non-principal resolved values normalize away and the static responsible wins", () => {
    const result = applyTransition(doc({ state: "draft" }), workflow(), "submit", "person:dave", ["person:dave"], NOW, {
      responsible: ["not-a-principal"]
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.responsible).toEqual(["group:managers"]);
  });

  it("preserves multiple resolved principals as a deduped set", () => {
    const result = applyTransition(doc({ state: "draft" }), workflow(), "submit", "person:dave", ["person:dave"], NOW, {
      responsible: ["person:carol", "group:managers", "person:carol"]
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.responsible).toEqual(["person:carol", "group:managers"]);
  });
});

describe("ADR-0019 field computation modes — definition validation", () => {
  const form = (fields: FormDefinition["fields"]): FormDefinition => ({
    _id: "form:leave-request",
    kind: "form",
    appId: "leave-request",
    docType: "leave-request",
    title: "Leave Request",
    fields
  });

  it("accepts the mode family with formulas", () => {
    const errors = validateFormDefinition(
      form([
        { name: "reason", type: "text", label: "Reason", required: true },
        { name: "approver", type: "text", label: "Approver", mode: "computed", formula: "doc.createdBy" },
        { name: "department", type: "text", label: "Department", mode: "computed-once", formula: "'ops'" },
        { name: "manager", type: "text", label: "Manager", mode: "computed-for-display", formula: "doc.createdBy" }
      ])
    );
    expect(errors).toEqual([]);
  });

  it("rejects formula type (removed), unknown modes, and editable+formula", () => {
    const badType = validateFormDefinition(
      form([{ name: "x", type: "formula" as never, label: "X", formula: "1" }])
    );
    expect(badType.map((error) => error.field)).toContain("fields.0.type");

    const badMode = validateFormDefinition(
      form([{ name: "x", type: "text", label: "X", mode: "stored" as never, formula: "1" }])
    );
    expect(badMode.map((error) => error.field)).toContain("fields.0.mode");

    const editableFormula = validateFormDefinition(form([{ name: "x", type: "text", label: "X", formula: "1" }]));
    expect(editableFormula.map((error) => error.field)).toContain("fields.0.formula");
  });

  it("rejects user-input rules and pure handlers on computed modes", () => {
    const errors = validateFormDefinition(
      form([
        {
          name: "x",
          type: "text",
          label: "X",
          mode: "computed",
          formula: "1",
          required: true,
          defaultValue: "y",
          validate: [{ expression: "true" }],
          compute: "expense-total-with-tax"
        }
      ])
    );
    const fields = errors.map((error) => error.field);
    expect(fields).toContain("fields.0.required");
    expect(fields).toContain("fields.0.defaultValue");
    expect(fields).toContain("fields.0.validate");
    expect(fields).toContain("fields.0.compute");
  });

  it("rejects a computed mode without a formula and a blocked-token formula", () => {
    const missing = validateFormDefinition(form([{ name: "x", type: "text", label: "X", mode: "computed" }]));
    expect(missing.map((error) => error.field)).toContain("fields.0.formula");
    const blocked = validateFormDefinition(
      form([{ name: "x", type: "text", label: "X", mode: "computed", formula: "globalThis.leak" }])
    );
    expect(blocked.map((error) => error.field)).toContain("fields.0.formula");
  });

  it("rejects the superseded approverFormula on transitions (review m1)", () => {
    const def = workflow();
    (def.transitions[1] as Record<string, unknown>).approverFormula = "doc.createdBy";
    expect(validateWorkflowDefinition(def).map((error) => error.field)).toContain("transitions.1.approverFormula");
  });
});

describe("ADR-0019 payload predicates (review m4)", () => {
  const fields: FormDefinition["fields"] = [
    { name: "reason", type: "text", label: "Reason" },
    { name: "approver", type: "text", label: "Approver", mode: "computed", formula: "doc.createdBy" },
    { name: "department", type: "text", label: "Department", mode: "computed-once", formula: "'ops'" },
    { name: "manager", type: "text", label: "Manager", mode: "computed-for-display", formula: "doc.createdBy" }
  ];
  const form: FormDefinition = {
    _id: "form:leave-request",
    kind: "form",
    appId: "leave-request",
    docType: "leave-request",
    title: "Leave Request",
    fields
  };

  it("splits stored vs editable correctly", () => {
    expect(fields.map(isPayloadField)).toEqual([true, true, true, false]);
    expect(fields.map(isEditableField)).toEqual([true, false, false, false]);
  });

  it("normalizePayload strips computed-for-display, passes stored modes through raw, and never defaults them", () => {
    const normalized = normalizePayload(form, { reason: "trip", approver: "person:evil", manager: "person:evil" });
    expect(normalized.reason).toBe("trip");
    expect(normalized.approver).toBe("person:evil"); // passthrough — the server stamp step discards it
    expect("manager" in normalized).toBe(false);
    expect(normalized.department).toBeUndefined(); // no "" default: resolve-iff-absent must see absence
    expect(applyFormDefaults(form, {}).approver).toBeUndefined();
  });

  it("validatePayload never validates server-owned fields", () => {
    expect(validatePayload(form, { reason: "x" })).toEqual([]);
  });
});
