import type { FormDefinition, FormField, FormSection } from "./types";

/**
 * Pure form-layout operations (M11 citizen layout studio). Each takes a
 * FormDefinition and returns a new one, never mutating the input, exactly like
 * the search/audit/agent engines keep their decisions in `src/shared`. They are
 * the single source of truth for the studio's reorder/section editing so the
 * logic is deterministic and unit-testable without a DOM.
 *
 * Invariant preserved by every operation: the form is always "normalized" —
 * `sections` is non-empty and every field name appears in exactly one section.
 * The runtime renders fields by section (`DocumentForm`), so a field outside
 * every section would be invisible; keeping coverage exact keeps WYSIWYG honest.
 */

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Move the item at `from` to `to` in a copy of `items` (indices are clamped). */
function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(clamp(to, 0, next.length), 0, item);
  return next;
}

/**
 * Normalize a form so `sections` is non-empty and covers every field exactly
 * once. A form with no sections collapses to a single section (matching the
 * runtime fallback); any field missing from all sections is appended to the
 * first section; names not backed by a field are dropped.
 */
export function ensureSections(form: FormDefinition): FormDefinition {
  const fieldNames = form.fields.map((field) => field.name);
  const known = new Set(fieldNames);
  const base: FormSection[] = form.sections?.length
    ? form.sections.map((section) => ({ ...section, fields: section.fields.filter((name) => known.has(name)) }))
    : [{ title: form.title, fields: [...fieldNames] }];

  const placed = new Set(base.flatMap((section) => section.fields));
  const missing = fieldNames.filter((name) => !placed.has(name));
  const sections = base.map((section, index) =>
    index === 0 ? { ...section, fields: [...section.fields, ...missing] } : section
  );
  return { ...form, sections };
}

/** The index of the section currently holding `fieldName`, or -1. */
function sectionOf(sections: FormSection[], fieldName: string): number {
  return sections.findIndex((section) => section.fields.includes(fieldName));
}

/** Reorder a field within one section. */
export function moveFieldWithinSection(
  form: FormDefinition,
  sectionIndex: number,
  from: number,
  to: number
): FormDefinition {
  const normalized = ensureSections(form);
  const sections = normalized.sections!.map((section, index) =>
    index === sectionIndex ? { ...section, fields: moveItem(section.fields, from, to) } : section
  );
  return { ...normalized, sections };
}

/**
 * Move a field into `targetSectionIndex` at `position` (default: end). A no-op
 * if the field is unknown or already the only placement at that spot.
 */
export function moveFieldToSection(
  form: FormDefinition,
  fieldName: string,
  targetSectionIndex: number,
  position?: number
): FormDefinition {
  const normalized = ensureSections(form);
  if (!normalized.fields.some((field) => field.name === fieldName)) return normalized;
  if (targetSectionIndex < 0 || targetSectionIndex >= normalized.sections!.length) return normalized;
  const sections = normalized.sections!.map((section) => ({
    ...section,
    fields: section.fields.filter((name) => name !== fieldName)
  }));
  const target = sections[targetSectionIndex];
  const at = position === undefined ? target.fields.length : clamp(position, 0, target.fields.length);
  target.fields = [...target.fields.slice(0, at), fieldName, ...target.fields.slice(at)];
  return { ...normalized, sections };
}

/** Append a new, empty section. Titles need not be unique. */
export function addSection(form: FormDefinition, title = "New section"): FormDefinition {
  const normalized = ensureSections(form);
  return { ...normalized, sections: [...normalized.sections!, { title, fields: [] }] };
}

export function renameSection(form: FormDefinition, index: number, title: string): FormDefinition {
  const normalized = ensureSections(form);
  const sections = normalized.sections!.map((section, candidate) =>
    candidate === index ? { ...section, title } : section
  );
  return { ...normalized, sections };
}

export function moveSection(form: FormDefinition, from: number, to: number): FormDefinition {
  const normalized = ensureSections(form);
  return { ...normalized, sections: moveItem(normalized.sections!, from, to) };
}

/**
 * Remove a section, reassigning its fields to the first remaining section so no
 * field is orphaned. The last section cannot be removed (every field must live
 * somewhere) — that is a no-op.
 */
export function removeSection(form: FormDefinition, index: number): FormDefinition {
  const normalized = ensureSections(form);
  const sections = normalized.sections!;
  if (sections.length <= 1 || index < 0 || index >= sections.length) return normalized;
  const orphaned = sections[index].fields;
  const remaining = sections.filter((_section, candidate) => candidate !== index);
  const sink = index === 0 ? 0 : index - 1; // index into `remaining`
  remaining[sink] = { ...remaining[sink], fields: [...remaining[sink].fields, ...orphaned] };
  return { ...normalized, sections: remaining };
}

/** Add a new field and place it in `sectionIndex` (default: first section). */
export function addFieldToSection(form: FormDefinition, field: FormField, sectionIndex = 0): FormDefinition {
  const normalized = ensureSections(form);
  const fields = [...normalized.fields, field];
  const target = clamp(sectionIndex, 0, normalized.sections!.length - 1);
  const sections = normalized.sections!.map((section, index) =>
    index === target ? { ...section, fields: [...section.fields, field.name] } : section
  );
  return { ...normalized, fields, sections };
}

/** Remove a field and drop it from whatever section holds it. */
export function removeField(form: FormDefinition, fieldName: string): FormDefinition {
  const normalized = ensureSections(form);
  return {
    ...normalized,
    fields: normalized.fields.filter((field) => field.name !== fieldName),
    sections: normalized.sections!.map((section) => ({
      ...section,
      fields: section.fields.filter((name) => name !== fieldName)
    }))
  };
}

/** Rename a field everywhere it is referenced (the field list and its section). */
export function renameField(form: FormDefinition, index: number, nextName: string): FormDefinition {
  const normalized = ensureSections(form);
  const current = normalized.fields[index]?.name;
  if (!current || current === nextName) {
    return {
      ...normalized,
      fields: normalized.fields.map((field, candidate) => (candidate === index ? { ...field, name: nextName } : field))
    };
  }
  return {
    ...normalized,
    fields: normalized.fields.map((field, candidate) => (candidate === index ? { ...field, name: nextName } : field)),
    sections: normalized.sections!.map((section) => ({
      ...section,
      fields: section.fields.map((name) => (name === current ? nextName : name))
    }))
  };
}

/** True when every field is in exactly one section (the studio's safety net). */
export function isLayoutNormalized(form: FormDefinition): boolean {
  if (!form.sections?.length) return false;
  const placements = form.sections.flatMap((section) => section.fields);
  if (placements.length !== new Set(placements).size) return false; // a field in two sections
  const placed = new Set(placements);
  const names = form.fields.map((field) => field.name);
  return names.length === placed.size && names.every((name) => placed.has(name));
}

export { sectionOf };
