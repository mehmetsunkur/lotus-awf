import { describe, expect, it } from "vitest";
import { validateDesignDefinition } from "../../src/shared/definition-validation";
import { scaffoldApprovalWorkflow, validateApproverPrincipal } from "../../src/shared/workflow-scaffold";

describe("validateApproverPrincipal", () => {
  it("accepts person and group principals", () => {
    expect(validateApproverPrincipal("person:alice")).toEqual([]);
    expect(validateApproverPrincipal("group:finance")).toEqual([]);
  });

  it("rejects missing or unsupported principals", () => {
    expect(validateApproverPrincipal("").map((error) => error.field)).toEqual(["approverPrincipal"]);
    expect(validateApproverPrincipal("role:finance").map((error) => error.field)).toEqual(["approverPrincipal"]);
  });
});

describe("scaffoldApprovalWorkflow", () => {
  it("builds a valid approval workflow and worklist views", () => {
    const { workflow, views } = scaffoldApprovalWorkflow("field-reports", "report", "Report", "group:finance");

    expect(workflow).toMatchObject({
      _id: "workflow:report",
      kind: "workflow",
      appId: "field-reports",
      docType: "report",
      initialState: "draft"
    });
    expect(workflow.states.map((state) => state.name)).toEqual(["draft", "submitted", "approved", "rejected"]);
    expect(workflow.transitions.map((transition) => transition.id)).toEqual(["submit", "approve", "reject", "revise"]);
    expect(workflow.transitions.find((transition) => transition.id === "approve")?.requiredRole).toBe("group:finance");
    expect(workflow.transitions.find((transition) => transition.id === "reject")?.requiredRole).toBe("group:finance");

    expect(views.map((view) => view._id)).toEqual(["view:report-submitted", "view:report-mine", "view:report-all"]);
    expect(views[0].filters).toEqual([{ field: "state", op: "eq", value: "submitted" }]);
    expect([workflow, ...views].flatMap((definition) => validateDesignDefinition(definition))).toEqual([]);
  });

  it("falls back to the docType when the title is blank", () => {
    const { workflow, views } = scaffoldApprovalWorkflow("field-reports", "report", "   ", "person:alice");

    expect(workflow.title).toBe("report Approval");
    expect(views.map((view) => view.title)).toEqual(["Submitted report", "My report", "All report"]);
  });
});
