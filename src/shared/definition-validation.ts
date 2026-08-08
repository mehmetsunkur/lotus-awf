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
import { formulaBlockedToken, formulaSyntaxError } from "./formula";
import { ME_SENTINEL } from "./view-query";
import { findHandler, handlerHasKind } from "./handlers/manifest";
import type { AgentDefinition, AuditPolicy, HandlerKind } from "./types";

const FIELD_TYPES = new Set(["text", "textarea", "number", "date", "boolean", "select"]);
const FIELD_MODES = new Set(["computed", "computed-once", "computed-for-display"]);
const FILTER_OPS = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function error(field: string, message: string): ValidationError {
  return { field, message };
}

/**
 * ADR-0023: optional self-documenting prose on a definition
 * (form/view/workflow/column/state/transition). Type-checked only when present —
 * never required, so it is fully back-compatible with pre-ADR-0023 documents.
 */
function validateDescription(value: unknown, field: string): ValidationError[] {
  if (value === undefined) return [];
  if (typeof value !== "string") return [error(field, `${field} must be a string`)];
  return [];
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

/**
 * M7: a `compute`/`action` reference must name a declared handler of the matching
 * kind. Fails closed — an unknown name or a kind mismatch is rejected on both
 * tiers, so a definition can never reference a handler that will silently no-op.
 */
function validateHandlerRef(name: unknown, kind: HandlerKind, field: string): ValidationError[] {
  if (name === undefined || name === null || name === "") return [];
  if (typeof name !== "string") return [error(field, `${field} must be a handler name`)];
  if (!findHandler(name)) return [error(field, `Unknown handler: ${name}`)];
  if (!handlerHasKind(name, kind)) return [error(field, `Handler ${name} is not a ${kind} handler`)];
  return [];
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
  errors.push(...validateHandlerRef(field.compute, "pure", `${prefix}.compute`));
  // ADR-0019: computation modes. Computed modes require an async-lane formula
  // (validated for sandbox posture + syntax — never through the sync
  // `validateExpression` lane, which forbids `await` and has no DB functions)
  // and reject user-input rules, whose values the server owns.
  if (field.mode !== undefined && !FIELD_MODES.has(field.mode)) {
    errors.push(error(`${prefix}.mode`, `Field mode is invalid: ${String(field.mode)}`));
  } else if (field.mode) {
    if (!nonEmpty(field.formula)) {
      errors.push(error(`${prefix}.formula`, `A ${field.mode} field requires a formula`));
    } else {
      errors.push(...validateAsyncFormula(field.formula, `${prefix}.formula`));
    }
    if (field.required) errors.push(error(`${prefix}.required`, "A computed field cannot be required user input"));
    if (field.defaultValue !== undefined) errors.push(error(`${prefix}.defaultValue`, "A computed field cannot have a default"));
    if (field.validate?.length) errors.push(error(`${prefix}.validate`, "A computed field cannot carry validation rules"));
    if (field.compute) errors.push(error(`${prefix}.compute`, "A computed field cannot also reference a pure handler"));
  } else if (field.formula !== undefined) {
    errors.push(error(`${prefix}.formula`, "Only computed-mode fields may set a formula"));
  }
  // ADR-0024 §1: the Readers/Authors flag. Orthogonal to `type`/`mode`, but
  // COMPUTED-ONLY — an ACL-flagged field must be `computed`/`computed-once` with a
  // formula so its value is server-resolved and tamper-safe by construction. A
  // static reader list is a `computed-once` field returning a constant array;
  // editable/static and `computed-for-display` shapes are rejected. The
  // formula-presence + sandbox + syntax checks are already enforced by the mode
  // block above.
  if (field.aclRole !== undefined) {
    if (field.aclRole !== "reader" && field.aclRole !== "author") {
      errors.push(error(`${prefix}.aclRole`, `Field aclRole is invalid: ${String(field.aclRole)}`));
    } else if (field.mode !== "computed" && field.mode !== "computed-once") {
      errors.push(
        error(
          `${prefix}.aclRole`,
          `An aclRole field must be computed or computed-once with a formula, not ${field.mode ?? "editable"}`
        )
      );
    }
  }
  if (field.searchable !== undefined && typeof field.searchable !== "boolean") {
    errors.push(error(`${prefix}.searchable`, "Field searchable must be a boolean"));
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
  errors.push(...validateDescription(definition.description, "description"));
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
  // ADR-0020: filters on the ACL envelope fields are always dead — the list
  // route spreads accessSelector over the same selector keys after the view's
  // filters, so an authored readers/authors predicate never applies (review M2).
  if (filter.field === "readers" || filter.field === "authors") {
    errors.push(error(`${prefix}.field`, `Filters on ${filter.field} are overridden by ACL filtering; use "@me" on a payload/envelope field instead`));
  }
  // ADR-0020 sentinel value-shape rules (review M1): "@me" must be the entire
  // value and pairs only with `in`; and `in` itself requires an array or "@me",
  // so near-miss typos fail at authoring instead of as a malformed Mango $in.
  if (Array.isArray(filter.value) && filter.value.includes(ME_SENTINEL)) {
    errors.push(error(`${prefix}.value`, `"@me" must be the entire filter value, not an array element`));
  }
  if (filter.value === ME_SENTINEL && filter.op !== "in") {
    errors.push(error(`${prefix}.value`, `"@me" is only valid with the "in" op`));
  }
  if (filter.op === "in" && !Array.isArray(filter.value) && filter.value !== ME_SENTINEL) {
    errors.push(error(`${prefix}.value`, `An "in" filter value must be an array or exactly "@me"`));
  }
  return errors;
}

export function validateViewDefinition(definition: ViewDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!definition._id?.startsWith("view:")) errors.push(error("_id", "View id must start with view:"));
  if (definition.kind !== "view") errors.push(error("kind", "View kind must be view"));
  if (!nonEmpty(definition.appId)) errors.push(error("appId", "App id is required"));
  if (!nonEmpty(definition.docType)) errors.push(error("docType", "Document type is required"));
  if (!nonEmpty(definition.title)) errors.push(error("title", "Title is required"));
  errors.push(...validateDescription(definition.description, "description"));
  if (!Array.isArray(definition.columns) || definition.columns.length === 0) {
    errors.push(error("columns", "A view needs at least one column"));
  }
  for (const [index, column] of (definition.columns ?? []).entries()) {
    if (!nonEmpty(column.field)) errors.push(error(`columns.${index}.field`, "Column field is required"));
    if (!nonEmpty(column.label)) errors.push(error(`columns.${index}.label`, "Column label is required"));
    errors.push(...validateDescription(column.description, `columns.${index}.description`));
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

/**
 * ADR-0017/0018: an async-lane formula on a workflow definition (approverFormula /
 * responsibleFormula). Same posture as form formula fields: presence + sandbox
 * blocklist + compile check; it must NOT go through the sync `validateExpression`
 * lane (that lane forbids `await` and has no DB functions).
 */
function validateAsyncFormula(formula: string | undefined, field: string): ValidationError[] {
  if (formula === undefined) return [];
  if (!nonEmpty(formula)) return [error(field, "Formula must not be empty")];
  const bad = formulaBlockedToken(formula);
  if (bad) return [error(field, `Formula contains a blocked token: ${bad}`)];
  const syntax = formulaSyntaxError(formula);
  if (syntax) return [error(field, `Formula is not valid: ${syntax}`)];
  return [];
}

const principalShaped = (value: string) => value.startsWith("person:") || value.startsWith("group:");
const personShaped = (value: string) => value.startsWith("person:");
// ADR-0025 D1: `WorkflowState.responsible` is `string | string[]` — a single
// principal or a non-empty set, every element principal-shaped.
const responsibleShaped = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.length > 0 && value.every((v) => typeof v === "string" && nonEmpty(v) && principalShaped(v))
    : typeof value === "string" && nonEmpty(value) && principalShaped(value);

function validateTransition(
  transition: WorkflowTransition,
  index: number,
  states: Set<string>
): ValidationError[] {
  const prefix = `transitions.${index}`;
  const errors: ValidationError[] = [];
  if (!nonEmpty(transition.id)) errors.push(error(`${prefix}.id`, "Transition id is required"));
  if (!nonEmpty(transition.label)) errors.push(error(`${prefix}.label`, "Transition label is required"));
  errors.push(...validateDescription(transition.description, `${prefix}.description`));
  if (!nonEmpty(transition.from)) errors.push(error(`${prefix}.from`, "Transition from state is required"));
  if (transition.from !== "*" && !states.has(transition.from)) {
    errors.push(error(`${prefix}.from`, `Transition source does not exist: ${transition.from}`));
  }
  if (!states.has(transition.to)) errors.push(error(`${prefix}.to`, `Transition target does not exist: ${transition.to}`));
  errors.push(...validateExpression(transition.guard, `${prefix}.guard`));
  errors.push(...validateHandlerRef(transition.action, "effect", `${prefix}.action`));
  // ADR-0019 superseded the ADR-0017 gate: fail loudly on a stale definition
  // instead of silently ignoring (and thereby dropping) its authored gate.
  if ((transition as Record<string, unknown>).approverFormula !== undefined) {
    errors.push(
      error(
        `${prefix}.approverFormula`,
        "approverFormula was superseded by ADR-0019; gate with a guard over a stamped computed field"
      )
    );
  }
  return errors;
}

export function validateWorkflowDefinition(definition: WorkflowDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!definition._id?.startsWith("workflow:")) errors.push(error("_id", "Workflow id must start with workflow:"));
  if (definition.kind !== "workflow") errors.push(error("kind", "Workflow kind must be workflow"));
  if (!nonEmpty(definition.appId)) errors.push(error("appId", "App id is required"));
  if (!nonEmpty(definition.docType)) errors.push(error("docType", "Document type is required"));
  if (!nonEmpty(definition.title)) errors.push(error("title", "Title is required"));
  errors.push(...validateDescription(definition.description, "description"));
  if (!Array.isArray(definition.states) || definition.states.length === 0) {
    errors.push(error("states", "A workflow needs at least one state"));
    return errors;
  }

  const states = new Set<string>();
  for (const [index, state] of definition.states.entries()) {
    if (!nonEmpty(state.name)) errors.push(error(`states.${index}.name`, "State name is required"));
    if (!nonEmpty(state.label)) errors.push(error(`states.${index}.label`, "State label is required"));
    errors.push(...validateDescription(state.description, `states.${index}.description`));
    if (states.has(state.name)) errors.push(error(`states.${index}.name`, `Duplicate state name: ${state.name}`));
    states.add(state.name);
    // ADR-0018/0025: per-state standing-responsibility declaration (a principal or
    // a non-empty set of principals, D1).
    if (state.responsible !== undefined && !responsibleShaped(state.responsible)) {
      errors.push(error(`states.${index}.responsible`, "Responsible must be a person:/group: principal or a non-empty set of them"));
    }
    errors.push(...validateAsyncFormula(state.responsibleFormula, `states.${index}.responsibleFormula`));
    // ADR-0025 §2: per-state individual-assignee declaration. Static `assignee` is
    // exactly one PERSON (a group is not an individual and would normalize away at
    // runtime, so reject it at author time); `assigneeFormula` mirrors the
    // responsibleFormula sandbox/compile checks.
    if (state.assignee !== undefined && !(nonEmpty(state.assignee) && personShaped(state.assignee))) {
      errors.push(error(`states.${index}.assignee`, "Assignee must be a single person: principal"));
    }
    errors.push(...validateAsyncFormula(state.assigneeFormula, `states.${index}.assigneeFormula`));
    // ADR-0025 §2: `requireAssignee` is opt-in fail-closed. Reject it on a final
    // state (final always clears routing — a contradiction) and on a state that
    // declares neither `assignee` nor `assigneeFormula` (it would fail every entry).
    if (state.requireAssignee !== undefined) {
      if (typeof state.requireAssignee !== "boolean") {
        errors.push(error(`states.${index}.requireAssignee`, "requireAssignee must be a boolean"));
      } else if (state.requireAssignee) {
        if (state.final) {
          errors.push(error(`states.${index}.requireAssignee`, "requireAssignee cannot be set on a final state (final clears routing)"));
        }
        if (state.assignee === undefined && state.assigneeFormula === undefined) {
          errors.push(
            error(`states.${index}.requireAssignee`, "requireAssignee needs an assignee or assigneeFormula to resolve an individual")
          );
        }
      }
    }
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

export function validateAgentDefinition(definition: AgentDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!definition._id?.startsWith("agent:")) errors.push(error("_id", "Agent id must start with agent:"));
  if (definition.kind !== "agent") errors.push(error("kind", "Agent kind must be agent"));
  if (!nonEmpty(definition.appId)) errors.push(error("appId", "App id is required"));
  if (!nonEmpty(definition.title)) errors.push(error("title", "Title is required"));

  errors.push(...validateHandlerRef(definition.handler, "agent", "handler"));
  if (!nonEmpty(definition.handler)) errors.push(error("handler", "Agent handler is required"));

  const trigger = definition.trigger;
  if (!isObject(trigger)) {
    errors.push(error("trigger", "Agent trigger is required"));
  } else if (trigger.type === "schedule") {
    if (typeof trigger.everyMs !== "number" || !Number.isFinite(trigger.everyMs) || trigger.everyMs < 0) {
      errors.push(error("trigger.everyMs", "Schedule everyMs must be a non-negative number"));
    }
  } else if (trigger.type === "on-change") {
    if (trigger.docType !== undefined && !nonEmpty(trigger.docType)) {
      errors.push(error("trigger.docType", "on-change docType must be a non-empty string when set"));
    }
  } else {
    errors.push(error("trigger.type", `Unknown trigger type: ${String((trigger as { type?: unknown }).type)}`));
  }
  return errors;
}

export function validateAuditPolicy(definition: AuditPolicy): ValidationError[] {
  const errors: ValidationError[] = [];
  if (definition._id !== "audit:policy") errors.push(error("_id", "Audit policy id must be audit:policy"));
  if (definition.kind !== "auditpolicy") errors.push(error("kind", "Audit policy kind must be auditpolicy"));
  if (!nonEmpty(definition.appId)) errors.push(error("appId", "App id is required"));
  if (typeof definition.retentionDays !== "number" || !Number.isFinite(definition.retentionDays) || definition.retentionDays < 0) {
    errors.push(error("retentionDays", "retentionDays must be a non-negative number"));
  }
  if (definition.docTypes !== undefined) {
    if (!Array.isArray(definition.docTypes) || !definition.docTypes.every((type) => nonEmpty(type))) {
      errors.push(error("docTypes", "docTypes must be an array of non-empty strings"));
    }
  }
  return errors;
}

export function validateDesignDefinition(definition: CouchDocument): ValidationError[] {
  if (!isObject(definition)) return [error("definition", "Definition must be an object")];
  if (definition.kind === "form") return validateFormDefinition(definition as FormDefinition);
  if (definition.kind === "view") return validateViewDefinition(definition as ViewDefinition);
  if (definition.kind === "workflow") return validateWorkflowDefinition(definition as WorkflowDefinition);
  if (definition.kind === "agent") return validateAgentDefinition(definition as AgentDefinition);
  if (definition.kind === "auditpolicy") return validateAuditPolicy(definition as AuditPolicy);
  return [error("kind", "Only form, view, workflow, agent, and audit-policy definitions are editable")];
}
