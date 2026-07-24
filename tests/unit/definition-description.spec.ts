import { describe, expect, it } from "vitest";
import {
  validateFormDefinition,
  validateViewDefinition,
  validateWorkflowDefinition
} from "../../src/shared/definition-validation";
import type { FormDefinition, ViewDefinition, WorkflowDefinition } from "../../src/shared/types";

// ADR-0023: optional self-documenting `description` prose on definitions. These
// tests pin the two invariants the feature rests on: (1) absence is always valid
// (back-compat with pre-ADR-0023 documents — never newly required), and (2) when
// present it is type-checked as a string on every carrying node.

const form = (overrides: Partial<FormDefinition> = {}): FormDefinition => ({
  _id: "form:widget",
  kind: "form",
  appId: "demo",
  docType: "widget",
  title: "Widget",
  fields: [{ name: "title", type: "text", label: "Title", required: true }],
  ...overrides
});

const view = (overrides: Partial<ViewDefinition> = {}): ViewDefinition => ({
  _id: "view:widgets",
  kind: "view",
  appId: "demo",
  docType: "widget",
  title: "Widgets",
  columns: [{ field: "payload.title", label: "Title" }],
  ...overrides
});

const workflow = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  _id: "workflow:widget",
  kind: "workflow",
  appId: "demo",
  docType: "widget",
  title: "Widget Flow",
  initialState: "open",
  states: [
    { name: "open", label: "Open" },
    { name: "done", label: "Done", final: true }
  ],
  transitions: [{ id: "finish", label: "Finish", from: "open", to: "done" }],
  ...overrides
});

describe("ADR-0023 definition description — back-compat (absent is valid)", () => {
  it("accepts form/view/workflow with no description anywhere", () => {
    expect(validateFormDefinition(form())).toEqual([]);
    expect(validateViewDefinition(view())).toEqual([]);
    expect(validateWorkflowDefinition(workflow())).toEqual([]);
  });
});

describe("ADR-0023 definition description — accepted when a string", () => {
  it("accepts a form description", () => {
    expect(validateFormDefinition(form({ description: "What this form captures." }))).toEqual([]);
  });

  it("accepts a view description and per-column descriptions", () => {
    expect(
      validateViewDefinition(
        view({
          description: "What this list shows.",
          columns: [{ field: "payload.title", label: "Title", description: "The widget's name." }]
        })
      )
    ).toEqual([]);
  });

  it("accepts workflow, state, and transition descriptions", () => {
    expect(
      validateWorkflowDefinition(
        workflow({
          description: "How a widget moves.",
          states: [
            { name: "open", label: "Open", description: "Awaiting work." },
            { name: "done", label: "Done", final: true, description: "Finished." }
          ],
          transitions: [
            { id: "finish", label: "Finish", from: "open", to: "done", description: "Close it out." }
          ]
        })
      )
    ).toEqual([]);
  });
});

describe("ADR-0023 definition description — rejected when not a string", () => {
  it("flags a non-string form description", () => {
    const errors = validateFormDefinition(form({ description: 42 as unknown as string }));
    expect(errors).toEqual([{ field: "description", message: "description must be a string" }]);
  });

  it("flags a non-string view description and column description with pathed fields", () => {
    const viewErr = validateViewDefinition(view({ description: {} as unknown as string }));
    expect(viewErr).toContainEqual({ field: "description", message: "description must be a string" });

    const columnErr = validateViewDefinition(
      view({ columns: [{ field: "payload.title", label: "Title", description: 1 as unknown as string }] })
    );
    expect(columnErr).toContainEqual({
      field: "columns.0.description",
      message: "columns.0.description must be a string"
    });
  });

  it("flags non-string workflow, state, and transition descriptions with pathed fields", () => {
    const workflowErr = validateWorkflowDefinition(workflow({ description: 0 as unknown as string }));
    expect(workflowErr).toContainEqual({ field: "description", message: "description must be a string" });

    const stateErr = validateWorkflowDefinition(
      workflow({
        states: [
          { name: "open", label: "Open", description: [] as unknown as string },
          { name: "done", label: "Done", final: true }
        ]
      })
    );
    expect(stateErr).toContainEqual({
      field: "states.0.description",
      message: "states.0.description must be a string"
    });

    const transitionErr = validateWorkflowDefinition(
      workflow({
        transitions: [{ id: "finish", label: "Finish", from: "open", to: "done", description: 5 as unknown as string }]
      })
    );
    expect(transitionErr).toContainEqual({
      field: "transitions.0.description",
      message: "transitions.0.description must be a string"
    });
  });
});
