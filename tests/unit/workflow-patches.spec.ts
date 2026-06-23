import { describe, expect, it } from "vitest";
import { applyWorkflowPatch, type WorkflowPatchOperation } from "../../src/mcp/workflow-patches";
import type { WorkflowDefinition } from "../../src/shared/types";

const workflow = (): WorkflowDefinition => ({
  _id: "workflow:report",
  kind: "workflow",
  appId: "field-reports",
  docType: "report",
  title: "Report Approval",
  initialState: "draft",
  states: [
    { name: "draft", label: "Draft" },
    { name: "submitted", label: "Submitted" },
    { name: "approved", label: "Approved", final: true }
  ],
  transitions: [
    { id: "submit", label: "Submit", from: "draft", to: "submitted" },
    { id: "approve", label: "Approve", from: "submitted", to: "approved", requiredRole: "group:finance" }
  ]
});

describe("applyWorkflowPatch", () => {
  it("applies state and transition additions without mutating the source workflow", () => {
    const source = workflow();
    const operations: WorkflowPatchOperation[] = [
      { type: "add_state", name: "rejected", label: "Rejected", final: true },
      { type: "add_transition", transition: { id: "reject", label: "Reject", from: "submitted", to: "rejected" } }
    ];

    const result = applyWorkflowPatch(source, operations);

    expect(result.errors).toEqual([]);
    expect(result.summary).toEqual(["Added state rejected", "Added transition reject"]);
    expect(result.workflow.states.map((state) => state.name)).toEqual(["draft", "submitted", "approved", "rejected"]);
    expect(result.workflow.transitions.map((transition) => transition.id)).toEqual(["submit", "approve", "reject"]);
    expect(source.states.map((state) => state.name)).toEqual(["draft", "submitted", "approved"]);
  });

  it("rejects removing the initial state", () => {
    expect(() => applyWorkflowPatch(workflow(), [{ type: "remove_state", name: "draft" }])).toThrow(
      "Cannot remove initial state: draft"
    );
  });

  it("rejects removing a state referenced by transitions", () => {
    expect(() => applyWorkflowPatch(workflow(), [{ type: "remove_state", name: "submitted" }])).toThrow(
      "Cannot remove state submitted; referenced by transitions: submit, approve"
    );
  });

  it("returns validation errors for structurally invalid patches", () => {
    const result = applyWorkflowPatch(workflow(), [
      { type: "update_transition", id: "approve", patch: { to: "missing" } }
    ]);

    expect(result.errors.map((error) => error.field)).toEqual(["transitions.1.to"]);
  });
});
