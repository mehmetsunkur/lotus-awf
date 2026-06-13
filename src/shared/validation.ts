import type { BusinessDocument, FormDefinition, FormField, SelectOptionsByField, ValidationError } from "./types";
import { evaluateBoolean } from "./expression";

export function defaultValueForField(field: FormField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.type === "number") return 0;
  if (field.type === "boolean") return false;
  return "";
}

export function applyFormDefaults(form: FormDefinition, payload: Record<string, unknown>) {
  const next = { ...payload };
  for (const field of form.fields) {
    if (next[field.name] === undefined) {
      next[field.name] = defaultValueForField(field);
    }
  }
  return next;
}

export function isFieldVisible(field: FormField, doc: BusinessDocument | undefined, payload: Record<string, unknown>) {
  return evaluateBoolean(field.visibleWhen, { payload, doc: doc as unknown as Record<string, unknown> }, true);
}

export function isFieldReadOnly(field: FormField, doc: BusinessDocument | undefined, payload: Record<string, unknown>) {
  return evaluateBoolean(field.readOnlyWhen, { payload, doc: doc as unknown as Record<string, unknown> }, false);
}

export function isFieldRequired(field: FormField, doc: BusinessDocument | undefined, payload: Record<string, unknown>) {
  return Boolean(field.required) || evaluateBoolean(field.requiredWhen, { payload, doc: doc as unknown as Record<string, unknown> }, false);
}

export function normalizePayload(form: FormDefinition, payload: Record<string, unknown>) {
  const withDefaults = applyFormDefaults(form, payload);
  return Object.fromEntries(
    form.fields.map((field) => {
      const value = withDefaults[field.name];
      if (field.type === "number") return [field.name, Number(value || 0)];
      if (field.type === "boolean") return [field.name, Boolean(value)];
      return [field.name, value ?? ""];
    })
  );
}

export function validatePayload(
  form: FormDefinition,
  payload: Record<string, unknown>,
  doc?: BusinessDocument,
  optionsByField: SelectOptionsByField = {}
): ValidationError[] {
  const errors: ValidationError[] = [];
  const normalized = normalizePayload(form, payload);

  for (const field of form.fields) {
    if (!isFieldVisible(field, doc, normalized)) continue;
    const value = normalized[field.name];

    if (isFieldRequired(field, doc, normalized) && (value === "" || value === undefined || value === null)) {
      errors.push({ field: field.name, message: `${field.label} is required` });
    }

    if (field.type === "select" && value) {
      const allowed = field.options ?? optionsByField[field.name] ?? [];
      if (allowed.length && !allowed.some((option) => option.value === value)) {
        errors.push({ field: field.name, message: `${field.label} is not a valid option` });
      }
    }

    for (const rule of field.validate ?? []) {
      try {
        if (!evaluateBoolean(rule.expression, { payload: normalized, doc: doc as unknown as Record<string, unknown> }, true)) {
          errors.push({ field: field.name, message: rule.message ?? `${field.label} is invalid` });
        }
      } catch (error) {
        errors.push({
          field: field.name,
          message: error instanceof Error ? error.message : `${field.label} validation failed`
        });
      }
    }
  }

  return errors;
}
