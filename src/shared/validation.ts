import type { BusinessDocument, FormDefinition, FormField, SelectOptionsByField, ValidationError } from "./types";
import { evaluateBoolean } from "./expression";
import { runPureHandler } from "./handlers/pure";

export function defaultValueForField(field: FormField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.type === "number") return 0;
  if (field.type === "boolean") return false;
  return "";
}

/**
 * ADR-0019 (review m4): the mode model needs TWO predicates. A field is a
 * PAYLOAD field unless it is `computed-for-display` (per-request, never
 * stored); it is EDITABLE only when it has no computation mode at all.
 * `computed`/`computed-once` fields live in the payload but are server-owned:
 * defaults, coercion, and user-input validation all skip them — the server's
 * stamping step is their single writer.
 */
export function isPayloadField(field: FormField): boolean {
  return field.mode !== "computed-for-display";
}

export function isEditableField(field: FormField): boolean {
  return !field.mode;
}

export function applyFormDefaults(form: FormDefinition, payload: Record<string, unknown>) {
  const next = { ...payload };
  for (const field of form.fields) {
    if (!isEditableField(field)) continue;
    if (next[field.name] === undefined) {
      next[field.name] = defaultValueForField(field);
    }
  }
  return next;
}

/**
 * M7: overwrite every `compute` field with its registered pure handler's result.
 * Run after defaults so handlers see resolved inputs. Pure + deterministic, so
 * the same call on client and server yields the same payload (validation parity);
 * an unknown/throwing handler fails closed to `undefined` (then coerced by
 * `normalizePayload`). The input payload is not mutated.
 */
export function applyComputedFields(
  form: FormDefinition,
  payload: Record<string, unknown>,
  doc?: BusinessDocument
): Record<string, unknown> {
  const next = applyFormDefaults(form, payload);
  for (const field of form.fields) {
    if (field.compute) {
      next[field.name] = runPureHandler(field.compute, {
        payload: next,
        doc: doc as unknown as Record<string, unknown>
      });
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

/** Coerce a value to a field's datatype (shared by user input and stamping). */
export function coerceFieldValue(field: FormField, value: unknown): unknown {
  if (field.type === "number") return Number(value || 0);
  if (field.type === "boolean") return Boolean(value);
  return value ?? "";
}

export function normalizePayload(form: FormDefinition, payload: Record<string, unknown>) {
  const withDefaults = applyFormDefaults(form, payload);
  return Object.fromEntries(
    form.fields
      .filter(isPayloadField)
      .map((field) => {
        const value = withDefaults[field.name];
        // Server-owned modes pass through untouched: coercing here would turn an
        // absent computed-once value into "" and defeat resolve-iff-absent; the
        // stamping step coerces its own results (ADR-0019).
        if (!isEditableField(field)) return [field.name, value];
        return [field.name, coerceFieldValue(field, value)];
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
    if (!isEditableField(field)) continue; // server-owned modes are not user input
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
