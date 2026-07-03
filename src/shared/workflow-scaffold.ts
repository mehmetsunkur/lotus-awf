import type { ValidationError, ViewDefinition, WorkflowDefinition } from "./types";

const APPROVAL_STATES = [
  { name: "draft", label: "Draft" },
  { name: "submitted", label: "Submitted" },
  { name: "approved", label: "Approved", final: true },
  { name: "rejected", label: "Rejected", final: true }
] as const;

function titleFor(title: string, docType: string): string {
  return title.trim() || docType;
}

export function validateApproverPrincipal(principal: string): ValidationError[] {
  if (!principal.trim()) {
    return [{ field: "approverPrincipal", message: "Approver principal is required" }];
  }
  if (!/^(person|group):[a-z0-9][a-z0-9-]*$/.test(principal)) {
    return [{ field: "approverPrincipal", message: "Approver principal must be a person:* or group:* principal" }];
  }
  return [];
}

export function scaffoldApprovalWorkflow(
  appId: string,
  docType: string,
  title: string,
  approverPrincipal: string
): { workflow: WorkflowDefinition; views: ViewDefinition[] } {
  const label = titleFor(title, docType);
  const titleColumn = { field: "payload.title", label: "Title" };
  const stateColumn = { field: "state", label: "State" };
  const updatedColumn = { field: "updatedAt", label: "Updated" };
  const workflow: WorkflowDefinition = {
    _id: `workflow:${docType}`,
    kind: "workflow",
    appId,
    docType,
    title: `${label} Approval`,
    initialState: "draft",
    states: APPROVAL_STATES.map((state) => ({ ...state })),
    transitions: [
      { id: "submit", label: "Submit", from: "draft", to: "submitted" },
      { id: "approve", label: "Approve", from: "submitted", to: "approved", requiredRole: approverPrincipal },
      { id: "reject", label: "Reject", from: "submitted", to: "rejected", requiredRole: approverPrincipal },
      { id: "revise", label: "Revise", from: "rejected", to: "draft" }
    ]
  };
  const views: ViewDefinition[] = [
    {
      _id: `view:${docType}-submitted`,
      kind: "view",
      appId,
      docType,
      title: `Submitted ${label}`,
      columns: [titleColumn, stateColumn, updatedColumn],
      filters: [{ field: "state", op: "eq", value: "submitted" }],
      sort: [{ field: "updatedAt", direction: "desc" }]
    },
    {
      _id: `view:${docType}-mine`,
      kind: "view",
      appId,
      docType,
      title: `My ${label}`,
      columns: [titleColumn, stateColumn, updatedColumn],
      // ADR-0020: "My" means mine — the actor-aware sentinel makes the
      // scaffolded personal view honest instead of listing all readable docs.
      filters: [{ field: "createdBy", op: "in", value: "@me" }],
      sort: [{ field: "updatedAt", direction: "desc" }]
    },
    {
      _id: `view:${docType}-all`,
      kind: "view",
      appId,
      docType,
      title: `All ${label}`,
      columns: [titleColumn, stateColumn, updatedColumn],
      sort: [{ field: "updatedAt", direction: "desc" }]
    }
  ];
  return { workflow, views };
}
