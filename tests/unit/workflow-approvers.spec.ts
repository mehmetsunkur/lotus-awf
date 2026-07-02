import { describe, expect, it } from "vitest";
import {
  applyTransition,
  availableTransitions,
  normalizeResolvedPrincipals
} from "../../src/shared/workflow";
import { validateWorkflowDefinition } from "../../src/shared/definition-validation";
import type { BusinessDocument, WorkflowDefinition } from "../../src/shared/types";

/**
 * ADR-0017 (dynamic approver gate) + ADR-0018 (per-state responsibility and the
 * engine-stamped assignee). The gate/stamping matrices here encode the review
 * findings: fail-closed floor (M1), advisory offering (M2), normalization (m1),
 * distinct refusal message (m2), transition-into-initial-state stamping (m6).
 */

const NOW = "2026-07-02T00:00:00.000Z";
const FORMULA = "await DbLookup(doc.appId, 'department', 'payload.slug', payload.department, 'payload.head')";

const workflow = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  _id: "workflow:leave-request",
  kind: "workflow",
  appId: "leave-request",
  docType: "leave-request",
  title: "Leave approval",
  initialState: "draft",
  states: [
    { name: "draft", label: "Draft" },
    { name: "submitted", label: "Submitted", responsible: "group:managers" },
    { name: "approved", label: "Approved", final: true, responsible: "group:managers" }
  ],
  transitions: [
    { id: "submit", label: "Submit", from: "draft", to: "submitted" },
    {
      id: "approve",
      label: "Approve",
      from: "submitted",
      to: "approved",
      requiredRole: "group:managers",
      approverFormula: FORMULA
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
  payload: { department: "flight-ops" },
  state: "submitted",
  ...overrides
});

describe("ADR-0017 approver gate", () => {
  it("non-empty resolution REPLACES requiredRole: a role-holder outside the resolved set is refused", () => {
    const result = applyTransition(doc(), workflow(), "approve", "person:erin", ["person:erin", "group:managers"], NOW, {
      approvers: ["person:carol"]
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toBe("Approve requires approval by the designated approver");
    }
  });

  it("non-empty resolution admits a resolved approver even without the static role", () => {
    const result = applyTransition(doc(), workflow(), "approve", "person:hank", ["person:hank", "group:ground-ops"], NOW, {
      approvers: ["person:hank"]
    });
    expect(result.ok).toBe(true);
  });

  it("resolution can admit via a resolved group principal", () => {
    const result = applyTransition(doc(), workflow(), "approve", "person:grace", ["person:grace", "group:finance"], NOW, {
      approvers: ["group:finance"]
    });
    expect(result.ok).toBe(true);
  });

  it("empty resolution falls back to requiredRole", () => {
    const allowed = applyTransition(doc(), workflow(), "approve", "person:erin", ["group:managers"], NOW, {
      approvers: []
    });
    expect(allowed.ok).toBe(true);
    const refused = applyTransition(doc(), workflow(), "approve", "person:dave", ["person:dave"], NOW, {
      approvers: []
    });
    expect(refused.ok).toBe(false);
  });

  it("FAIL-CLOSED FLOOR: approverFormula with no requiredRole DENIES on empty resolution (review M1)", () => {
    const def = workflow();
    def.transitions[1] = { ...def.transitions[1], requiredRole: undefined };
    for (const approvers of [[], undefined]) {
      const result = applyTransition(doc(), def, "approve", "person:erin", ["group:managers"], NOW, { approvers });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].message).toBe("Approve requires approval by the designated approver");
      }
    }
  });

  it("absent resolution (advisory/unresolved) behaves like empty: requiredRole fallback", () => {
    const result = applyTransition(doc(), workflow(), "approve", "person:erin", ["group:managers"], NOW);
    expect(result.ok).toBe(true);
  });

  it("transitions without approverFormula behave exactly as before", () => {
    const def = workflow();
    def.transitions[1] = { ...def.transitions[1], approverFormula: undefined };
    const refused = applyTransition(doc(), def, "approve", "person:dave", ["person:dave"], NOW);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0].message).toBe("Approve requires group:managers");
    expect(applyTransition(doc(), def, "approve", "person:erin", ["group:managers"], NOW).ok).toBe(true);
  });

  it("ADVISORY OFFERING (review M2): a formula-gated transition is offered even without the static role", () => {
    const offered = availableTransitions(doc(), workflow(), "person:hank", ["person:hank", "group:ground-ops"], NOW);
    expect(offered.map((transition) => transition.id)).toContain("approve");
    // …while a plain requiredRole transition stays hidden without the role.
    const def = workflow();
    def.transitions[1] = { ...def.transitions[1], approverFormula: undefined };
    const hidden = availableTransitions(doc(), def, "person:hank", ["person:hank"], NOW);
    expect(hidden.map((transition) => transition.id)).not.toContain("approve");
  });
});

describe("normalizeResolvedPrincipals (review m1)", () => {
  it("keeps only principal-shaped strings", () => {
    expect(normalizeResolvedPrincipals("person:carol")).toEqual(["person:carol"]);
    expect(normalizeResolvedPrincipals(["group:managers", "person:erin", "carol", 42, {}])).toEqual([
      "group:managers",
      "person:erin"
    ]);
    expect(normalizeResolvedPrincipals("carol")).toEqual([]);
    expect(normalizeResolvedPrincipals(undefined)).toEqual([]);
    expect(normalizeResolvedPrincipals({ person: "person:carol" })).toEqual([]);
  });
});

describe("ADR-0018 assignee stamping", () => {
  it("stamps the resolved assignee (and the hand-off in history) on state entry", () => {
    const result = applyTransition(doc({ state: "draft" }), workflow(), "submit", "person:dave", ["person:dave"], NOW, {
      assignee: "person:carol"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.assignee).toBe("person:carol");
      expect(result.document.assignedAt).toBe(NOW);
      expect(result.document.history?.at(-1)).toMatchObject({ transition: "submit", assignee: "person:carol" });
    }
  });

  it("falls back to the target state's static responsible", () => {
    const result = applyTransition(doc({ state: "draft" }), workflow(), "submit", "person:dave", ["person:dave"], NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.assignee).toBe("group:managers");
  });

  it("clears the assignee on final states even when the state declares a responsible", () => {
    const result = applyTransition(
      doc({ assignee: "person:carol", assignedAt: NOW }),
      workflow(),
      "approve",
      "person:carol",
      ["person:carol", "group:managers"],
      NOW,
      { approvers: ["person:carol"] }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.assignee).toBeUndefined();
      expect("assignee" in result.document).toBe(false);
      expect("assignedAt" in result.document).toBe(false);
      expect(result.document.history?.at(-1)?.assignee).toBeUndefined();
    }
  });

  it("stamps on a transition INTO the initial state (review m6: revise → draft)", () => {
    const def = workflow();
    def.states[0] = { ...def.states[0], responsibleFormula: "doc.createdBy" };
    const result = applyTransition(doc(), def, "revise", "person:erin", ["group:managers"], NOW, {
      assignee: "person:dave"
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.assignee).toBe("person:dave");
  });

  it("a non-principal resolved value normalizes away and the static responsible wins", () => {
    const result = applyTransition(doc({ state: "draft" }), workflow(), "submit", "person:dave", ["person:dave"], NOW, {
      assignee: "not-a-principal" as string
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.assignee).toBe("group:managers");
  });

  it("no declaration, no resolution: no assignee is stamped", () => {
    const def = workflow();
    def.states[1] = { name: "submitted", label: "Submitted" };
    const result = applyTransition(doc({ state: "draft" }), def, "submit", "person:dave", ["person:dave"], NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect("assignee" in result.document).toBe(false);
  });
});

describe("definition validation (ADR-0017/0018)", () => {
  it("accepts valid approverFormula and responsibility declarations", () => {
    expect(validateWorkflowDefinition(workflow())).toEqual([]);
  });

  it("rejects a blocked token and a syntax error in approverFormula", () => {
    const blocked = workflow();
    blocked.transitions[1] = { ...blocked.transitions[1], approverFormula: "globalThis.leak" };
    expect(validateWorkflowDefinition(blocked).map((error) => error.field)).toContain("transitions.1.approverFormula");

    const broken = workflow();
    broken.transitions[1] = { ...broken.transitions[1], approverFormula: "await DbLookup(" };
    expect(validateWorkflowDefinition(broken).map((error) => error.field)).toContain("transitions.1.approverFormula");
  });

  it("rejects a non-principal static responsible and a malformed responsibleFormula", () => {
    const badStatic = workflow();
    badStatic.states[1] = { ...badStatic.states[1], responsible: "managers" };
    expect(validateWorkflowDefinition(badStatic).map((error) => error.field)).toContain("states.1.responsible");

    const badFormula = workflow();
    badFormula.states[1] = { ...badFormula.states[1], responsibleFormula: "   " };
    expect(validateWorkflowDefinition(badFormula).map((error) => error.field)).toContain(
      "states.1.responsibleFormula"
    );
  });
});
