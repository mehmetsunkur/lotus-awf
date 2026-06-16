# 02 — Studio Contract

## The layout engine (`src/shared/form-layout.ts`)

Pure, dependency-free, deterministic — `FormDefinition → FormDefinition`, never mutating the input,
exactly like the search/audit/agent engines keep their decisions in `src/shared`. The studio routes
**every** mutation through these so the rules live in one tested place:

- `ensureSections(form)` — normalize: `sections` non-empty (collapse to one covering section when
  absent), every field placed exactly once, unknown names dropped, missing fields appended to the first
  section.
- `moveFieldWithinSection(form, sectionIndex, from, to)` — reorder within a section.
- `moveFieldToSection(form, fieldName, targetSectionIndex, position?)` — regroup across sections.
- `addSection` / `renameSection` / `moveSection`.
- `removeSection(form, index)` — reassign the removed section's fields to the first remaining section;
  **refuses to remove the last section** (every field must live somewhere).
- `addFieldToSection(form, field, sectionIndex)` / `removeField` / `renameField` — keep the field list
  and section references in lock-step.
- `isLayoutNormalized(form)` — true iff `sections` is non-empty and every field is in exactly one
  section. The studio's safety net and the unit tests' invariant.

## The normalized-form invariant

`DocumentForm` renders fields by section, so a field absent from every section is invisible. Therefore
**every operation above preserves: sections non-empty and every field in exactly one section.** This is
the contract the unit tests assert after each op.

## Save path (unchanged)

The studio edits the definition in memory and saves through the existing flow: shared
`validateDesignDefinition` (client) → `PUT /api/definitions/:id` → shared validation again (API) → local
CouchDB. No new endpoint; layout edits are ordinary local-first definition writes (Validation parity +
Offline editing invariants).

## Test selectors

- `studio-form-sections`, `studio-section-<i>`, `studio-section-title-<i>`,
  `studio-section-up/down/remove-<i>`, `studio-section-add-field-<i>`.
- `studio-form-field` rows carry `data-field="<name>"`; field inputs keep **global-index** testids
  (`studio-form-field-name-<index>` etc.) for back-compat with the M4 authoring spec; move/section
  controls are name-based (`studio-form-field-up/down/section-<name>`).
- `studio-form-add-field`, `studio-form-add-section`.
- Preview: `studio-preview`, `document-form-preview`, `preview-field-<name>` (distinct from the live
  form's `field-<name>`), `preview-record-id`.

## Back-compat

No type change — `FormSection` already exists. Layout edits never delete a field implicitly and always
emit definitions that pass `validateFormDefinition`, so already-replicated documents stay valid
(Definitions-as-data contract invariant).
