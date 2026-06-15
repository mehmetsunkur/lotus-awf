import type {
  CouchDocument,
  FormDefinition,
  FormField,
  ValidationError,
  ViewDefinition,
  ViewFilter,
  WorkflowDefinition,
  WorkflowTransition
} from "./types";
import { evaluateBoolean } from "./expression";

const FIELD_TYPES = new Set(["text", "textarea", "number", "date", "boolean", "select"]);
const FILTER_OPS = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function error(field: string, message: string): ValidationError {
  return { field, message };
}

function validateExpression(expression: unknown, field: string): ValidationError[] {
  if (expression === undefined || expression === null || expression === "") return [];
  if (typeof expression !== "string") return [error(field, `${field} must be a string expression`)];
  try {
    evaluateBoolean(expression, { payload: {}, doc: {}, user: "user:preview", now: "2026-01-01T00:00:00.000Z" }, true);
    return [];
  } catch (cause) {
    return [
      error(
        field,
        cause instanceof Error ? cause.message : `${field} is not a valid expression`
      )
    ];
  }
}

function validateField(field: FormField, index: number): ValidationError[] {
  const prefix = `fields.${index}`;
  const errors: ValidationError[] = [];
  if (!nonEmpty(field.name)) errors.push(error(`${prefix}.name`, "Field name is required"));
  if (!FIELD_TYPES.has(field.type)) errors.push(error(`${prefix}.type`, `Field type is invalid: ${String(field.type)}`));
  if (!nonEmpty(field.label)) errors.push(error(`${prefix}.label`, "Field label is required"));
  if (field.type === "select" && field.options && !Array.isArray(field.options)) {
    errors.push(error(`${prefix}.options`, "Select options must be an array"));
  }
  for (const [optionIndex, option] of (field.options ?? []).entries()) {
    if (!nonEmpty(option.label)) errors.push(error(`${prefix}.options.${optionIndex}.label`, "Option label is required"));
    if (!nonEmpty(option.value)) errors.push(error(`${prefix}.options.${optionIndex}.value`, "Option value is required"));
  }
  if (field.source) {
    if (!nonEmpty(field.source.docType)) errors.push(error(`${prefix}.source.docType`, "Source docType is required"));
    if (!nonEmpty(field.source.labelField)) errors.push(error(`${prefix}.source.labelField`, "Source labelField is required"));
  }
  errors.push(...validateExpression(field.visibleWhen, `${prefix}.visibleWhen`));
  errors.push(...validateExpression(field.readOnlyWhen, `${prefix}.readOnlyWhen`));
  errors.push(...validateExpression(field.requiredWhen, `${prefix}.requiredWhen`));
  for (const [ruleIndex, rule] of (field.validate ?? []).entries()) {
    errors.push(...validateExpression(rule.expression, `${prefix}.validate.${ruleIndex}.expression`));
  }
  return errors;
}

export function validateFormDefinition(definition: FormDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!definition._id?.startsWith("form:")) errors.push(error("_id", "Form id must start with form:"));
  if (definition.kind !== "form") errors.push(error("kind", "Form kind must be form"));
  if (!nonEmpty(definition.appId)) errors.push(error("appId", "App id is required"));
  if (!nonEmpty(definition.docType)) errors.push(error("docType", "Document type is required"));
  if (!nonEmpty(definition.title)) errors.push(error("title", "Title is required"));
  if (!Array.isArray(definition.fields) || definition.fields.length === 0) {
    errors.push(error("fields", "A form needs at least one field"));
    return errors;
  }

  const fieldNames = new Set<string>();
  for (const [index, field] of definition.fields.entries()) {
    errors.push(...validateField(field, index));
    if (fieldNames.has(field.name)) errors.push(error(`fields.${index}.name`, `Duplicate field name: ${field.name}`));
    fieldNames.add(field.name);
  }
  for (const [sectionIndex, section] of (definition.sections ?? []).entries()) {
    if (!nonEmpty(section.title)) errors.push(error(`sections.${sectionIndex}.title`, "Section title is required"));
    for (const fieldName of section.fields) {
      if (!fieldNames.has(fieldName)) {
        errors.push(error(`sections.${sectionIndex}.fields`, `Section references unknown field: ${fieldName}`));
      }
    }
  }
  return errors;
}

function validateFilter(filter: ViewFilter, index: number): ValidationError[] {
  const prefix = `filters.${index}`;
  const errors: ValidationError[] = [];
  if (!nonEmpty(filter.field)) errors.push(error(`${prefix}.field`, "Filter field is required"));
  if (!FILTER_OPS.has(filter.op)) errors.push(error(`${prefix}.op`, `Filter op is invalid: ${String(filter.op)}`));
  return errors;
}

export function validateViewDefinition(definition: ViewDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!definition._id?.startsWith("view:")) errors.push(error("_id", "View id must start with view:"));
  if (definition.kind !== "view") errors.push(error("kind", "View kind must be view"));
  if (!nonEmpty(definition.appId)) errors.push(error("appId", "App id is required"));
  if (!nonEmpty(definition.docType)) errors.push(error("docType", "Document type is required"));
  if (!nonEmpty(definition.title)) errors.push(error("title", "Title is required"));
  if (!Array.isArray(definition.columns) || definition.columns.length === 0) {
    errors.push(error("columns", "A view needs at least one column"));
  }
  for (const [index, column] of (definition.columns ?? []).entries()) {
    if (!nonEmpty(column.field)) errors.push(error(`columns.${index}.field`, "Column field is required"));
    if (!nonEmpty(column.label)) errors.push(error(`columns.${index}.label`, "Column label is required"));
  }
  for (const [index, filter] of (definition.filters ?? []).entries()) {
    errors.push(...validateFilter(filter, index));
  }
  for (const [index, sort] of (definition.sort ?? []).entries()) {
    if (!nonEmpty(sort.field)) errors.push(error(`sort.${index}.field`, "Sort field is required"));
    if (!SORT_DIRECTIONS.has(sort.direction)) {
      errors.push(error(`sort.${index}.direction`, `Sort direction is invalid: ${String(sort.direction)}`));
    }
  }
  return errors;
}

function validateTransition(
  transition: WorkflowTransition,
  index: number,
  states: Set<string>
): ValidationError[] {
  const prefix = `transitions.${index}`;
  const errors: ValidationError[] = [];
  if (!nonEmpty(transition.id)) errors.push(error(`${prefix}.id`, "Transition id is required"));
  if (!nonEmpty(transition.label)) errors.push(error(`${prefix}.label`, "Transition label is required"));
  if (!nonEmpty(transition.from)) errors.push(error(`${prefix}.from`, "Transition from state is required"));
  if (transition.from !== "*" && !states.has(transition.from)) {
    errors.push(error(`${prefix}.from`, `Transition source does not exist: ${transition.from}`));
  }
  if (!states.has(transition.to)) errors.push(error(`${prefix}.to`, `Transition target does not exist: ${transition.to}`));
  errors.push(...validateExpression(transition.guard, `${prefix}.guard`));
  return errors;
}

export function validateWorkflowDefinition(definition: WorkflowDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!definition._id?.startsWith("workflow:")) errors.push(error("_id", "Workflow id must start with workflow:"));
  if (definition.kind !== "workflow") errors.push(error("kind", "Workflow kind must be workflow"));
  if (!nonEmpty(definition.appId)) errors.push(error("appId", "App id is required"));
  if (!nonEmpty(definition.docType)) errors.push(error("docType", "Document type is required"));
  if (!nonEmpty(definition.title)) errors.push(error("title", "Title is required"));
  if (!Array.isArray(definition.states) || definition.states.length === 0) {
    errors.push(error("states", "A workflow needs at least one state"));
    return errors;
  }

  const states = new Set<string>();
  for (const [index, state] of definition.states.entries()) {
    if (!nonEmpty(state.name)) errors.push(error(`states.${index}.name`, "State name is required"));
    if (!nonEmpty(state.label)) errors.push(error(`states.${index}.label`, "State label is required"));
    if (states.has(state.name)) errors.push(error(`states.${index}.name`, `Duplicate state name: ${state.name}`));
    states.add(state.name);
  }
  if (!states.has(definition.initialState)) {
    errors.push(error("initialState", `Initial state does not exist: ${definition.initialState}`));
  }
  const transitionIds = new Set<string>();
  for (const [index, transition] of (definition.transitions ?? []).entries()) {
    errors.push(...validateTransition(transition, index, states));
    if (transitionIds.has(transition.id)) {
      errors.push(error(`transitions.${index}.id`, `Duplicate transition id: ${transition.id}`));
    }
    transitionIds.add(transition.id);
  }
  return errors;
}

export function validateDesignDefinition(definition: CouchDocument): ValidationError[] {
  if (!isObject(definition)) return [error("definition", "Definition must be an object")];
  if (definition.kind === "form") return validateFormDefinition(definition as FormDefinition);
  if (definition.kind === "view") return validateViewDefinition(definition as ViewDefinition);
  if (definition.kind === "workflow") return validateWorkflowDefinition(definition as WorkflowDefinition);
  return [error("kind", "Only form, view, and workflow definitions are editable")];
}
