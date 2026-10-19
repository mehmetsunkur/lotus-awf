import { describe, expect, it } from "vitest";
import {
  applyTransition,
  availableTransitions,
  normalizeResolvedAssignee,
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

describe("normalizeResolvedAssignee", () => {
  it("keeps exactly one person, dropping groups and non-persons", () => {
    expect(normalizeResolvedAssignee("person:carol")).toBe("person:carol");
    // Array → first person element (groups and junk skipped).
    expect(normalizeResolvedAssignee(["group:managers", "person:carol", "person:erin"])).toBe("person:carol");
    // A group is not a person — it normalizes AWAY.
    expect(normalizeResolvedAssignee("group:managers")).toBeUndefined();
    expect(normalizeResolvedAssignee(["group:managers"])).toBeUndefined();
    expect(normalizeResolvedAssignee("carol")).toBeUndefined();
    expect(normalizeResolvedAssignee(undefined)).toBeUndefined();
    expect(normalizeResolvedAssignee(42)).toBeUndefined();
  });
});

describe("ADR-0025 §2 individual assignee stamping", () => {
  // A workflow whose `submitted` state carries an individual assignee alongside the pool.
  const assignFlow = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition =>
    workflow({
      states: [
        { name: "draft", label: "Draft" },
        {
          name: "submitted",
          label: "Submitted",
          responsible: "group:managers",
          assignee: "person:carol",
          assigneeFormula: "payload.approver"
        },
        { name: "approved", label: "Approved", final: true }
      ],
      ...overrides
    });

  it("stamps the resolved individual (and the hand-off in history) on state entry", () => {
    const result = applyTransition(doc({ state: "draft" }), assignFlow(), "submit", "person:dave", ["person:dave"], NOW, {
      assignee: "person:erin"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.assignee).toBe("person:erin");
      expect(result.document.assignedAt).toBe(NOW);
      expect(result.document.history?.at(-1)).toMatchObject({ transition: "submit", assignee: "person:erin" });
    }
  });

  it("falls back to the target state's static assignee when nothing resolves", () => {
    const result = applyTransition(doc({ state: "draft" }), assignFlow(), "submit", "person:dave", ["person:dave"], NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.assignee).toBe("person:carol");
  });

  it("a resolved group normalizes away and the static person wins", () => {
    const result = applyTransition(doc({ state: "draft" }), assignFlow(), "submit", "person:dave", ["person:dave"], NOW, {
      assignee: "group:managers" as unknown as string
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.assignee).toBe("person:carol");
  });

  it("clears the individual on final states even when the doc carried one", () => {
    const result = applyTransition(
      doc({ state: "submitted", assignee: "person:carol", assignedAt: NOW }),
      assignFlow(),
      "approve",
      "person:carol",
      ["person:carol", "group:managers"],
      NOW
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("assignee" in result.document).toBe(false);
      expect("assignedAt" in result.document).toBe(false);
    }
  });

  it("clear-then-stamp: a non-final entry declaring no assignee drops the prior individual", () => {
    // `revise` returns to `draft`, which declares neither responsible nor assignee.
    const flow = assignFlow({
      transitions: [
        { id: "submit", label: "Submit", from: "draft", to: "submitted" },
        { id: "revise", label: "Revise", from: "submitted", to: "draft" },
        { id: "approve", label: "Approve", from: "submitted", to: "approved" }
      ]
    });
    const result = applyTransition(
      doc({ state: "submitted", assignee: "person:carol", assignedAt: NOW, responsible: ["group:managers"], responsibleAt: NOW }),
      flow,
      "revise",
      "person:carol",
      ["person:carol"],
      NOW
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("assignee" in result.document).toBe(false);
      expect("assignedAt" in result.document).toBe(false);
      expect("responsible" in result.document).toBe(false);
      expect("responsibleAt" in result.document).toBe(false);
    }
  });

  it("self-claim: the acting user becomes the individual via an assigneeFormula result", () => {
    // Stage-3 pickup shape — the formula resolves to the actor (`user`).
    const result = applyTransition(doc({ state: "draft" }), assignFlow(), "submit", "person:dave", ["person:dave"], NOW, {
      assignee: "person:dave"
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.assignee).toBe("person:dave");
  });

  it("requireAssignee rejects entry when no individual resolves (fail-CLOSED)", () => {
    const flow = assignFlow({
      states: [
        { name: "draft", label: "Draft" },
        { name: "submitted", label: "Submitted", requireAssignee: true, assigneeFormula: "payload.approver" },
        { name: "approved", label: "Approved", final: true }
      ]
    });
    const result = applyTransition(doc({ state: "draft" }), flow, "submit", "person:dave", ["person:dave"], NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toMatch(/requires an individual assignee/);
  });

  it("requireAssignee rejects a group-only resolution (group is not a person)", () => {
    const flow = assignFlow({
      states: [
        { name: "draft", label: "Draft" },
        { name: "submitted", label: "Submitted", requireAssignee: true, assigneeFormula: "'group:managers'" },
        { name: "approved", label: "Approved", final: true }
      ]
    });
    const result = applyTransition(doc({ state: "draft" }), flow, "submit", "person:dave", ["person:dave"], NOW, {
      assignee: "group:managers" as unknown as string
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toMatch(/requires an individual assignee/);
  });

  it("requireAssignee admits entry once an individual resolves", () => {
    const flow = assignFlow({
      states: [
        { name: "draft", label: "Draft" },
        { name: "submitted", label: "Submitted", requireAssignee: true, assigneeFormula: "payload.approver" },
        { name: "approved", label: "Approved", final: true }
      ]
    });
    const result = applyTransition(doc({ state: "draft" }), flow, "submit", "person:dave", ["person:dave"], NOW, {
      assignee: "person:carol"
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.assignee).toBe("person:carol");
  });

  it("the two routing pairs are independent — a state may stamp a pool with no individual", () => {
    const result = applyTransition(doc({ state: "draft" }), workflow(), "submit", "person:dave", ["person:dave"], NOW, {
      responsible: ["group:managers"]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.responsible).toEqual(["group:managers"]);
      expect("assignee" in result.document).toBe(false);
    }
  });
});

describe("ADR-0025 routing declarations — workflow definition validation", () => {
  const withState = (state: WorkflowDefinition["states"][number]): WorkflowDefinition =>
    workflow({
      states: [{ name: "draft", label: "Draft" }, state, { name: "done", label: "Done", final: true }],
      transitions: [{ id: "go", label: "Go", from: "draft", to: state.name }]
    });

  it("accepts a static person assignee, an assigneeFormula, and a widened responsible set", () => {
    const errors = validateWorkflowDefinition(
      withState({
        name: "review",
        label: "Review",
        responsible: ["group:managers", "person:carol"],
        assignee: "person:carol",
        assigneeFormula: "payload.approver"
      })
    );
    expect(errors).toEqual([]);
  });

  it("rejects a group as a static assignee (an individual is a person)", () => {
    const errors = validateWorkflowDefinition(withState({ name: "review", label: "Review", assignee: "group:managers" }));
    expect(errors.map((e) => e.field)).toContain("states.1.assignee");
  });

  it("rejects an empty-array or non-principal responsible set", () => {
    expect(
      validateWorkflowDefinition(withState({ name: "review", label: "Review", responsible: [] })).map((e) => e.field)
    ).toContain("states.1.responsible");
    expect(
      validateWorkflowDefinition(withState({ name: "review", label: "Review", responsible: ["nope"] })).map((e) => e.field)
    ).toContain("states.1.responsible");
  });

  it("rejects a blocked-token assigneeFormula", () => {
    const errors = validateWorkflowDefinition(
      withState({ name: "review", label: "Review", assigneeFormula: "globalThis.leak" })
    );
    expect(errors.map((e) => e.field)).toContain("states.1.assigneeFormula");
  });

  it("rejects requireAssignee with no assignee or assigneeFormula to resolve", () => {
    const errors = validateWorkflowDefinition(withState({ name: "review", label: "Review", requireAssignee: true }));
    expect(errors.map((e) => e.field)).toContain("states.1.requireAssignee");
  });

  it("rejects requireAssignee on a final state (final clears routing)", () => {
    const def = workflow({
      states: [
        { name: "draft", label: "Draft" },
        { name: "done", label: "Done", final: true, requireAssignee: true, assigneeFormula: "payload.approver" }
      ],
      transitions: [{ id: "finish", label: "Finish", from: "draft", to: "done" }]
    });
    expect(validateWorkflowDefinition(def).map((e) => e.field)).toContain("states.1.requireAssignee");
  });

  it("rejects a non-boolean requireAssignee", () => {
    const errors = validateWorkflowDefinition(
      withState({ name: "review", label: "Review", requireAssignee: "yes" as unknown as boolean, assigneeFormula: "payload.approver" })
    );
    expect(errors.map((e) => e.field)).toContain("states.1.requireAssignee");
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
