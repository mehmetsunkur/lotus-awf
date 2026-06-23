import type { ValidationError, WorkflowDefinition, WorkflowState, WorkflowTransition } from "../shared/types";
import { validateWorkflowDefinition } from "../shared/definition-validation";

export type WorkflowPatchOperation =
  | { type: "add_state"; name: string; label: string; final?: boolean }
  | { type: "update_state"; name: string; label?: string; final?: boolean }
  | { type: "remove_state"; name: string }
  | { type: "add_transition"; transition: WorkflowTransition }
  | { type: "update_transition"; id: string; patch: Partial<WorkflowTransition> }
  | { type: "remove_transition"; id: string };

export type WorkflowPatchResult = {
  workflow: WorkflowDefinition;
  summary: string[];
  errors: ValidationError[];
};

function cloneWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    states: workflow.states.map((state) => ({ ...state })),
    transitions: workflow.transitions.map((transition) => ({ ...transition }))
  };
}

function findState(states: WorkflowState[], name: string): WorkflowState | undefined {
  return states.find((state) => state.name === name);
}

function findTransition(transitions: WorkflowTransition[], id: string): WorkflowTransition | undefined {
  return transitions.find((transition) => transition.id === id);
}

function assertNoStateReferences(workflow: WorkflowDefinition, stateName: string): void {
  const references = workflow.transitions.filter((transition) => transition.from === stateName || transition.to === stateName);
  if (references.length) {
    throw new Error(`Cannot remove state ${stateName}; referenced by transitions: ${references.map((item) => item.id).join(", ")}`);
  }
}

function applyOperation(workflow: WorkflowDefinition, operation: WorkflowPatchOperation): string {
  if (operation.type === "add_state") {
    if (findState(workflow.states, operation.name)) throw new Error(`State already exists: ${operation.name}`);
    workflow.states.push({ name: operation.name, label: operation.label, final: operation.final || undefined });
    return `Added state ${operation.name}`;
  }

  if (operation.type === "update_state") {
    const state = findState(workflow.states, operation.name);
    if (!state) throw new Error(`State not found: ${operation.name}`);
    if (operation.label !== undefined) state.label = operation.label;
    if (operation.final !== undefined) state.final = operation.final || undefined;
    return `Updated state ${operation.name}`;
  }

  if (operation.type === "remove_state") {
    if (workflow.initialState === operation.name) throw new Error(`Cannot remove initial state: ${operation.name}`);
    const index = workflow.states.findIndex((state) => state.name === operation.name);
    if (index === -1) throw new Error(`State not found: ${operation.name}`);
    assertNoStateReferences(workflow, operation.name);
    workflow.states.splice(index, 1);
    return `Removed state ${operation.name}`;
  }

  if (operation.type === "add_transition") {
    if (findTransition(workflow.transitions, operation.transition.id)) {
      throw new Error(`Transition already exists: ${operation.transition.id}`);
    }
    workflow.transitions.push({ ...operation.transition });
    return `Added transition ${operation.transition.id}`;
  }

  if (operation.type === "update_transition") {
    const transition = findTransition(workflow.transitions, operation.id);
    if (!transition) throw new Error(`Transition not found: ${operation.id}`);
    Object.assign(transition, operation.patch, { id: operation.id });
    return `Updated transition ${operation.id}`;
  }

  const index = workflow.transitions.findIndex((transition) => transition.id === operation.id);
  if (index === -1) throw new Error(`Transition not found: ${operation.id}`);
  workflow.transitions.splice(index, 1);
  return `Removed transition ${operation.id}`;
}

export function applyWorkflowPatch(
  workflow: WorkflowDefinition,
  operations: WorkflowPatchOperation[]
): WorkflowPatchResult {
  const next = cloneWorkflow(workflow);
  const summary = operations.map((operation) => applyOperation(next, operation));
  const errors = validateWorkflowDefinition(next);
  return { workflow: next, summary, errors };
}
